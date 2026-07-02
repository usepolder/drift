/**
 * `polder-drift claude-hook` — the Claude Code PostToolUse hook entrypoint.
 *
 * Claude Code pipes a JSON payload on stdin after every matched tool call. We scan
 * just the file the agent touched and, when it drifts, exit 2 with the findings on
 * stderr — the one PostToolUse exit code whose stderr is fed back to Claude — so the
 * agent fixes the drift in the same turn instead of shipping it to the PR.
 *
 * Anything that is not actionable drift must stay quiet (exit 0): a hook that
 * complains on every edit gets deleted. The single exception is a broken
 * `.polder.yml` (exit 1 — non-blocking, surfaced to the user, invisible to Claude).
 *
 * Installed by `polder-drift init --claude`; see docs/howto-claude-code.md.
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveConfig, type ResolvedConfig } from '../resolve-config';
import { buildReport, SOURCE_RE } from '../cli';
import { RULE_LABEL } from '../comment/findings';

interface HookPayload {
  cwd?: unknown;
  tool_input?: { file_path?: unknown };
}

export function runClaudeHookSubcommand(payloadText?: string): number {
  let raw: string;
  if (payloadText !== undefined) {
    raw = payloadText;
  } else {
    try {
      raw = fs.readFileSync(0, 'utf8'); // the PostToolUse payload arrives on stdin
    } catch {
      return 0;
    }
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(raw) as HookPayload;
  } catch {
    return 0;
  }

  const filePath = payload?.tool_input?.file_path;
  if (typeof filePath !== 'string' || !SOURCE_RE.test(filePath)) return 0;
  const cwd = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : process.cwd();

  let resolved: ResolvedConfig | null;
  try {
    resolved = resolveConfig(cwd, path.join(cwd, '.polder.yml'));
  } catch (err) {
    process.stderr.write(`polder-drift claude-hook: invalid .polder.yml — ${(err as Error).message}\n`);
    return 1;
  }
  if (!resolved) return 0; // no design system registered or detectable — nothing to check

  const rel = path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath;
  if (rel.startsWith('..') || path.isAbsolute(rel)) return 0; // outside the project
  if (!fs.existsSync(path.join(cwd, rel))) return 0; // moved or deleted since the edit

  const report = buildReport(resolved.config, cwd, [rel], false);
  if (report.summary.totalSignals === 0) return 0;

  const lines = [`polder-drift: design system drift in ${rel}:`];
  for (const file of report.files) {
    for (const finding of file.findings) {
      const gutter = (finding.line !== undefined ? `:${finding.line}` : '').padEnd(6);
      const label = RULE_LABEL[finding.rule].toLowerCase().padEnd(18);
      lines.push(`  ${gutter}${label}${finding.title} — ${finding.detail}`);
    }
  }
  lines.push(
    `Use ${resolved.config.componentLibrary.join(', ')} instead of local copies, ` +
      `look-alikes, or hardcoded tokens. If a finding is intentional, ask the user ` +
      `to suppress its id in .polderignore.`,
  );
  process.stderr.write(lines.join('\n') + '\n');
  return 2;
}
