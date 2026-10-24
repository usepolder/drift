import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkInlineDrift } from '../src/parser';
import { buildDetectionProfile } from '../src/profiles';
import { normalizeColor, findColors } from '../src/colors';
import { parseConfig } from '../src/config';
import { generateDetectionData } from '../src/generate-profile';

const FIXTURES = path.resolve(__dirname, 'fixtures/tokens');
const read = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

const PROFILE = buildDetectionProfile(['@acme/ds'], {
  tokens: { '#0f62fe': 'interactive', '#da1e28': 'error', '#ff0000': 'red' },
  cssVariables: ['--ds-'],
  utilityClasses: ['bg-brand-*', 'text-brand-*'],
});

function fingerprints(file: string): Record<string, string[]> {
  const r = checkInlineDrift(read(file), new Set(), file, PROFILE);
  return Object.fromEntries(r.tokenFingerprints.map((f) => [f.componentName, [...f.tokens, ...f.classNames]]));
}

describe('normalizeColor', () => {
  it.each([
    ['#fff', '#ffffff'],
    ['#F36', '#ff3366'],
    ['#f368', '#ff3366'],
    ['#0F62FE', '#0f62fe'],
    ['#0f62fe80', '#0f62fe'],
    ['rgb(15, 98, 254)', '#0f62fe'],
    ['rgba(15, 98, 254, 0.5)', '#0f62fe'],
    ['rgb(15 98 254 / 50%)', '#0f62fe'],
    ['rgb(100%, 0%, 0%)', '#ff0000'],
    ['hsl(0, 100%, 50%)', '#ff0000'],
    ['hsla(120deg 100% 25% / .3)', '#008000'],
  ])('%s -> %s', (raw, hex) => {
    expect(normalizeColor(raw)?.hex).toBe(hex);
  });

  it.each(['#ff', '#12345', '#1234567', 'red', 'rgb(1, 2)', 'rgb(var(--x))', 'hsl(0 100 50)'])(
    'rejects %s',
    (raw) => expect(normalizeColor(raw)).toBeNull(),
  );

  it('does not read a longer hex run as a shorter colour', () => {
    expect(findColors('#12345 #123456789 #abcdefg')).toEqual([]);
  });
});

describe('token fingerprint formats', () => {
  it('fires on every format in the drifted fixture', () => {
    const found = fingerprints('DriftedFormats.tsx');
    expect(found).toEqual({
      Hex3Badge: ['#ff0000'],
      Hex8Button: ['#0f62fe'],
      RgbTile: ['#0f62fe'],
      RgbaModernTile: ['#da1e28'],
      HslLabel: ['#0f62fe'],
      VarLink: ['--ds-color-interactive'],
      VarWithFallback: ['--ds-color-support-error'],
      TailwindArbitrary: ['#0f62fe'],
      TailwindUtility: ['bg-brand-500', 'text-brand-fg'],
    });
  });

  it('stays silent on the clean fixture', () => {
    expect(fingerprints('CleanFormats.tsx')).toEqual({});
  });

  it('keeps the previous behaviour for plain 6-digit hex', () => {
    const src = `export function A() { return <i style={{ color: '#DA1E28' }} />; }`;
    const r = checkInlineDrift(src, new Set(), 'A.tsx', PROFILE);
    expect(r.tokenFingerprints[0].tokens).toEqual(['#da1e28']);
  });

  it('css_variables entries are prefixes; unrelated variables do not fire', () => {
    const src = `export function A() { return <i style={{ color: 'var( --ds-x )', background: 'var(--dsx-y)' }} />; }`;
    const r = checkInlineDrift(src, new Set(), 'A.tsx', PROFILE);
    expect(r.tokenFingerprints[0].tokens).toEqual(['--ds-x']);
  });

  it('built-in Carbon tokens match through other notations', () => {
    const carbon = buildDetectionProfile(['@carbon/react']);
    const src = `export function A() { return <i style={{ color: 'rgb(15, 98, 254)' }} />; }`;
    const r = checkInlineDrift(src, new Set(), 'A.tsx', carbon);
    expect(r.tokenFingerprints[0].tokens).toEqual(['#0f62fe']);
  });
});

describe('config keys', () => {
  const BASE = 'component_library: "@acme/ds"\n';

  it('parses css_variables and utility_classes', () => {
    const cfg = parseConfig(BASE + 'css_variables: ["--ds-"]\nutility_classes: ["bg-brand-*"]\n');
    expect(cfg.cssVariables).toEqual(['--ds-']);
    expect(cfg.utilityClasses).toEqual(['bg-brand-*']);
  });

  it('rejects malformed values', () => {
    expect(() => parseConfig(BASE + 'css_variables: ["ds-color"]\n')).toThrow('css_variables');
    expect(() => parseConfig(BASE + 'utility_classes: [""]\n')).toThrow('utility_classes');
  });
});

describe('profile extraction of CSS variables', () => {
  it('derives namespaces and color tokens from css, scss and template CSS', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polder-vars-'));
    try {
      fs.mkdirSync(path.join(dir, 'src'));
      fs.writeFileSync(
        path.join(dir, 'src/tokens.css'),
        ':root {\n  --acme-color-brand: hsl(340, 100%, 60%);\n  --acme-color-ink: rgb(10 20 30);\n' +
          '  --acme-space-md: 16px;\n  --tw-ring: 0;\n  --color-gray: #ccc;\n  --lonely-one: #123abc;\n}\n',
      );
      fs.writeFileSync(
        path.join(dir, 'src/theme.ts'),
        "export const coral = 'rgb(255, 51, 102)';\nexport const css = `--acme-radius-sm: 2px;`;\n",
      );
      const { data, stats } = generateDetectionData(dir, new Set());
      expect(data.cssVariables).toEqual(['--acme-']);
      expect(stats.cssVariables).toBe(1);
      expect(Object.values(data.tokens ?? {})).toEqual(
        expect.arrayContaining(['--acme-color-brand', '--acme-color-ink', 'coral', '--lonely-one']),
      );
      expect(data.tokens?.['#ff3366']).toBe('coral');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
