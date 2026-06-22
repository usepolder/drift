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

  private async findExistingComment(marker: string): Promise<number | null> {
    const { data: comments } = await this.octokit.rest.issues.listComments({
      owner: this.owner,
      repo: this.repo,
      issue_number: this.prNumber,
      per_page: 100,
    });
    const mine = comments.filter((c) => c.body?.includes(marker));
    return mine.length > 0 ? mine[mine.length - 1].id : null;
  }
}
