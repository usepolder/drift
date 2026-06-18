import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseArgs,
  buildReport,
  formatHuman,
  discoverFiles,
  runCli,
  runScan,
  UsageError,
  type CliReport,
} from '../src/cli';
import type { PolderConfig } from '../src/config';

// Capture stdout/stderr so dispatch tests don't pollute the test output.
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

afterEach(() => vi.restoreAllMocks());

describe('parseArgs', () => {
  it('defaults to diff mode with json off', () => {
    const opts = parseArgs([]);
    expect(opts.mode).toBe('diff');
    expect(opts.diffBase).toBeNull();
    expect(opts.json).toBe(false);
    expect(opts.failOnDrift).toBeNull();
  });

  it('--json enables json output', () => {
    expect(parseArgs(['--json']).json).toBe(true);
  });

  it('--diff with a ref captures the base', () => {
    const opts = parseArgs(['--diff', 'main']);
    expect(opts.mode).toBe('diff');
    expect(opts.diffBase).toBe('main');
  });

  it('--diff without a ref leaves base null', () => {
    const opts = parseArgs(['--diff', '--json']);
    expect(opts.diffBase).toBeNull();
    expect(opts.json).toBe(true);
  });

  it('positional file paths switch to explicit mode', () => {
    const opts = parseArgs(['a.tsx', 'b.ts']);
    expect(opts.mode).toBe('explicit');
    expect(opts.paths).toEqual(['a.tsx', 'b.ts']);
  });

  it('--all wins over positional default', () => {
    const opts = parseArgs(['--all', 'x.ts']);
    expect(opts.mode).toBe('all');
  });

  it('--fail-on-drift / --no-fail set the override', () => {
    expect(parseArgs(['--fail-on-drift']).failOnDrift).toBe(true);
    expect(parseArgs(['--no-fail']).failOnDrift).toBe(false);
  });

  it('unknown option throws UsageError', () => {
    expect(() => parseArgs(['--nope'])).toThrow(UsageError);
  });
});

describe('discoverFiles (explicit mode)', () => {
  it('keeps only source files', () => {
    const opts = parseArgs(['a.tsx', 'b.ts', 'c.md', 'd.css']);
    expect(discoverFiles(opts)).toEqual(['a.tsx', 'b.ts']);
  });
});

