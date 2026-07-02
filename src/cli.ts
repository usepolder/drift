#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { type PolderConfig } from './config';
import { resolveConfig, type ResolvedConfig } from './resolve-config';
import { resolveExports, checkDriftFull, type FullDriftResult } from './parser';
import { flattenFindings, RULE_LABEL, type Finding } from './comment/findings';
import { loadSuppressions, applySuppressions, type SuppressRules } from './comment/suppress';
import { buildDetectionProfile } from './profiles';
import { runInitSubcommand } from './commands/init';

// ── Types ──────────────────────────────────────────────────────────────────────

export type DiscoveryMode = 'diff' | 'all' | 'explicit';

export interface CliOptions {
  json: boolean;
  configPath: string;
  cwd: string;
  mode: DiscoveryMode;
  diffBase: string | null; // ref to diff against; null = staged + unstaged working changes
  paths: string[];         // explicit file paths (mode === 'explicit')
  failOnDrift: boolean | null; // null = inherit from config
  help: boolean;
}

/**
 * One normalised finding, same id/severity the PR comment shows. The id is what a
 * `.polderignore` line suppresses, so the CLI is where you discover it locally.
 */
export interface CliFinding {
  id: string;
  rule: Finding['rule'];
  severity: Finding['severity'];
  title: string;
  detail: string;
}

export interface CliFileReport {
  filename: string;
  totalCount: number;
  findings: CliFinding[];
  importDrift: FullDriftResult['importDrift'];
  inlineDrift: FullDriftResult['inlineDrift'];
}

export interface CliReport {
  version: 1;
  config: { componentLibrary: string[]; allowlist: string[]; failOnDrift: boolean };
  summary: {
    filesAnalyzed: number;
    filesWithDrift: number;
    totalSignals: number;
    /** Findings hidden by `.polderignore` — kept visible so a quiet scan is explainable. */
    suppressedSignals: number;
  };
  files: CliFileReport[];
}

const SOURCE_RE = /\.(ts|tsx|js|jsx)$/;

const TOP_HELP = `polder-drift — design system drift detection

Usage:
  polder-drift <command> [options]

Commands:
  scan [options] [files...]   Analyse files for design system drift (default work)
  ci                          Post the drift comment from a CI PR build (Azure DevOps)
  init                        Write a starter .polder.yml (auto-detects your design system)
  -h, --help                  Show this help

Examples:
  polder-drift scan --all
  polder-drift scan --diff origin/main --json
  polder-drift scan src/Button.tsx

Run "polder-drift scan --help" for scan options.
`;

const HELP = `polder-drift scan — design system drift detection

Usage:
  polder-drift scan [options] [files...]

Discovery (pick one; defaults to --diff):
  --diff [ref]      Analyse files changed vs <ref>. With no ref, analyses
                    staged + unstaged working-tree changes. (default)
  --all             Analyse every tracked source file in the repo.
  [files...]        Analyse the given file paths explicitly.

Output:
  --json            Emit a machine-readable JSON report on stdout.
  (default)         Human-readable summary on stdout.

Options:
  --config <path>   Path to .polder.yml (default: <cwd>/.polder.yml).
  --cwd <dir>       Working directory / repo root (default: process.cwd()).
  --fail-on-drift   Exit 1 if any drift is found (overrides config).
  --no-fail         Never exit non-zero on drift (overrides config).
  -h, --help        Show this help.

Exit codes:
  0  no drift, or drift found but fail-on-drift disabled
  1  drift found and fail-on-drift enabled
  2  configuration or usage error
`;

// ── Argument parsing ────────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    json: false,
    configPath: '',
    cwd: process.cwd(),
    mode: 'diff',
    diffBase: null,
    paths: [],
    failOnDrift: null,
    help: false,
  };

  let modeExplicitlySet = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--config':
        opts.configPath = argv[++i] ?? '';
        if (!opts.configPath) throw new UsageError('--config requires a path');
        break;
      case '--cwd':
        opts.cwd = argv[++i] ?? '';
        if (!opts.cwd) throw new UsageError('--cwd requires a path');
        break;
      case '--fail-on-drift':
        opts.failOnDrift = true;
        break;
      case '--no-fail':
        opts.failOnDrift = false;
        break;
      case '--all':
        opts.mode = 'all';
        modeExplicitlySet = true;
        break;
      case '--diff': {
        opts.mode = 'diff';
        modeExplicitlySet = true;
        // An optional, non-flag token immediately after --diff is the base ref.
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
          opts.diffBase = next;
          i++;
        }
        break;
      }
      default:
        if (arg.startsWith('-')) throw new UsageError(`unknown option: ${arg}`);
        opts.paths.push(arg);
        if (!modeExplicitlySet) opts.mode = 'explicit';
        break;
    }
  }

  if (opts.paths.length > 0 && !modeExplicitlySet) opts.mode = 'explicit';
  if (!opts.configPath) opts.configPath = path.join(opts.cwd, '.polder.yml');
  return opts;
}

export class UsageError extends Error {}

