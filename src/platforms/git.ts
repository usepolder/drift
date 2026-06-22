/**
 * Local git helpers shared by transports (Azure DevOps uses these directly since the
 * pipeline checks out the repo; GitHub uses them best-effort for base content).
 * All failures degrade to null/empty so a missing base ref never breaks a run.
 */
import { execFileSync } from 'child_process';

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/** True if the base ref resolves to a commit in the local clone. */
export function baseRefExists(cwd: string, baseRef: string): boolean {
  return git(cwd, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]) !== null;
}

/** Base-branch version of a file (for "new in this PR" diffing). */
export function readBaseFile(cwd: string, baseRef: string, file: string): string | null {
  return git(cwd, ['show', `${baseRef}:${file}`]);
}

/** Commit that introduced this file's current state within the PR range (best effort). */
export function blameIntroducingCommit(cwd: string, baseRef: string | null, file: string): string | undefined {
  const range = baseRef ? [`${baseRef}..HEAD`] : [];
  const out = git(cwd, ['log', '-n', '1', '--format=%H', ...range, '--', file])?.trim();
  if (out) return out;
  if (baseRef) {
    const fallback = git(cwd, ['log', '-n', '1', '--format=%H', '--', file])?.trim();
    if (fallback) return fallback;
  }
  return undefined;
}

/** Source files changed in this PR vs its base (three-dot = changes since merge-base). */
export function diffChangedFiles(cwd: string, baseRef: string): string[] {
  const out = git(cwd, ['diff', '--name-only', '--diff-filter=d', `${baseRef}...HEAD`]);
  if (out == null) return [];
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}
