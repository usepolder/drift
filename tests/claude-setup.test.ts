/**
 * Coverage for the Claude Code integration: `init --claude` (settings.json hook +
 * managed CLAUDE.md section) and the `claude-hook` PostToolUse entrypoint. The hook's
 * contract is asymmetric on purpose — loud (exit 2, stderr) only on real drift, silent
 * (exit 0) on everything else — because a hook that errors on every edit gets deleted.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runInitSubcommand, HOOK_MATCHER, CLAUDE_MD_BEGIN } from '../src/commands/init';
import { runClaudeHookSubcommand } from '../src/commands/claude-hook';
import { runCli } from '../src/cli';

const DRIFT = `import { Button } from './ui/Button';\nexport const X = () => <Button />;\n`;
const CLEAN = 'export const x = 1;\n';
const CONFIG = 'component_library: "@acme/ds"\n';

function capture(fn: () => number): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c: any) => {
    out += String(c);
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((c: any) => {
    err += String(c);
    return true;
  });
  try {
    const code = fn();
    return { code, out, err };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

function withRepo(files: Record<string, string>, fn: (cwd: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polder-claude-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function payload(cwd: string, filePath: string): string {
  return JSON.stringify({
    hook_event_name: 'PostToolUse',
    cwd,
    tool_name: 'Write',
    tool_input: { file_path: filePath },
  });
}

afterEach(() => vi.restoreAllMocks());

// ── claude-hook ─────────────────────────────────────────────────────────────────

describe('claude-hook', () => {
  it('drift in the touched file → exit 2 with findings on stderr', () => {
    withRepo({ '.polder.yml': CONFIG, 'drift.tsx': DRIFT }, (cwd) => {
      const { code, err } = capture(() =>
        runClaudeHookSubcommand(payload(cwd, path.join(cwd, 'drift.tsx'))),
      );
      expect(code).toBe(2);
      expect(err).toContain('design system drift in drift.tsx');
      expect(err).toContain('import drift');
      expect(err).toContain('@acme/ds');
      expect(err).toContain('.polderignore');
    });
  });

  it('clean file → exit 0', () => {
    withRepo({ '.polder.yml': CONFIG, 'clean.tsx': CLEAN }, (cwd) => {
      const { code } = capture(() =>
        runClaudeHookSubcommand(payload(cwd, path.join(cwd, 'clean.tsx'))),
      );
      expect(code).toBe(0);
    });
  });

  it('non-source file → exit 0, no scan', () => {
    withRepo({ '.polder.yml': CONFIG, 'README.md': '# hi\n' }, (cwd) => {
      const { code, err } = capture(() =>
        runClaudeHookSubcommand(payload(cwd, path.join(cwd, 'README.md'))),
      );
      expect(code).toBe(0);
      expect(err).toBe('');
    });
  });

  it('no config and no detectable DS → exit 0 (never nags unconfigured repos)', () => {
    withRepo({ 'drift.tsx': DRIFT }, (cwd) => {
      const { code, err } = capture(() =>
        runClaudeHookSubcommand(payload(cwd, path.join(cwd, 'drift.tsx'))),
      );
      expect(code).toBe(0);
      expect(err).toBe('');
    });
  });

  it('malformed payload → exit 0', () => {
    const { code, err } = capture(() => runClaudeHookSubcommand('not json'));
    expect(code).toBe(0);
    expect(err).toBe('');
  });

  it('file outside the project → exit 0', () => {
    withRepo({ '.polder.yml': CONFIG }, (cwd) => {
      const { code } = capture(() => runClaudeHookSubcommand(payload(cwd, '/elsewhere/x.tsx')));
      expect(code).toBe(0);
    });
  });

  it('deleted file → exit 0', () => {
    withRepo({ '.polder.yml': CONFIG }, (cwd) => {
      const { code } = capture(() =>
        runClaudeHookSubcommand(payload(cwd, path.join(cwd, 'ghost.tsx'))),
      );
      expect(code).toBe(0);
    });
  });

  it('.polderignore suppression is honoured → exit 0', () => {
    withRepo(
      { '.polder.yml': CONFIG, '.polderignore': 'rule:import-drift\n', 'drift.tsx': DRIFT },
      (cwd) => {
        const { code } = capture(() =>
          runClaudeHookSubcommand(payload(cwd, path.join(cwd, 'drift.tsx'))),
        );
        expect(code).toBe(0);
      },
    );
  });

  it('invalid .polder.yml → exit 1 (non-blocking, surfaced to the user)', () => {
    withRepo({ '.polder.yml': 'component_library: [unclosed\n', 'a.tsx': CLEAN }, (cwd) => {
      const { code, err } = capture(() =>
        runClaudeHookSubcommand(payload(cwd, path.join(cwd, 'a.tsx'))),
      );
      expect(code).toBe(1);
      expect(err).toContain('invalid .polder.yml');
    });
  });

  it('runCli treats claude-hook as entrypoint-only, like ci', () => {
    const { code, err } = capture(() => runCli(['claude-hook']));
    expect(code).toBe(2);
    expect(err).toContain('process entrypoint');
  });
});

// ── init --claude ───────────────────────────────────────────────────────────────

describe('init --claude', () => {
  it('fresh repo: writes .polder.yml, the settings.json hook, and CLAUDE.md', () => {
    withRepo(
      { 'package.json': JSON.stringify({ dependencies: { '@mui/material': '^5' } }) },
      (cwd) => {
        const { code } = capture(() => runInitSubcommand(['--claude'], cwd));
        expect(code).toBe(0);

        expect(fs.readFileSync(path.join(cwd, '.polder.yml'), 'utf8')).toContain('@mui/material');

        const settings = JSON.parse(fs.readFileSync(path.join(cwd, '.claude/settings.json'), 'utf8'));
        expect(settings.hooks.PostToolUse).toHaveLength(1);
        expect(settings.hooks.PostToolUse[0].matcher).toBe(HOOK_MATCHER);
        expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain('claude-hook');

        const md = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8');
        expect(md).toContain(CLAUDE_MD_BEGIN);
        expect(md).toContain('@mui/material');
      },
    );
  });

  it('is idempotent: re-running never duplicates the hook or the CLAUDE.md section', () => {
    withRepo({ '.polder.yml': CONFIG }, (cwd) => {
      expect(capture(() => runInitSubcommand(['--claude'], cwd)).code).toBe(0);
      expect(capture(() => runInitSubcommand(['--claude'], cwd)).code).toBe(0);

      const settings = JSON.parse(fs.readFileSync(path.join(cwd, '.claude/settings.json'), 'utf8'));
      expect(settings.hooks.PostToolUse).toHaveLength(1);

      const md = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8');
      expect(md.split(CLAUDE_MD_BEGIN)).toHaveLength(2); // marker appears exactly once
    });
  });

  it('merges into existing settings.json without clobbering other hooks or keys', () => {
    const existing = {
      permissions: { allow: ['Bash(npm test)'] },
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }],
        PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo post' }] }],
      },
    };
    withRepo(
      { '.polder.yml': CONFIG, '.claude/settings.json': JSON.stringify(existing, null, 2) },
      (cwd) => {
        const { code } = capture(() => runInitSubcommand(['--claude'], cwd));
        expect(code).toBe(0);

        const settings = JSON.parse(fs.readFileSync(path.join(cwd, '.claude/settings.json'), 'utf8'));
        expect(settings.permissions).toEqual(existing.permissions);
        expect(settings.hooks.PreToolUse).toEqual(existing.hooks.PreToolUse);
        expect(settings.hooks.PostToolUse).toHaveLength(2);
        expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe('echo post');
        expect(settings.hooks.PostToolUse[1].hooks[0].command).toContain('claude-hook');
      },
    );
  });

  it('appends to an existing CLAUDE.md and refreshes the section when the DS changes', () => {
    withRepo({ '.polder.yml': CONFIG, 'CLAUDE.md': '# My project\n\nHand-written notes.\n' }, (cwd) => {
      capture(() => runInitSubcommand(['--claude'], cwd));
      let md = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8');
      expect(md).toContain('Hand-written notes.');
      expect(md).toContain('@acme/ds');

      // DS renamed → re-run refreshes the managed section in place.
      fs.writeFileSync(path.join(cwd, '.polder.yml'), 'component_library: "@acme/new-ds"\n');
      capture(() => runInitSubcommand(['--claude'], cwd));
      md = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8');
      expect(md).toContain('Hand-written notes.');
      expect(md).toContain('@acme/new-ds');
      expect(md).not.toContain('`@acme/ds`');
      expect(md.split(CLAUDE_MD_BEGIN)).toHaveLength(2);
    });
  });

  it('invalid settings.json is left untouched, exit 1 with a manual snippet', () => {
    withRepo({ '.polder.yml': CONFIG, '.claude/settings.json': '{ not json' }, (cwd) => {
      const { code, err } = capture(() => runInitSubcommand(['--claude'], cwd));
      expect(code).toBe(1);
      expect(err).toContain('not valid JSON');
      expect(err).toContain('PostToolUse');
      expect(fs.readFileSync(path.join(cwd, '.claude/settings.json'), 'utf8')).toBe('{ not json');
    });
  });

  it('without --claude, existing .polder.yml still refuses with exit 1 (unchanged contract)', () => {
    withRepo({ '.polder.yml': CONFIG }, (cwd) => {
      const { code, err } = capture(() => runInitSubcommand([], cwd));
      expect(code).toBe(1);
      expect(err).toContain('already exists');
      expect(fs.existsSync(path.join(cwd, '.claude/settings.json'))).toBe(false);
    });
  });

  it('unknown option → exit 2', () => {
    const { code, err } = capture(() => runInitSubcommand(['--frobnicate']));
    expect(code).toBe(2);
    expect(err).toContain('unknown option');
  });

  it('--cwd pointing at a missing directory → exit 2, not a crash', () => {
    const { code, err } = capture(() => runInitSubcommand(['--cwd', '/no/such/dir']));
    expect(code).toBe(2);
    expect(err).toContain('not a directory');
  });
});