// ── File discovery ──────────────────────────────────────────────────────────────

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

export function discoverFiles(opts: CliOptions): string[] {
  if (opts.mode === 'explicit') {
    return opts.paths.filter((p) => SOURCE_RE.test(p));
  }

  let names: string[];
  try {
    if (opts.mode === 'all') {
      names = git(opts.cwd, ['ls-files']).split('\n');
    } else if (opts.diffBase) {
      names = git(opts.cwd, ['diff', '--name-only', '--diff-filter=d', opts.diffBase]).split('\n');
    } else {
      // staged + unstaged working-tree changes, plus untracked files
      const staged = git(opts.cwd, ['diff', '--name-only', '--cached', '--diff-filter=d']);
      const unstaged = git(opts.cwd, ['diff', '--name-only', '--diff-filter=d']);
      const untracked = git(opts.cwd, ['ls-files', '--others', '--exclude-standard']);
      names = `${staged}\n${unstaged}\n${untracked}`.split('\n');
    }
  } catch (err) {
    throw new UsageError(
      `git file discovery failed (is "${opts.cwd}" a git repository?): ${(err as Error).message}`,
    );
  }

  const unique = new Set<string>();
  for (const n of names) {
    const trimmed = n.trim();
    if (trimmed && SOURCE_RE.test(trimmed)) unique.add(trimmed);
  }
  return [...unique].sort();
}

// ── Analysis ────────────────────────────────────────────────────────────────────

function resolveDsExports(config: PolderConfig, cwd: string): Set<string> {
  const nodeModulesDir = path.join(cwd, 'node_modules');
  const dsExports = new Set<string>();
  for (const pkg of config.componentLibrary) {
    const pkgExports = resolveExports(pkg, nodeModulesDir);
    if (pkgExports.size === 0) {
      process.stderr.write(
        `polder-drift: could not resolve exports for "${pkg}" from node_modules. ` +
          `Run your install step first. Falling back to PascalCase heuristic.\n`,
      );
    }
    for (const name of pkgExports) dsExports.add(name);
  }
  return dsExports;
}

export function buildReport(
  config: PolderConfig,
  cwd: string,
  files: string[],
  effectiveFailOnDrift: boolean,
  suppress?: SuppressRules,
): CliReport {
  // Same `.polderignore` the CI comment honours — a locally-clean scan must mean a
  // clean PR comment, so the CLI cannot skip suppression.
  const rules = suppress ?? loadSuppressions(cwd);
  const dsExports = resolveDsExports(config, cwd);
  // Built once per run: built-in data for the configured DS packages plus any custom
  // tokens/signatures from .polder.yml (PolderConfig extends CustomDetection).
  const profile = buildDetectionProfile(config.componentLibrary, config);
  const fileReports: CliFileReport[] = [];
  let suppressedSignals = 0;

  for (const filename of files) {
    const filePath = path.isAbsolute(filename) ? filename : path.join(cwd, filename);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      process.stderr.write(`polder-drift: could not read ${filename} — skipping\n`);
      continue;
    }
    const result = checkDriftFull(
      content,
      dsExports,
      config.componentLibrary,
      config.allowlist,
      filename,
      profile,
    );

    const all = flattenFindings(filename, result);
    const kept = applySuppressions(all, rules);
    suppressedSignals += all.length - kept.length;

    // Filter the raw engine shapes down to what survived suppression, so the JSON
    // report never disagrees with the findings list. Every rule keys on the same
    // (rule, key) pair flattenFindings used.
    const keep = new Set(kept.map((f) => `${f.rule}|${f.key}`));
    const importSymbols = result.importDrift.symbols.filter((s) => keep.has(`import-drift|${s}`));
    fileReports.push({
      filename,
      totalCount: kept.length,
      findings: kept.map(({ id, rule, severity, title, detail }) => ({ id, rule, severity, title, detail })),
      importDrift: { symbols: importSymbols, count: importSymbols.length },
      inlineDrift: {
        localShadows: result.inlineDrift.localShadows.filter((n) => keep.has(`local-shadow|${n}`)),
        tokenFingerprints: result.inlineDrift.tokenFingerprints.filter((fp) =>
          keep.has(`token-fingerprint|${fp.componentName}`),
        ),
        propMatches: result.inlineDrift.propMatches.filter((pm) => keep.has(`prop-match|${pm.componentName}`)),
        subComponentMatches: result.inlineDrift.subComponentMatches.filter((sm) =>
          keep.has(`subcomponent|${sm.componentName}`),
        ),
      },
    });
  }

  const totalSignals = fileReports.reduce((s, r) => s + r.totalCount, 0);
  const filesWithDrift = fileReports.filter((r) => r.totalCount > 0).length;

  return {
    version: 1,
    config: {
      componentLibrary: config.componentLibrary,
      allowlist: config.allowlist,
      failOnDrift: effectiveFailOnDrift,
    },
    summary: { filesAnalyzed: fileReports.length, filesWithDrift, totalSignals, suppressedSignals },
    files: fileReports,
  };
}

