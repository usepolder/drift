/**
 * `polder-drift ci` — post the drift comment from inside a CI PR build.
 * v1 targets Azure DevOps (GitHub uses the Action). Local runs should use `scan`.
 */
import { detectPlatform } from '../platforms/detect';
import { AzdoPlatform } from '../platforms/azdo';
import { runCi } from '../run-ci';

export async function runCiSubcommand(_argv: string[]): Promise<number> {
  const warn = (m: string): void => {
    process.stderr.write(m + '\n');
  };
  const platform = detectPlatform();

  if (platform === 'github') {
    warn('polder-drift ci: on GitHub, use the Action (`uses: usepolder/drift@v1`) instead of `ci`.');
    return 2;
  }
  if (platform !== 'azdo') {
    warn('polder-drift ci: no supported CI detected (expected Azure DevOps). For local checks use `polder-drift scan`.');
    return 2;
  }

  const azdo = AzdoPlatform.fromEnv(process.env, warn);
  if (!azdo) {
    warn('polder-drift ci: missing Azure DevOps PR variables (run this in a pull-request build validation).');
    return 2;
  }

  const res = await runCi(azdo, { warn });
  if (res.status === 'no-config') return 0;
  process.stdout.write(
    `Polder Drift: ${res.newFindings} new / ${res.totalFindings} total drift signal(s)` +
      (res.adoptionPct !== undefined ? `, adoption ${res.adoptionPct.toFixed(0)}%` : '') +
      '\n',
  );
  return res.failed ? 1 : 0;
}
