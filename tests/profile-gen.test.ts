import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateDetectionData } from '../src/generate-profile';
import { parseProfileFile } from '../src/config';
import { resolveConfig, PROFILE_FILENAME } from '../src/resolve-config';
import { runProfileSubcommand } from '../src/commands/profile';
import { buildReport, runCli } from '../src/cli';

afterEach(() => vi.restoreAllMocks());

function tmpDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polder-profgen-'));
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

function silenceStdio(): () => void {
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  return () => {
    out.mockRestore();
    err.mockRestore();
  };
}

// A small but realistic in-house DS used across these tests.
const DS_FILES: Record<string, string> = {
  'src/index.ts':
    `export { AcmeModal } from './AcmeModal';\n` +
    `export { AcmeCard, AcmeCardHeader, AcmeCardActions } from './AcmeCard';\n` +
    `export { Plain } from './Plain';\n` +
    `export * from './tokens';\n`,
  'src/AcmeModal.tsx':
    `interface AcmeModalProps {\n` +
    `  open: boolean;\n` +
    `  onRequestDismiss(): void;\n` +
    `  heading: string;\n` +
    `  primaryActionText?: string;\n` +
    `  children?: React.ReactNode;\n` + // ubiquitous — must not appear in the signature
    `  className?: string;\n` +
    `}\n` +
    `export function AcmeModal({ open, onRequestDismiss, heading, primaryActionText }: AcmeModalProps) {\n` +
    `  return <div className="acme--modal">{heading}</div>;\n` +
    `}\n`,
  'src/AcmeCard.tsx':
    `export const AcmeCard = ({ elevation, interactive, onClick }: { elevation: number; interactive?: boolean; onClick?: () => void }) => (\n` +
    `  <div className="acme--card" />\n` +
    `);\n` +
    `export const AcmeCardHeader = ({ heading }: { heading: string }) => <div className="acme--card-header">{heading}</div>;\n` +
    `export const AcmeCardActions = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;\n`,
  // Only ubiquitous/common props — must NOT get a signature (it would match everything).
  'src/Plain.tsx': `export const Plain = ({ children, className, onClick }: any) => <div>{children}</div>;\n`,
  'src/tokens.ts':
    `export const brandCoral = '#ff3366';\n` +
    `export const brandNavy = '#0a1f44';\n` +
    `export const plainWhite = '#ffffff';\n` + // pure gray/white — filtered
    `export const gray50 = '#7f7f7f';\n`, // pure gray — filtered
  // Test/story files must be ignored entirely.
  'src/AcmeCard.stories.tsx': `export const rogue = '#123456';\n`,
  'src/AcmeCard.test.tsx': `export const rogue2 = '#654321';\n`,
};

const DS_EXPORTS = new Set(['AcmeModal', 'AcmeCard', 'AcmeCardHeader', 'AcmeCardActions', 'Plain', 'brandCoral', 'brandNavy', 'plainWhite', 'gray50']);