describe('buildReport + formatHuman', () => {
  const config: PolderConfig = {
    componentLibrary: ['@acme/ds'],
    allowlist: [],
    failOnDrift: false,
  };

  function withTempFile(filename: string, content: string, fn: (cwd: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polder-cli-'));
    fs.writeFileSync(path.join(dir, filename), content);
    try {
      fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('clean file produces zero signals', () => {
    withTempFile('clean.tsx', 'export const x = 1;\n', (cwd) => {
      const report = buildReport(config, cwd, ['clean.tsx'], false);
      expect(report.summary.totalSignals).toBe(0);
      expect(report.summary.filesAnalyzed).toBe(1);
      expect(formatHuman(report)).toContain('No design system drift');
    });
  });

  it('import drift from a local path is flagged', () => {
    // node_modules is absent, so resolveExports falls back to the PascalCase
    // heuristic: a Button-like symbol imported from a local path (not the
    // canonical "@acme/ds") surfaces as import drift.
    const src = `import { Button } from './ui/Button';\nexport const X = () => <Button />;\n`;
    withTempFile('drift.tsx', src, (cwd) => {
      const report = buildReport(config, cwd, ['drift.tsx'], false);
      expect(report.summary.filesWithDrift).toBe(1);
      expect(report.files[0].importDrift.symbols.join(' ')).toContain('Button');
    });
  });

  it('missing files are skipped, not fatal', () => {
    withTempFile('present.tsx', 'export const y = 2;\n', (cwd) => {
      const report = buildReport(config, cwd, ['present.tsx', 'ghost.tsx'], false);
      expect(report.summary.filesAnalyzed).toBe(1);
    });
  });

  it('json report carries the effective failOnDrift flag', () => {
    withTempFile('clean.tsx', 'export const z = 3;\n', (cwd) => {
      const report: CliReport = buildReport(config, cwd, ['clean.tsx'], true);
      expect(report.config.failOnDrift).toBe(true);
      expect(report.version).toBe(1);
    });
  });
});

// Regression coverage for the `scan` subcommand refactor (IRON RULE). These pin the
// top-level dispatch contract so a future change can't silently break invocation.
describe('runCli dispatch', () => {
  it('bare invocation prints top-level help, exit 0', () => {
    const { code, out } = capture(() => runCli([]));
    expect(code).toBe(0);
    expect(out).toContain('polder-drift <command>');
    expect(out).toContain('scan');
  });

  it('--help prints top-level help, exit 0', () => {
    const { code, out } = capture(() => runCli(['--help']));
    expect(code).toBe(0);
    expect(out).toContain('Commands:');
  });

  it('reserved-but-unbuilt subcommands report not-available, exit 2', () => {
    for (const cmd of ['mcp', 'telemetry']) {
      const { code, err } = capture(() => runCli([cmd]));
      expect(code).toBe(2);
      expect(err).toContain('not available yet');
    }
  });

  it('a file path at top level is redirected to `scan` (the breaking change)', () => {
    const { code, err } = capture(() => runCli(['Button.tsx']));
    expect(code).toBe(2);
    expect(err).toContain('scan');
  });

  it('an unknown command reports valid commands, exit 2', () => {
    const { code, err } = capture(() => runCli(['frobnicate']));
    expect(code).toBe(2);
    expect(err).toContain('unknown command');
  });

  it('`scan` delegates to runScan', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polder-cli-'));
    fs.writeFileSync(path.join(dir, '.polder.yml'), 'component_library: "@acme/ds"\n');
    fs.writeFileSync(path.join(dir, 'clean.tsx'), 'export const a = 1;\n');
    try {
      const { code, out } = capture(() => runCli(['scan', '--cwd', dir, 'clean.tsx']));
      expect(code).toBe(0);
      expect(out).toContain('No design system drift');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runScan (post-refactor scan still works)', () => {
  function withConfiguredRepo(fn: (dir: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polder-scan-'));
    fs.writeFileSync(path.join(dir, '.polder.yml'), 'component_library: "@acme/ds"\n');
    try {
      fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('explicit clean file → exit 0, human output', () => {
    withConfiguredRepo((dir) => {
      fs.writeFileSync(path.join(dir, 'clean.tsx'), 'export const a = 1;\n');
      const { code, out } = capture(() => runScan(['--cwd', dir, 'clean.tsx']));
      expect(code).toBe(0);
      expect(out).toContain('No design system drift');
    });
  });

  it('--json emits a parseable report on stdout', () => {
    withConfiguredRepo((dir) => {
      fs.writeFileSync(path.join(dir, 'clean.tsx'), 'export const a = 1;\n');
      const { code, out } = capture(() => runScan(['--cwd', dir, '--json', 'clean.tsx']));
      expect(code).toBe(0);
      const parsed = JSON.parse(out);
      expect(parsed.version).toBe(1);
      expect(parsed.summary.filesAnalyzed).toBe(1);
    });
  });

  it('--fail-on-drift with drift → exit 1', () => {
    withConfiguredRepo((dir) => {
      fs.writeFileSync(
        path.join(dir, 'drift.tsx'),
        `import { Button } from './ui/Button';\nexport const X = () => <Button />;\n`,
      );
      const { code } = capture(() => runScan(['--cwd', dir, '--fail-on-drift', 'drift.tsx']));
      expect(code).toBe(1);
    });
  });

  it('no config and no detectable DS → exit 2 with guidance', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polder-noconfig-'));
    fs.writeFileSync(path.join(dir, 'clean.tsx'), 'export const a = 1;\n'); // no package.json → no detection
    try {
      const { code, err } = capture(() => runScan(['--cwd', dir, 'clean.tsx']));
      expect(code).toBe(2);
      expect(err).toContain('could not auto-detect');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('zero-config: detects DS from package.json when no .polder.yml', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polder-detect-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { '@mui/material': '^5' } }));
    fs.writeFileSync(path.join(dir, 'clean.tsx'), 'export const a = 1;\n');
    try {
      const { code, err } = capture(() => runScan(['--cwd', dir, 'clean.tsx']));
      expect(code).toBe(0);
      expect(err).toContain('auto-detected design system: @mui/material');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