// ── Human-readable formatting ────────────────────────────────────────────────────

export function formatHuman(report: CliReport): string {
  const { summary } = report;
  const lines: string[] = [];
  const suppressedNote =
    summary.suppressedSignals > 0 ? ` (${summary.suppressedSignals} suppressed via .polderignore)` : '';

  if (summary.totalSignals === 0) {
    lines.push(
      `✓ No design system drift detected across ${summary.filesAnalyzed} file(s).${suppressedNote}`,
    );
    return lines.join('\n');
  }

  lines.push(
    `⚠ ${summary.totalSignals} drift signal(s) across ${summary.filesWithDrift} of ` +
      `${summary.filesAnalyzed} file(s) analysed.${suppressedNote}`,
  );
  lines.push('');

  for (const f of report.files) {
    if (f.totalCount === 0) continue;
    lines.push(`${f.filename}`);

    // The trailing [id] is the `.polderignore` handle for the finding.
    for (const finding of f.findings) {
      const label = RULE_LABEL[finding.rule].toLowerCase().padEnd(18);
      lines.push(`  ${label}${finding.title} (${finding.detail}) [${finding.id}]`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

// ── Subcommand dispatch ─────────────────────────────────────────────────────────

// Reserved subcommand names. `ci` is built; `mcp`, `telemetry`, and `init` are reserved
// now so the surface is stable and are built in later phases. To scan a file literally
// named like a subcommand, use `polder-drift scan <file>` (scan takes paths explicitly).
const RESERVED_SUBCOMMANDS = new Set(['scan', 'ci', 'mcp', 'telemetry', 'init']);

export function runCli(argv: string[]): number {
  const first = argv[0];

  if (first === undefined || first === '-h' || first === '--help') {
    process.stdout.write(TOP_HELP);
    return 0;
  }

  if (first === 'scan') {
    return runScan(argv.slice(1));
  }

  if (first === 'ci') {
    // `ci` is async (posts a PR comment). The module entrypoint routes it to
    // runCiSubcommand before reaching here; this guard only fires on direct calls.
    process.stderr.write("polder-drift: 'ci' runs as the process entrypoint, not via runCli().\n");
    return 2;
  }

  if (first === 'init') {
    return runInitSubcommand(argv.slice(1));
  }

  if (first === 'mcp' || first === 'telemetry') {
    process.stderr.write(`polder-drift: '${first}' is not available yet.\n`);
    return 2;
  }

  // Anything else is an unknown command. Point file/flag-shaped input at `scan`.
  if (first.startsWith('-') || SOURCE_RE.test(first)) {
    process.stderr.write(
      `polder-drift: scanning now requires the 'scan' command. ` +
        `Try: polder-drift scan ${argv.join(' ')}\n`,
    );
  } else {
    process.stderr.write(
      `polder-drift: unknown command '${first}'. ` +
        `Valid commands: ${[...RESERVED_SUBCOMMANDS].join(', ')}. See --help.\n`,
    );
  }
  return 2;
}

// ── scan ────────────────────────────────────────────────────────────────────────

export function runScan(argv: string[]): number {
  let opts: CliOptions;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`polder-drift: ${(err as Error).message}\n\n${HELP}`);
    return 2;
  }

  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }

  let resolved: ResolvedConfig | null;
  try {
    resolved = resolveConfig(opts.cwd, opts.configPath);
  } catch (err) {
    process.stderr.write(`polder-drift: invalid .polder.yml — ${(err as Error).message}\n`);
    return 2;
  }
  if (!resolved) {
    process.stderr.write(
      `polder-drift: no .polder.yml at ${opts.configPath} and could not auto-detect a ` +
        `design system from package.json. Run \`polder-drift init\`, or create a .polder.yml:\n` +
        `  component_library: "@your-org/design-system"\n`,
    );
    return 2;
  }
  const config = resolved.config;
  if (resolved.source === 'detected') {
    process.stderr.write(
      `polder-drift: no .polder.yml; auto-detected design system: ${config.componentLibrary.join(', ')}\n`,
    );
  }

  let files: string[];
  try {
    files = discoverFiles(opts);
  } catch (err) {
    process.stderr.write(`polder-drift: ${(err as Error).message}\n`);
    return 2;
  }

  const effectiveFailOnDrift = opts.failOnDrift ?? config.failOnDrift;
  const report = buildReport(config, opts.cwd, files, effectiveFailOnDrift);

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(formatHuman(report) + '\n');
  }

  return effectiveFailOnDrift && report.summary.totalSignals > 0 ? 1 : 0;
}

/* istanbul ignore next */
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === 'ci') {
    // Async command (posts a PR comment); lazy-import to keep `scan` startup light.
    import('./commands/ci')
      .then(({ runCiSubcommand }) => runCiSubcommand(argv.slice(1)))
      .then((code) => process.exit(code))
      .catch((err: Error) => {
        process.stderr.write(`polder-drift: ${err.message}\n`);
        process.exit(2);
      });
  } else {
    process.exit(runCli(argv));
  }
}
