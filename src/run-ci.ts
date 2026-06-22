/**
 * Shared CI runner: platform-agnostic glue between a transport and the comment core.
 * The GitHub Action entry and the `polder-drift ci` command (Azure DevOps / local)
 * both build a transport and call this. Everything here (config, DS exports,
 * suppression, base/blame readers) is host-independent.
 */
import * as fs from 'fs';
import * as path from 'path';
import { type PolderConfig } from './config';
import { resolveConfig } from './resolve-config';
import { resolveExports } from './parser';
import { analyzePr } from './comment/analyze';
import { loadSuppressions } from './comment/suppress';
import { COMMENT_MARKER } from './comment/render';
import { readBaseFile, blameIntroducingCommit, baseRefExists } from './platforms/git';
import type { PrPlatform } from './platforms/types';

export interface RunCiResult {
  status: 'no-config' | 'analyzed';
  newFindings: number;
  totalFindings: number;
  adoptionPct?: number;
  posted: boolean;
  failed: boolean;
}

function resolveDsExports(config: PolderConfig, workspace: string, warn: (m: string) => void): Set<string> {
  const nodeModules = path.join(workspace, 'node_modules');
  const dsExports = new Set<string>();
  for (const pkg of config.componentLibrary) {
    const ex = resolveExports(pkg, nodeModules);
    if (ex.size === 0) {
      warn(`Polder Drift: could not resolve exports for "${pkg}" from node_modules; run install before this step. Falling back to PascalCase heuristic.`);
    }
    for (const n of ex) dsExports.add(n);
  }
  return dsExports;
}

export async function runCi(
  platform: PrPlatform,
  opts: { warn?: (m: string) => void; failOnDriftOverride?: boolean } = {},
): Promise<RunCiResult> {
  const warn = opts.warn ?? ((m: string) => process.stderr.write(m + '\n'));
  const workspace = platform.workspace;

  let resolved;
  try {
    resolved = resolveConfig(workspace, path.join(workspace, '.polder.yml'));
  } catch (err) {
    warn(`Polder Drift: invalid .polder.yml — ${(err as Error).message}`);
    return { status: 'no-config', newFindings: 0, totalFindings: 0, posted: false, failed: false };
  }
  if (!resolved) {
    warn('Polder Drift: no .polder.yml and could not auto-detect a design system; nothing to check.');
    return { status: 'no-config', newFindings: 0, totalFindings: 0, posted: false, failed: false };
  }
  const config: PolderConfig = resolved.config;
  if (resolved.source === 'detected') {
    warn(`Polder Drift: no .polder.yml; auto-detected design system: ${config.componentLibrary.join(', ')}`);
  }

  const dsExports = resolveDsExports(config, workspace, warn);
  const suppress = loadSuppressions(workspace);
  const baseRef = platform.getBaseRef();
  const files = await platform.getChangedSourceFiles();

  // Is the base commit actually in the local clone? On a shallow checkout it often
  // isn't, in which case we cannot distinguish new from pre-existing drift.
  const baseAvailable = baseRef ? baseRefExists(workspace, baseRef) : false;
  if (baseRef && !baseAvailable) {
    warn(
      `Polder Drift: base ref "${baseRef}" is not in the local clone (shallow checkout?). ` +
        `Cannot tell new from pre-existing drift; reporting all and NOT failing on drift. ` +
        `Add "fetch-depth: 0" to your checkout step.`,
    );
  }

  const result = analyzePr({
    files,
    readCurrent: (file) => {
      try {
        return fs.readFileSync(path.join(workspace, file), 'utf8');
      } catch {
        return null;
      }
    },
    readBase: baseAvailable ? (file) => readBaseFile(workspace, baseRef!, file) : undefined,
    blame: (file) => blameIntroducingCommit(workspace, baseRef, file),
    baseAvailable,
    dsExports,
    canonicalPkgs: config.componentLibrary,
    allowlist: config.allowlist,
    suppress,
  });

  // Post a new comment only when there is reportable drift; otherwise update an
  // existing comment (to clear a prior alert) but do not create noise on a clean PR.
  await platform.upsertComment(result.body, COMMENT_MARKER, result.shouldComment);

  const failOnDrift = opts.failOnDriftOverride ?? config.failOnDrift;
  // Only fail on "new" drift when we could actually determine what's new. When the base
  // is unavailable, failing would punish PRs for pre-existing drift, so we never do.
  const failed = failOnDrift && result.baseAvailable && result.newFindings.length > 0;
  if (failed) {
    platform.fail(
      `Polder Drift: ${result.newFindings.length} new drift signal(s) introduced by this PR`,
    );
  } else if (failOnDrift && !result.baseAvailable && result.totalFindings > 0) {
    warn('Polder Drift: fail-on-drift skipped because the base ref was unavailable (see above).');
  }

  return {
    status: 'analyzed',
    newFindings: result.newFindings.length,
    totalFindings: result.totalFindings,
    adoptionPct: result.adoptionPct,
    posted: result.shouldComment,
    failed,
  };
}
