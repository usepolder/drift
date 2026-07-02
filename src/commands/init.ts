/**
 * `polder-drift init` — write a starter `.polder.yml`, seeded from detection when possible.
 *
 * With `--claude`, additionally wire the repo for Claude Code so drift feedback happens
 * at write time, not just review time:
 *   - a PostToolUse hook in `.claude/settings.json` that runs `polder-drift claude-hook`
 *     on every file the agent writes or edits (see commands/claude-hook.ts), and
 *   - a managed design-system section in `CLAUDE.md` naming the registered DS.
 * Both writes are idempotent: re-running refreshes the CLAUDE.md section in place and
 * never duplicates the hook.
 */
import * as fs from 'fs';
import * as path from 'path';
import { detectComponentLibrary } from '../detect';
import { readConfig } from '../config';

export const HOOK_COMMAND = 'npx -y @usepolder/drift claude-hook';
export const HOOK_MATCHER = 'Write|Edit|MultiEdit';

const HOOK_ENTRY = {
  matcher: HOOK_MATCHER,
  hooks: [{ type: 'command', command: HOOK_COMMAND }],
};
const MANUAL_SNIPPET = JSON.stringify({ hooks: { PostToolUse: [HOOK_ENTRY] } }, null, 2);

export const CLAUDE_MD_BEGIN = '<!-- polder-drift:begin -->';
export const CLAUDE_MD_END = '<!-- polder-drift:end -->';

export function runInitSubcommand(argv: string[], cwd: string = process.cwd()): number {
  let claude = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--claude') {
      claude = true;
    } else if (arg === '--cwd') {
      cwd = argv[++i] ?? '';
      if (!cwd) {
        process.stderr.write('polder-drift init: --cwd requires a path\n');
        return 2;
      }
    } else {
      process.stderr.write(`polder-drift init: unknown option: ${arg}\n`);
      return 2;
    }
  }

  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    process.stderr.write(`polder-drift init: --cwd ${cwd} is not a directory\n`);
    return 2;
  }

  const target = path.join(cwd, '.polder.yml');
  let libs: string[];

  if (fs.existsSync(target)) {
    if (!claude) {
      process.stderr.write('polder-drift init: .polder.yml already exists; leaving it untouched.\n');
      return 1;
    }
    // --claude on a configured repo: keep the config, but the CLAUDE.md section
    // still needs the DS names from it.
    let config;
    try {
      config = readConfig(fs.readFileSync(target, 'utf8'));
    } catch (err) {
      process.stderr.write(`polder-drift init: invalid .polder.yml — ${(err as Error).message}\n`);
      return 2;
    }
    libs = config && config.componentLibrary.length > 0 ? config.componentLibrary : ['@your-org/design-system'];
    process.stdout.write('polder-drift init: .polder.yml already exists; leaving it untouched.\n');
  } else {
    const det = detectComponentLibrary(cwd);
    libs = det.libraries.length > 0 ? det.libraries : ['@your-org/design-system'];

    const libYaml =
      libs.length === 1
        ? `component_library: "${libs[0]}"`
        : `component_library:\n${libs.map((l) => `  - "${l}"`).join('\n')}`;
    const content = `${libYaml}\nallowlist: []\nfail_on_drift: false\n`;

    fs.writeFileSync(target, content);
    if (det.source === 'detected') {
      process.stdout.write(`polder-drift init: wrote .polder.yml (detected ${libs.join(', ')}).\n`);
    } else {
      process.stdout.write('polder-drift init: wrote .polder.yml — edit component_library to your design system package.\n');
    }
  }

  if (!claude) return 0;

  const hookCode = installClaudeHook(cwd);
  if (hookCode !== 0) return hookCode;
  return writeClaudeMdSection(cwd, libs);
}

// ── .claude/settings.json ───────────────────────────────────────────────────────

function bailSettings(reason: string): number {
  process.stderr.write(
    `polder-drift init: ${reason}; left untouched. Add the hook to .claude/settings.json manually:\n${MANUAL_SNIPPET}\n`,
  );
  return 1;
}

