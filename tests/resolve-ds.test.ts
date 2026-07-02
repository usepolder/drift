import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveSourceExports, resolveDsSurface } from '../src/parser';
import { parseConfig } from '../src/config';
import { buildReport } from '../src/cli';

afterEach(() => vi.restoreAllMocks());

function tmpDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polder-ds-'));
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── resolveSourceExports ──────────────────────────────────────────────────────

describe('resolveSourceExports', () => {
  it('walks a src/index.ts barrel: declarations, specifiers, export-star chains', () => {
    const dir = tmpDir({
      'src/index.ts':
        `export { Button } from './Button';\n` +
        `export * from './inputs';\n` +
        `export * as Tokens from './tokens';\n` +
        `export const Tag = () => null;\n` +
        `export function Chip() { return null; }\n` +
        `export type Size = 'sm' | 'lg';\n`,
      'src/Button.tsx': `export const Button = () => null;\nexport default Button;\n`,
      // export-star chain: inputs/index.ts → TextInput.tsx
      'src/inputs/index.ts': `export * from './TextInput';\nexport { Select as DsSelect } from './Select';\n`,
      'src/inputs/TextInput.tsx': `export function TextInput() { return null; }\n`,
      'src/inputs/Select.tsx': `export const Select = () => null;\n`,
      'src/tokens.ts': `export const blue = '#0000ff';\n`,
    });
    try {
      const names = resolveSourceExports(dir);
      for (const expected of ['Button', 'Tag', 'Chip', 'Size', 'TextInput', 'DsSelect', 'Tokens']) {
        expect(names.has(expected), `expected ${expected}`).toBe(true);
      }
      expect(names.has('default')).toBe(false);
      expect(names.has('Select')).toBe(false); // renamed on export — only DsSelect is public
      expect(names.has('blue')).toBe(false); // behind the Tokens namespace, not a top export
    } finally {
      cleanup(dir);
    }
  });

  it('uses a package.json source/main entry pointing at TS source', () => {
    const dir = tmpDir({
      'package.json': JSON.stringify({ name: '@acme/ds', main: 'lib/main.ts' }),
      'lib/main.ts': `export const Card = () => null;\n`,
    });
    try {
      expect(resolveSourceExports(dir).has('Card')).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  it('a bare checkout without package.json still resolves via conventional entries', () => {
    const dir = tmpDir({ 'index.tsx': `export const Modal = () => null;\n` });
    try {
      expect(resolveSourceExports(dir).has('Modal')).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  it('no entry / unparseable entry → empty set, no crash', () => {
    const empty = tmpDir({ 'README.md': 'not a package' });
    const broken = tmpDir({ 'src/index.ts': '@@@ not valid @@@' });
    try {
      expect(resolveSourceExports(empty).size).toBe(0);
      expect(resolveSourceExports(broken).size).toBe(0);
    } finally {
      cleanup(empty);
      cleanup(broken);
    }
  });
});

// ── resolveDsSurface fallback chain ───────────────────────────────────────────

describe('resolveDsSurface', () => {
  it('prefers installed .d.ts, ignoring library_paths when types resolve', () => {
    const cwd = tmpDir({
      'node_modules/@acme/ds/package.json': JSON.stringify({ types: 'index.d.ts' }),
      'node_modules/@acme/ds/index.d.ts': `export declare const Button: any;\n`,
      'ds-repo/src/index.ts': `export const FromRepo = () => null;\n`,
    });
    try {
      const names = resolveDsSurface('@acme/ds', cwd, 'ds-repo');
      expect(names.has('Button')).toBe(true);
      expect(names.has('FromRepo')).toBe(false);
    } finally {
      cleanup(cwd);
    }
  });

  it('falls back to a library_paths source checkout when nothing is installed', () => {
    const cwd = tmpDir({
      'ds-repo/src/index.ts': `export { Button } from './Button';\n`,
      'ds-repo/src/Button.tsx': `export const Button = () => null;\n`,
    });
    try {
      const names = resolveDsSurface('@acme/ds', cwd, 'ds-repo');
      expect(names.has('Button')).toBe(true);
    } finally {
      cleanup(cwd);
    }
  });

  it('falls back to workspace source in node_modules when no types are built', () => {
    // A monorepo workspace package: installed (symlinked) but source-only.
    const cwd = tmpDir({
      'node_modules/@acme/ds/package.json': JSON.stringify({ name: '@acme/ds', main: 'src/index.ts' }),
      'node_modules/@acme/ds/src/index.ts': `export const Toggle = () => null;\n`,
    });
    try {
      const names = resolveDsSurface('@acme/ds', cwd);
      expect(names.has('Toggle')).toBe(true);
    } finally {
      cleanup(cwd);
    }
  });

  it('nothing anywhere → empty set (caller warns and uses the heuristic)', () => {
    const cwd = tmpDir({ 'app.tsx': 'export const a = 1;\n' });
    try {
      expect(resolveDsSurface('@acme/ds', cwd, 'missing-dir').size).toBe(0);
    } finally {
      cleanup(cwd);
    }
  });
});

// ── library_paths config ──────────────────────────────────────────────────────

describe('.polder.yml library_paths', () => {
  it('parses a package → path mapping', () => {
    const cfg = parseConfig(
      'component_library: "@acme/ds"\nlibrary_paths:\n  "@acme/ds": ../design-system\n',
    );
    expect(cfg.libraryPaths).toEqual({ '@acme/ds': '../design-system' });
  });

  it('rejects entries for packages not in component_library', () => {
    expect(() =>
      parseConfig('component_library: "@acme/ds"\nlibrary_paths:\n  "@acme/dz": ../ds\n'),
    ).toThrow('not in component_library');
  });

  it('rejects non-string values', () => {
    expect(() =>
      parseConfig('component_library: "@acme/ds"\nlibrary_paths:\n  "@acme/ds": 3\n'),
    ).toThrow('must be a string');
  });
});

// ── End to end: exact matching against an in-house DS repo ───────────────────

describe('scan against an in-house DS via library_paths', () => {
  it('enables exact import-drift and local-shadow (no PascalCase fallback)', () => {
    const cwd = tmpDir({
      // The DS repo checkout: exports Button and Tile only.
      'ds-repo/src/index.ts': `export const Button = () => null;\nexport const Tile = () => null;\n`,
      // Local import of a DS export → drift. Local import of a non-DS PascalCase
      // symbol → NOT drift (would be flagged under the heuristic fallback).
      'app.tsx':
        `import { Button } from './ui/Button';\n` +
        `import { Chart } from './ui/Chart';\n` +
        `export const Tile = () => <div />;\n` +
        `export const App = () => <><Button /><Chart /><Tile /></>;\n`,
    });
    // Silence the (absent) resolver warning path cleanly.
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const report = buildReport(
        {
          componentLibrary: ['@acme/ds'],
          allowlist: [],
          failOnDrift: false,
          libraryPaths: { '@acme/ds': 'ds-repo' },
        },
        cwd,
        ['app.tsx'],
        false,
      );
      const rules = report.files[0].findings.map((f) => `${f.rule}:${f.title}`);
      expect(rules).toContain(`import-drift:Button from './ui/Button'`);
      expect(rules).toContain('local-shadow:Tile'); // impossible under the heuristic fallback
      expect(rules.join(' ')).not.toContain('Chart'); // exact matching — not flagged
    } finally {
      errSpy.mockRestore();
      cleanup(cwd);
    }
  });
});
