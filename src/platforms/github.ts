/**
 * GitHub transport. Changed files come from the PR API; the comment is upserted via
 * the issues API; base content (for "new in this PR") is read from git when the base
 * SHA was fetched, degrading gracefully otherwise.
 */
import * as core from '@actions/core';
import * as github from '@actions/github';
import type { PrPlatform } from './types';

const SOURCE_RE = /\.(ts|tsx|js|jsx)$/;
const MAX_FILES = 100;
const COMMENTS_PER_PAGE = 100;
// Upper bound on comment pages we walk, so a misbehaving API can't loop us forever.
// Even very busy PRs hold far fewer than 50 * 100 = 5000 issue comments.
const MAX_COMMENT_PAGES = 50;

type Octokit = ReturnType<typeof github.getOctokit>;

export class GitHubPlatform implements PrPlatform {
  readonly name = 'github' as const;
  readonly workspace: string;

  private constructor(
    private readonly octokit: Octokit,
    private readonly owner: string,
    private readonly repo: string,
    private readonly prNumber: number,
    private readonly baseSha: string,
  ) {
    this.workspace = process.env.GITHUB_WORKSPACE ?? '.';
  }

  /** Build from the Action environment, or null if this is not a pull_request event. */
  static fromEnv(): GitHubPlatform | null {
    const ctx = github.context;
    if (!ctx.payload.pull_request) return null;
    const token = core.getInput('github-token', { required: true });
    const { owner, repo } = ctx.repo;
    return new GitHubPlatform(
      github.getOctokit(token),
      owner,
      repo,
      ctx.payload.pull_request.number,
      ctx.payload.pull_request.base.sha,
    );
  }

  getBaseRef(): string | null {
    return this.baseSha || null;
  }

  async getChangedSourceFiles(): Promise<string[]> {
    const { data } = await this.octokit.rest.pulls.listFiles({
      owner: this.owner,
      repo: this.repo,
      pull_number: this.prNumber,
      per_page: MAX_FILES,
    });
    return data.filter((f) => SOURCE_RE.test(f.filename) && f.status !== 'removed').map((f) => f.filename);
  }

  async upsertComment(body: string, marker: string, createIfMissing: boolean): Promise<boolean> {
    // Octokit throws on a non-2xx response, so read/write failures propagate to the
    // caller (run-ci) rather than being mistaken for a successful or skipped post.
    const existingId = await this.findExistingComment(marker);
    if (existingId !== null) {
      await this.octokit.rest.issues.updateComment({
        owner: this.owner,
        repo: this.repo,
        comment_id: existingId,
        body,
      });
      return true;
    } else if (createIfMissing) {
      await this.octokit.rest.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: this.prNumber,
        body,
      });
      return true;
    }
    return false;
  }

  fail(message: string): void {
    core.setFailed(message);
  }

  /**
   * Find our existing Polder comment by scanning every page of the PR's issue
   * comments. A single 100-comment page can miss our marker on a busy PR and post a
   * duplicate, so we walk pages until one comes back short (capped at
   * MAX_COMMENT_PAGES so a misbehaving API can't loop forever). Octokit throws on a
   * non-2xx response, so a transient list error propagates rather than masquerading
   * as "no existing comment" (which would duplicate-post), matching the AzDO path.
   */
  private async findExistingComment(marker: string): Promise<number | null> {
    const mine: number[] = [];
    for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
      const { data: comments } = await this.octokit.rest.issues.listComments({
        owner: this.owner,
        repo: this.repo,
        issue_number: this.prNumber,
        per_page: COMMENTS_PER_PAGE,
        page,
      });
      for (const c of comments) {
        if (c.body?.includes(marker)) mine.push(c.id);
      }
      if (comments.length < COMMENTS_PER_PAGE) break;
    }
    return mine.length > 0 ? mine[mine.length - 1] : null;
  }
}
