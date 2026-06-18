/**
 * Shared CI runner: platform-agnostic glue between a transport and the comment core.
 * The GitHub Action entry and the `polder-drift ci` command (Azure DevOps / local)
 * both build a transport and call this. Everything here (config, DS exports,
 * suppression, base/blame readers) is host-independent.
 */
import * as fs from 'fs';
import * as path from 'path';
import { readConfig, type PolderConfig } from './config';
import { resolveExports } from './parser';
import { analyzePr } from './comment/analyze';
import { loadSuppressions } from './comment/suppress';
import { COMMENT_MARKER } from './comment/render';
import { readBaseFile, blameIntroducingCommit } from './platforms/git';
import type { PrPlatform } from './platforms/types';

export interface RunCiResult {
  status: 'no-config' | 'analyzed';
  newFindings: number;
  totalFindings: number;
  adoptionPct?: number;
  posted: boolean;
  failed: boolean;
}

function loadConfigFromWorkspace(workspace: string): PolderConfig | null {
  try {
    return readConfig(fs.readFileSync(path.join(workspace, '.polder.yml'), 'utf8'));
  } catch {
    return null;
  }
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

  const config = loadConfigFromWorkspace(workspace);
  if (!config) {
    warn('Polder Drift: no .polder.yml found; nothing to check.');
    return { status: 'no-config', newFindings: 0, totalFindings: 0, posted: false, failed: false };
  }

  const dsExports = resolveDsExports(config, workspace, warn);
  const suppress = loadSuppressions(workspace);
  const baseRef = platform.getBaseRef();
  const files = await platform.getChangedSourceFiles();

  const result = analyzePr({
    files,
    readCurrent: (file) => {
      try {
        return fs.readFileSync(path.join(workspace, file), 'utf8');
      } catch {
        return null;
      }
    },
    readBase: baseRef ? (file) => readBaseFile(workspace, baseRef, file) : undefined,
    blame: (file) => blameIntroducingCommit(workspace, baseRef, file),
    dsExports,
    canonicalPkgs: config.componentLibrary,
    allowlist: config.allowlist,
    suppress,
  });

  // Post a new comment only when there is reportable new drift; otherwise update an
  // existing comment (to clear a prior alert) but do not create noise on a clean PR.
  await platform.upsertComment(result.body, COMMENT_MARKER, result.shouldComment);

  const failOnDrift = opts.failOnDriftOverride ?? config.failOnDrift;
  const failed = failOnDrift && result.newFindings.length > 0;
  if (failed) {
    platform.fail(
      `Polder Drift: ${result.newFindings.length} new drift signal(s) introduced by this PR`,
    );
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