function hookAlreadyInstalled(entries: unknown[]): boolean {
  for (const entry of entries) {
    const hooks = (entry as { hooks?: unknown } | null)?.hooks;
    if (!Array.isArray(hooks)) continue;
    for (const h of hooks) {
      const cmd = (h as { command?: unknown } | null)?.command;
      if (typeof cmd === 'string' && /(@usepolder\/drift|polder-drift) claude-hook/.test(cmd)) return true;
    }
  }
  return false;
}

function installClaudeHook(cwd: string): number {
  const settingsPath = path.join(cwd, '.claude', 'settings.json');

  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      return bailSettings('.claude/settings.json is not valid JSON');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return bailSettings('.claude/settings.json is not a JSON object');
    }
    settings = parsed as Record<string, unknown>;
  }

  const hooks = settings.hooks ?? {};
  if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) {
    return bailSettings('"hooks" in .claude/settings.json is not an object');
  }
  const post = (hooks as Record<string, unknown>).PostToolUse ?? [];
  if (!Array.isArray(post)) {
    return bailSettings('"hooks.PostToolUse" in .claude/settings.json is not an array');
  }

  if (hookAlreadyInstalled(post)) {
    process.stdout.write('polder-drift init: Claude Code hook already installed in .claude/settings.json.\n');
    return 0;
  }

  post.push(HOOK_ENTRY);
  (hooks as Record<string, unknown>).PostToolUse = post;
  settings.hooks = hooks;

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  process.stdout.write('polder-drift init: installed the Claude Code hook in .claude/settings.json.\n');
  return 0;
}

// ── CLAUDE.md ───────────────────────────────────────────────────────────────────

function claudeMdSection(libs: string[]): string {
  const dsList = libs.map((l) => `\`${l}\``).join(', ');
  return `${CLAUDE_MD_BEGIN}
## Design system

This repo registers ${dsList} as its design system; polder-drift flags code that
bypasses it. A PostToolUse hook scans every file you write or edit — when it reports
drift, fix the drift before moving on.

- Import UI components from ${dsList} instead of copying them into the repo or
  importing them from local paths.
- Don't re-implement components the design system already exports, and don't hardcode
  its design-token values (theme colors, class prefixes) in component code.
- Check a file yourself with \`npx @usepolder/drift scan --json <file>\`.
- If a finding is intentional, it can be suppressed by id in \`.polderignore\` — ask the
  user before suppressing anything.
${CLAUDE_MD_END}`;
}

function writeClaudeMdSection(cwd: string, libs: string[]): number {
  const file = path.join(cwd, 'CLAUDE.md');
  const section = claudeMdSection(libs);

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, section + '\n');
    process.stdout.write('polder-drift init: wrote the design-system section to CLAUDE.md.\n');
    return 0;
  }

  const content = fs.readFileSync(file, 'utf8');
  const begin = content.indexOf(CLAUDE_MD_BEGIN);
  const end = content.indexOf(CLAUDE_MD_END);

  if (begin !== -1 && end > begin) {
    // Managed section present — refresh it in place, leaving the rest of the file alone.
    const updated = content.slice(0, begin) + section + content.slice(end + CLAUDE_MD_END.length);
    if (updated === content) {
      process.stdout.write('polder-drift init: CLAUDE.md design-system section already up to date.\n');
    } else {
      fs.writeFileSync(file, updated);
      process.stdout.write('polder-drift init: refreshed the design-system section in CLAUDE.md.\n');
    }
    return 0;
  }

  if (begin !== -1 || end !== -1) {
    process.stderr.write(
      'polder-drift init: CLAUDE.md has a broken polder-drift marker pair; fix or remove ' +
        `the ${CLAUDE_MD_BEGIN} / ${CLAUDE_MD_END} lines and re-run.\n`,
    );
    return 1;
  }

  fs.writeFileSync(file, content.trimEnd() + '\n\n' + section + '\n');
  process.stdout.write('polder-drift init: appended the design-system section to CLAUDE.md.\n');
  return 0;
}
