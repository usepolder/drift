/** Detect the CI host from environment variables. */
export type PlatformKind = 'github' | 'azdo' | null;

export function detectPlatform(env: NodeJS.ProcessEnv = process.env): PlatformKind {
  if (env.GITHUB_ACTIONS === 'true') return 'github';
  // Azure DevOps sets TF_BUILD=True and a family of SYSTEM_*/BUILD_* vars.
  if (env.TF_BUILD || env.SYSTEM_COLLECTIONURI) return 'azdo';
  return null;
}