describe('generateDetectionData', () => {
  it('derives distinctive prop signatures, skipping generic-only components', () => {
    const dir = tmpDir(DS_FILES);
    try {
      const { data } = generateDetectionData(dir, DS_EXPORTS);
      // AcmeModal via the XProps interface convention.
      expect(data.propSignatures?.AcmeModal).toEqual(
        expect.arrayContaining(['open', 'onRequestDismiss', 'heading', 'primaryActionText']),
      );
      expect(data.propSignatures?.AcmeModal).not.toContain('children');
      expect(data.propSignatures?.AcmeModal).not.toContain('className');
      // AcmeCard via destructured params + inline type literal.
      expect(data.propSignatures?.AcmeCard).toEqual(expect.arrayContaining(['elevation', 'interactive']));
      // Plain has no distinctive props → no signature. AcmeCardHeader has only one → none.
      expect(data.propSignatures?.Plain).toBeUndefined();
      expect(data.propSignatures?.AcmeCardHeader).toBeUndefined();
    } finally {
      cleanup(dir);
    }
  });

  it('derives tokens from named constants, filtering grays and test/story files', () => {
    const dir = tmpDir(DS_FILES);
    try {
      const { data } = generateDetectionData(dir, DS_EXPORTS);
      expect(data.tokens?.['#ff3366']).toBe('brandCoral');
      expect(data.tokens?.['#0a1f44']).toBe('brandNavy');
      expect(data.tokens?.['#ffffff']).toBeUndefined(); // white filtered
      expect(data.tokens?.['#7f7f7f']).toBeUndefined(); // pure gray filtered
      expect(data.tokens?.['#123456']).toBeUndefined(); // .stories. file skipped
      expect(data.tokens?.['#654321']).toBeUndefined(); // .test. file skipped
    } finally {
      cleanup(dir);
    }
  });

  it('maps compound components to their parent, ignoring non-part suffixes', () => {
    const dir = tmpDir({
      ...DS_FILES,
      'src/extra.tsx': `export const AcmeCardGroup = () => null;\n`, // Group is not a part suffix
    });
    const exports = new Set([...DS_EXPORTS, 'AcmeCardGroup']);
    try {
      const { data } = generateDetectionData(dir, exports);
      expect(data.subComponents?.AcmeCardHeader).toBe('AcmeCard');
      expect(data.subComponents?.AcmeCardActions).toBe('AcmeCard');
      expect(data.subComponents?.AcmeCardGroup).toBeUndefined();
      // Segment keys on the parent's last PascalCase word, like the built-in Card → MuiCard.
      expect(data.nameSegments?.Card).toBe('AcmeCard');
    } finally {
      cleanup(dir);
    }
  });

  it('detects repeated BEM class prefixes above the occurrence threshold', () => {
    const dir = tmpDir(DS_FILES); // acme-- appears 3× across AcmeModal/AcmeCard
    try {
      const { data } = generateDetectionData(dir, DS_EXPORTS);
      expect(data.classPrefixes).toEqual(['acme--']);
    } finally {
      cleanup(dir);
    }
  });

  it('empty/no-source dir → only export-name-derived data, no crash', () => {
    const dir = tmpDir({ 'README.md': 'nothing here' });
    try {
      const { data, stats } = generateDetectionData(dir, DS_EXPORTS);
      expect(stats.filesScanned).toBe(0);
      // Source-dependent sections are empty…
      expect(data.tokens).toBeUndefined();
      expect(data.propSignatures).toBeUndefined();
      expect(data.classPrefixes).toBeUndefined();
      // …but compound naming works off the export surface alone (useful for
      // .d.ts-only packages).
      expect(data.subComponents?.AcmeCardHeader).toBe('AcmeCard');
    } finally {
      cleanup(dir);
    }
  });
});

describe('.polder.profile.yml loading', () => {
  it('parseProfileFile validates like .polder.yml and ignores metadata keys', () => {
    const data = parseProfileFile(
      'generated_by: polder-drift\ntokens:\n  "#FF3366": brand/coral\nclass_prefixes: ["acme--"]\n',
    );
    expect(data.tokens).toEqual({ '#ff3366': 'brand/coral' });
    expect(data.classPrefixes).toEqual(['acme--']);
    expect(() => parseProfileFile('tokens:\n  "red": x\n')).toThrow('hex colors');
  });

  it('resolveConfig underlays the generated file; .polder.yml keys win', () => {
    const dir = tmpDir({
      '.polder.yml':
        'component_library: "@acme/ds"\ntokens:\n  "#ff3366": from-config\n',
      [PROFILE_FILENAME]:
        'tokens:\n  "#ff3366": from-profile\n  "#0a1f44": brandNavy\nprop_signatures:\n  AcmeModal: [open, heading]\n',
    });
    try {
      const config = resolveConfig(dir, path.join(dir, '.polder.yml'))!.config;
      expect(config.tokens).toEqual({ '#ff3366': 'from-config', '#0a1f44': 'brandNavy' });
      expect(config.propSignatures).toEqual({ AcmeModal: ['open', 'heading'] });
    } finally {
      cleanup(dir);
    }
  });

  it('a corrupt generated profile fails loudly instead of being skipped', () => {
    const dir = tmpDir({
      '.polder.yml': 'component_library: "@acme/ds"\n',
      [PROFILE_FILENAME]: 'tokens: [not, a, map]\n',
    });
    try {
      expect(() => resolveConfig(dir, path.join(dir, '.polder.yml'))).toThrow('mapping');
    } finally {
      cleanup(dir);
    }
  });
});

