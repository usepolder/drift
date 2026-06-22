/**
 * Azure DevOps transport. Changed files come from local git (the pipeline checks out
 * the repo, so no REST needed for discovery); the comment is upserted via the PR
 * threads REST API using the pipeline's OAuth token (SYSTEM_ACCESSTOKEN).
 *
 * Requires "Allow scripts to access the OAuth token" (or the build service to have
 * "Contribute to pull requests"), and fetchDepth: 0 so the base branch is available.
 */
import type { PrPlatform } from './types';
import { diffChangedFiles } from './git';

const SOURCE_RE = /\.(ts|tsx|js|jsx)$/;
const API_VERSION = '7.1-preview.1';
// Upper bound on threads pages we follow via continuation token, so a misbehaving
// server can't loop us forever. Even very busy PRs hold far fewer than this.
const MAX_THREAD_PAGES = 50;
// Hard cap per request so a slow/black-holed Azure DevOps endpoint fails the step
// fast instead of hanging until the agent's job timeout.
const REQUEST_TIMEOUT_MS = 15000;

interface AzdoThread {
  id: number;
  comments?: { id: number; content?: string }[];
}

export class AzdoPlatform implements PrPlatform {
  readonly name = 'azdo' as const;
  readonly workspace: string;

  private constructor(
    private readonly threadsUrl: string,
    private readonly token: string,
    private readonly baseRef: string | null,
    workspace: string,
  ) {
    this.workspace = workspace;
  }

  static fromEnv(
    env: NodeJS.ProcessEnv = process.env,
    warn: (m: string) => void = (m) => process.stderr.write(m + '\n'),
  ): AzdoPlatform | null {
    const collection = env.SYSTEM_COLLECTIONURI; // e.g. https://dev.azure.com/org/
    const project = env.SYSTEM_TEAMPROJECT;
    const repoId = env.BUILD_REPOSITORY_ID ?? env.BUILD_REPOSITORY_NAME;
    const prId = env.SYSTEM_PULLREQUEST_PULLREQUESTID;
    const token = env.SYSTEM_ACCESSTOKEN;
    const workspace = env.BUILD_SOURCESDIRECTORY ?? process.cwd();
    if (!collection || !project || !repoId || !prId) return null;
    if (!token) {
      warn('Polder Drift: SYSTEM_ACCESSTOKEN is empty. Enable "Allow scripts to access the OAuth token" on the job, or grant the build service "Contribute to pull requests". Skipping comment.');
    }
    const targetBranch = env.SYSTEM_PULLREQUEST_TARGETBRANCH; // refs/heads/main
    const baseRef = targetBranch ? `origin/${targetBranch.replace(/^refs\/heads\//, '')}` : null;
    const base = collection.endsWith('/') ? collection : `${collection}/`;
    const threadsUrl = `${base}${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/pullRequests/${prId}/threads`;
    return new AzdoPlatform(threadsUrl, token ?? '', baseRef, workspace);
  }

  getBaseRef(): string | null {
    return this.baseRef;
  }

  async getChangedSourceFiles(): Promise<string[]> {
    if (!this.baseRef) return [];
    return diffChangedFiles(this.workspace, this.baseRef).filter((f) => SOURCE_RE.test(f));
  }

  async upsertComment(body: string, marker: string, createIfMissing: boolean): Promise<boolean> {
    if (!this.token) return false; // already warned in fromEnv
    // findExistingComment throws on a read failure (rather than returning null), so a
    // transient list error does not masquerade as "no comment" and duplicate-post. A
    // PATCH/POST failure (e.g. the build identity lacks "Contribute to pull requests")
    // likewise propagates so the caller reports the post as failed, not succeeded.
    const existing = await this.findExistingComment(marker);
    if (existing) {
      await this.api(
        `${this.threadsUrl}/${existing.threadId}/comments/${existing.commentId}?api-version=${API_VERSION}`,
        'PATCH',
        { content: body },
      );
      return true;
    } else if (createIfMissing) {
      await this.api(`${this.threadsUrl}?api-version=${API_VERSION}`, 'POST', {
        comments: [{ parentCommentId: 0, content: body, commentType: 'text' }],
        status: 'active',
      });
      return true;
    }
    return false;
  }

  fail(_message: string): void {
    // No-op: the `ci` command sets the process exit code from the run result, which
    // fails the pipeline step and (with a required build-validation policy) the PR.
  }

  /**
   * Find our existing Polder thread by scanning every page of the PR's threads. The
   * Azure DevOps threads list is not always a single page on a busy PR, so we follow
   * the `x-ms-continuationtoken` header until exhausted. Returns null only when the
   * marker is genuinely absent after a full scan; a read failure throws so the caller
   * does not mistake it for "not found" and post a duplicate.
   */
  private async findExistingComment(marker: string): Promise<{ threadId: number; commentId: number } | null> {
    let continuation: string | null = null;
    // Hard cap on pages so a server that echoes the same token can't loop forever.
    for (let page = 0; page < MAX_THREAD_PAGES; page++) {
      const sep = this.threadsUrl.includes('?') ? '&' : '?';
      const url =
        `${this.threadsUrl}${sep}api-version=${API_VERSION}` +
        (continuation ? `&continuationToken=${encodeURIComponent(continuation)}` : '');
      const { threads, continuationToken } = await this.listThreadsPage(url);
      for (const thread of threads) {
        // Our marker lives in the parent comment we author when creating the thread.
        const first = thread.comments?.[0];
        if (first?.content?.includes(marker)) return { threadId: thread.id, commentId: first.id };
      }
      if (!continuationToken) return null;
      continuation = continuationToken;
    }
    return null;
  }

  private async listThreadsPage(
    url: string,
  ): Promise<{ threads: AzdoThread[]; continuationToken: string | null }> {
    const res = await this.fetchWithTimeout(url, 'GET');
    if (!res.ok) throw new Error(`GET ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { value?: AzdoThread[] };
    return { threads: data.value ?? [], continuationToken: res.headers.get('x-ms-continuationtoken') };
  }

  private async api(url: string, method: string, body?: unknown): Promise<unknown> {
    const res = await this.fetchWithTimeout(url, method, body);
    if (!res.ok) throw new Error(`${method} ${res.status} ${res.statusText}`);
    return res.status === 204 ? null : res.json();
  }

  /**
   * fetch with bearer auth and a hard REQUEST_TIMEOUT_MS abort, shared by every
   * Azure DevOps call so the threads-pagination read path gets the same timeout
   * protection as writes. Returns the raw Response; callers check `.ok` and read
   * the body or headers (e.g. the `x-ms-continuationtoken`) themselves.
   */
  private async fetchWithTimeout(url: string, method: string, body?: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
