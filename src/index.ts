/**
 * GitHub Action entrypoint. Thin: build the GitHub transport, hand it to the shared
 * CI runner (which drives the platform-agnostic comment core). All detection,
 * rendering, suppression, adoption, and attribution live in the core, shared with the
 * Azure DevOps path.
 */
import * as core from '@actions/core';
import { GitHubPlatform } from './platforms/github';
import { runCi } from './run-ci';

async function run(): Promise<void> {
  const platform = GitHubPlatform.fromEnv();
  if (!platform) {
    core.warning('Polder Drift: not a pull_request event — skipping');
    return;
  }
  const result = await runCi(platform, { warn: (m) => core.warning(m) });
  if (result.status === 'analyzed') {
    core.info(
      `Polder Drift: ${result.newFindings} new / ${result.totalFindings} total drift signal(s)` +
        (result.adoptionPct !== undefined ? `, adoption ${result.adoptionPct.toFixed(0)}%` : ''),
    );
  }
}

run().catch((err: Error) => {
  core.setFailed(err.message);
});
