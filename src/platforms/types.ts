/**
 * Platform transport interface. The comment core is platform-agnostic; a transport
 * is the thin layer that (1) tells us which files the PR changed and (2) upserts the
 * rendered comment. GitHub (Octokit) and Azure DevOps (threads REST API) each
 * implement this; adding GitLab later is one more implementation, not a fork.
 */
export interface PrPlatform {
  readonly name: 'github' | 'azdo';

  /** Repo root / checkout path where source files live. */
  readonly workspace: string;

  /** Source files (.ts/.tsx/.js/.jsx) changed by this PR. */
  getChangedSourceFiles(): Promise<string[]>;

  /** The base ref this PR targets (e.g. "main"), used for adoption/attribution. */
  getBaseRef(): string | null;

  /**
   * Create or update the single Polder Drift comment, identified by `marker`.
   * When `createIfMissing` is false, only an existing comment is updated (used to
   * clear a prior alert when a PR is now healthy, without posting a fresh comment).
   */
  upsertComment(body: string, marker: string, createIfMissing: boolean): Promise<void>;

  /** Mark the run failed (failed check / nonzero exit) when fail-on-drift is set. */
  fail(message: string): void;
}
