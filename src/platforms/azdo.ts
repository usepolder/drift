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
    private readonly warn: (m: string) => void,
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
    return new AzdoPlatform(threadsUrl, token ?? '', baseRef, workspace, warn);
  }

  getBaseRef(): string | null {
    return this.baseRef;
  }

  async getChangedSourceFiles(): Promise<string[]> {
    if (!this.baseRef) return [];
    return diffChangedFiles(this.workspace, this.baseRef).filter((f) => SOURCE_RE.test(f));
  }

  async upsertComment(body: string, marker: string, createIfMissing: boolean): Promise<void> {
    if (!this.token) return; // already warned in fromEnv
    const existing = await this.findExistingComment(marker);
    try {
      if (existing) {
        await this.api(
          `${this.threadsUrl}/${existing.threadId}/comments/${existing.commentId}?api-version=${API_VERSION}`,
          'PATCH',
          { content: body },
        );
      } else if (createIfMissing) {
        await this.api(`${this.threadsUrl}?api-version=${API_VERSION}`, 'POST', {
          comments: [{ parentCommentId: 0, content: body, commentType: 'text' }],
          status: 'active',
        });
      }
    } catch (err) {
      this.warn(`Polder Drift: failed to post Azure DevOps comment: ${(err as Error).message}`);
    }
  }

  fail(_message: string): void {
    // No-op: the `ci` command sets the process exit code from the run result, which
    // fails the pipeline step and (with a required build-validation policy) the PR.
  }

  private async findExistingComment(marker: string): Promise<{ threadId: number; commentId: number } | null> {
    try {
      const data = (await this.api(`${this.threadsUrl}?api-version=${API_VERSION}`, 'GET')) as {
        value?: AzdoThread[];
      };
      for (const thread of data.value ?? []) {
        const first = thread.comments?.[0];
        if (first?.content?.includes(marker)) return { threadId: thread.id, commentId: first.id };
      }
    } catch (err) {
      this.warn(`Polder Drift: could not list Azure DevOps threads: ${(err as Error).message}`);
    }
    return null;
  }

  private async api(url: string, method: string, body?: unknown): Promise<unknown> {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${res.status} ${res.statusText}`);
    return res.status === 204 ? null : res.json();
  }
}