describe('polder-drift profile (subcommand)', () => {
  function withDsRepo(fn: (cwd: string) => void): void {
    const dir = tmpDir({
      '.polder.yml':
        'component_library: "@acme/ds"\nlibrary_paths:\n  "@acme/ds": design-system\n',
      ...Object.fromEntries(Object.entries(DS_FILES).map(([k, v]) => [`design-system/${k}`, v])),
    });
    try {
      fn(dir);
    } finally {
      cleanup(dir);
    }
  }

  it('writes a reviewable profile file and scan picks it up end to end', () => {
    withDsRepo((cwd) => {
      const restore = silenceStdio();
      try {
        expect(runProfileSubcommand(['--cwd', cwd])).toBe(0);
      } finally {
        restore();
      }

      const written = fs.readFileSync(path.join(cwd, PROFILE_FILENAME), 'utf8');
      expect(written).toContain('REVIEW BEFORE COMMITTING');
      expect(written).toContain('prop_signatures');

      // End to end: an app component aping AcmeModal's API now trips prop-match.
      fs.writeFileSync(
        path.join(cwd, 'QuickModal.tsx'),
        `export const QuickModal = ({ open, onRequestDismiss, heading }: any) => <div style={{ color: '#ff3366' }}>{heading}</div>;\n`,
      );
      const config = resolveConfig(cwd, path.join(cwd, '.polder.yml'))!.config;
      const report = buildReport(config, cwd, ['QuickModal.tsx'], false);
      const rules = report.files[0].findings.map((f) => f.rule);
      expect(rules).toContain('prop-match');
      expect(rules).toContain('token-fingerprint'); // #ff3366 came from the generated tokens
    });
  });

  it('refuses to overwrite an existing profile without --force', () => {
    withDsRepo((cwd) => {
      fs.writeFileSync(path.join(cwd, PROFILE_FILENAME), 'tokens:\n  "#111111": hand-edited\n');
      const restore = silenceStdio();
      try {
        expect(runProfileSubcommand(['--cwd', cwd])).toBe(1);
        expect(fs.readFileSync(path.join(cwd, PROFILE_FILENAME), 'utf8')).toContain('hand-edited');
        expect(runProfileSubcommand(['--cwd', cwd, '--force'])).toBe(0);
        expect(fs.readFileSync(path.join(cwd, PROFILE_FILENAME), 'utf8')).toContain('prop_signatures');
      } finally {
        restore();
      }
    });
  });

  it('nothing distinctive → exit 1, no file written', () => {
    const dir = tmpDir({
      '.polder.yml': 'component_library: "@acme/ds"\nlibrary_paths:\n  "@acme/ds": ds\n',
      'ds/src/index.ts': `export const Plain = ({ children }: any) => children;\n`,
    });
    const restore = silenceStdio();
    try {
      expect(runProfileSubcommand(['--cwd', dir])).toBe(1);
      expect(fs.existsSync(path.join(dir, PROFILE_FILENAME))).toBe(false);
    } finally {
      restore();
      cleanup(dir);
    }
  });

  it('is dispatched from the top-level CLI', () => {
    withDsRepo((cwd) => {
      const restore = silenceStdio();
      try {
        expect(runCli(['profile', '--cwd', cwd])).toBe(0);
      } finally {
        restore();
      }
      expect(fs.existsSync(path.join(cwd, PROFILE_FILENAME))).toBe(true);
    });
  });
});
