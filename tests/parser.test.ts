import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveExports, isComponentFile, checkDrift, checkInlineDrift, checkDriftFull, CARBON_TOKENS, DS_PROP_SIGNATURES } from '../src/parser';
import { CARBON_PROFILE } from '../src/profiles';

const CANONICAL = ['@acme/ds'];
const DS_EXPORTS = new Set(['Button', 'Modal', 'useToggle', 'Skeleton']);

// ── resolveExports ────────────────────────────────────────────────────────────

describe('resolveExports', () => {
  function makeNodeModules(dts: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polder-test-'));
    const pkgDir = path.join(dir, '@acme', 'ds');
    fs.mkdirSync(path.join(pkgDir, 'dist'), { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ types: './dist/index.d.ts' }),
    );
    fs.writeFileSync(path.join(pkgDir, 'dist', 'index.d.ts'), dts);
    return dir;
  }

  it('valid .d.ts → returns Set with exported names including hooks', () => {
    const dir = makeNodeModules(
      `export declare function Button(): JSX.Element;\nexport declare const Skeleton: React.FC;\nexport declare function useToggle(): any;\n`,
    );
    const result = resolveExports('@acme/ds', dir);
    expect(result.has('Button')).toBe(true);
    expect(result.has('Skeleton')).toBe(true);
    expect(result.has('useToggle')).toBe(true);
  });

  it('package not in node_modules → returns empty Set (no crash)', () => {
    const result = resolveExports('@acme/ds', '/tmp/nonexistent-' + Date.now());
    expect(result.size).toBe(0);
  });

  it('empty .d.ts → returns empty Set (no crash)', () => {
    const dir = makeNodeModules('');
    const result = resolveExports('@acme/ds', dir);
    expect(result.size).toBe(0);
  });
});

// ── isComponentFile ───────────────────────────────────────────────────────────

describe('isComponentFile', () => {
  it('file with JSX → true', () => {
    expect(isComponentFile('const x = <Button />')).toBe(true);
  });

  it('file with PascalCase export function → true', () => {
    expect(isComponentFile('export function MyComponent() {}')).toBe(true);
  });

  it('file with PascalCase export const → true', () => {
    expect(isComponentFile('export const MyCard = () => {}')).toBe(true);
  });

  it('utility file (no JSX, no PascalCase export) → false', () => {
    expect(isComponentFile('export const formatDate = (d) => d.toISOString();')).toBe(false);
  });

  it('hook file with no JSX → false', () => {
    expect(isComponentFile('export const useTheme = () => ({ color: "red" });')).toBe(false);
  });
});

// ── checkDrift ────────────────────────────────────────────────────────────────

describe('checkDrift', () => {
  const jsxHeader = 'export function MyComp() { return <div />; }\n';

  it('canonical import → not flagged', () => {
    const content = jsxHeader + `import { Button } from '@acme/ds';`;
    const { driftCount } = checkDrift(content, DS_EXPORTS, CANONICAL, []);
    expect(driftCount).toBe(0);
  });

  it('local import of DS symbol → flagged', () => {
    const content = jsxHeader + `import { Button } from '../components/Button';`;
    const { driftCount, driftedSymbols } = checkDrift(content, DS_EXPORTS, CANONICAL, []);
    expect(driftCount).toBe(1);
    expect(driftedSymbols[0]).toContain('Button');
  });

  it('multi-line import of DS symbol from local path → flagged', () => {
    const content =
      jsxHeader +
      `import {\n  Button,\n  Modal\n} from '../components';`;
    const { driftCount } = checkDrift(content, DS_EXPORTS, CANONICAL, []);
    expect(driftCount).toBe(2);
  });

  it('import type of DS symbol from local path → flagged', () => {
    const content = jsxHeader + `import type { Button } from '../components/Button';`;
    const { driftCount } = checkDrift(content, DS_EXPORTS, CANONICAL, []);
    expect(driftCount).toBe(1);
  });

  it('dynamic import() → not flagged', () => {
    const content = jsxHeader + `const mod = import('../components/Button');`;
    const { driftCount } = checkDrift(content, DS_EXPORTS, CANONICAL, []);
    expect(driftCount).toBe(0);
  });

  it('allowlisted path → not flagged', () => {
    const content = jsxHeader + `import { Button } from '#ds-wrappers/Button';`;
    const { driftCount } = checkDrift(content, DS_EXPORTS, CANONICAL, ['#ds-wrappers/']);
    expect(driftCount).toBe(0);
  });

  it('local import of NON-DS symbol → not flagged', () => {
    const content = jsxHeader + `import { Container } from '#components/atoms/Container';`;
    const { driftCount } = checkDrift(content, DS_EXPORTS, CANONICAL, []);
    // Container is not in DS_EXPORTS
    expect(driftCount).toBe(0);
  });

  it('mixed file: canonical + local DS + local non-DS → only local DS flagged', () => {
    const content =
      jsxHeader +
      `import { Button } from '@acme/ds';\n` +
      `import { Modal } from '../components/Modal';\n` +
      `import { Container } from '../components/Container';\n`;
    const { driftCount, driftedSymbols } = checkDrift(content, DS_EXPORTS, CANONICAL, []);
    expect(driftCount).toBe(1);
    expect(driftedSymbols[0]).toContain('Modal');
  });

  it('file with zero imports → 0 drift', () => {
    const content = jsxHeader;
    const { driftCount } = checkDrift(content, DS_EXPORTS, CANONICAL, []);
    expect(driftCount).toBe(0);
  });

  it('file with only third-party imports → 0 drift', () => {
    const content = jsxHeader + `import React from 'react';\nimport _ from 'lodash';`;
    const { driftCount } = checkDrift(content, DS_EXPORTS, CANONICAL, []);
    expect(driftCount).toBe(0);
  });

  it('utility file → skipped by pre-filter, 0 drift', () => {
    const content = `export const formatDate = (d) => d.toISOString();\nimport { Button } from '../Button';`;
    const { driftCount } = checkDrift(content, DS_EXPORTS, CANONICAL, []);
    expect(driftCount).toBe(0);
  });

  it('hook file with no JSX → skipped by pre-filter, 0 drift', () => {
    const content = `export const useTheme = () => ({ color: 'red' });\nimport { Button } from '../Button';`;
    const { driftCount } = checkDrift(content, DS_EXPORTS, CANONICAL, []);
    expect(driftCount).toBe(0);
  });

  it('component file with JSX → passes pre-filter, imports analyzed', () => {
    const content = `export function Card() { return <div />; }\nimport { Button } from '../Button';`;
    const { driftCount } = checkDrift(content, DS_EXPORTS, CANONICAL, []);
    expect(driftCount).toBe(1);
  });

  it('empty dsExports → fallback path-only: PascalCase symbol from local flagged', () => {
    const content = jsxHeader + `import { Button } from '../components/Button';`;
    const { driftCount } = checkDrift(content, new Set(), CANONICAL, []);
    expect(driftCount).toBe(1);
  });

  it('empty dsExports fallback → camelCase symbol NOT flagged', () => {
    const content = jsxHeader + `import { formatDate } from '../utils';`;
    const { driftCount } = checkDrift(content, new Set(), CANONICAL, []);
    expect(driftCount).toBe(0);
  });

  it('syntax @babel/parser rejects → 0 drift, no crash', () => {
    const content = 'this is not valid JS at all @@@ ###';
    expect(() => checkDrift(content, DS_EXPORTS, CANONICAL, [])).not.toThrow();
  });

  it('.tsx filename bypasses isComponentFile pre-filter → patch-only import line is caught', () => {
    // Simulates patch analysis: only the changed import line, no JSX context
    const patchLine = `import { useToggle } from '../hooks/useToggle';`;
    const { driftCount, driftedSymbols } = checkDrift(
      patchLine,
      DS_EXPORTS,
      CANONICAL,
      [],
      'src/components/NavBar.tsx',
    );
    expect(driftCount).toBe(1);
    expect(driftedSymbols[0]).toContain('useToggle');
  });

  it('.ts filename without JSX context still skipped by pre-filter', () => {
    const patchLine = `import { useToggle } from '../hooks/useToggle';`;
    const { driftCount } = checkDrift(patchLine, DS_EXPORTS, CANONICAL, [], 'src/utils/index.ts');
    expect(driftCount).toBe(0);
  });

  it('useToggle from local path → flagged (real spike TP)', () => {
    const content =
      jsxHeader + `import { useToggle } from '#hooks/useToggle';`;
    const { driftCount, driftedSymbols } = checkDrift(content, DS_EXPORTS, CANONICAL, []);
    expect(driftCount).toBe(1);
    expect(driftedSymbols[0]).toContain('useToggle');
  });
});

// ── checkInlineDrift ──────────────────────────────────────────────────────────

describe('checkInlineDrift', () => {
  it('file with no local components → empty result', () => {
    const content = `import { Button } from '@acme/ds';`;
    const result = checkInlineDrift(content, DS_EXPORTS);
    expect(result.localShadows).toHaveLength(0);
    expect(result.tokenFingerprints).toHaveLength(0);
  });

  it('locally-defined function shares a DS export name → localShadow', () => {
    const content = `
      function Button({ children }: { children: React.ReactNode }) {
        return <button>{children}</button>;
      }
      export function Page() { return <Button />; }
    `;
    const result = checkInlineDrift(content, DS_EXPORTS, 'Page.tsx');
    expect(result.localShadows).toContain('Button');
  });

  it('locally-defined arrow component shares a DS export name → localShadow', () => {
    const content = `
      const Modal = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
      export function Page() { return <Modal />; }
    `;
    const result = checkInlineDrift(content, DS_EXPORTS, 'Page.tsx');
    expect(result.localShadows).toContain('Modal');
  });

  it('locally-defined component with different name → not a localShadow', () => {
    const content = `
      function CardShell({ children }: { children: React.ReactNode }) {
        return <div>{children}</div>;
      }
      export function Page() { return <CardShell />; }
    `;
    const result = checkInlineDrift(content, DS_EXPORTS, 'Page.tsx');
    expect(result.localShadows).toHaveLength(0);
  });

  it('function body with Carbon token → tokenFingerprint', () => {
    const content = `
      function PillBadge({ children }: { children: React.ReactNode }) {
        return <span style={{ color: '#da1e28', background: '#fff1f1' }}>{children}</span>;
      }
      export function Page() { return <PillBadge>Sale</PillBadge>; }
    `;
    const result = checkInlineDrift(content, DS_EXPORTS, 'Page.tsx');
    expect(result.tokenFingerprints).toHaveLength(1);
    expect(result.tokenFingerprints[0].componentName).toBe('PillBadge');
    expect(result.tokenFingerprints[0].tokens).toContain('#da1e28');
  });

  it('function body with cds-- class → tokenFingerprint classNames', () => {
    const content = `
      function MyBtn({ children }: { children: React.ReactNode }) {
        return <button className="cds--btn cds--btn--primary">{children}</button>;
      }
      export function Page() { return <MyBtn>Go</MyBtn>; }
    `;
    const result = checkInlineDrift(content, DS_EXPORTS, 'Page.tsx');
    expect(result.tokenFingerprints[0].classNames).toContain('cds--btn');
  });

  it('function body with no Carbon tokens → no fingerprint', () => {
    const content = `
      function Wrapper({ children }: { children: React.ReactNode }) {
        return <div style={{ display: 'flex' }}>{children}</div>;
      }
      export function Page() { return <Wrapper />; }
    `;
    const result = checkInlineDrift(content, DS_EXPORTS, 'Page.tsx');
    expect(result.tokenFingerprints).toHaveLength(0);
  });

  it('module-level constant with Carbon token (not inside a function) → not flagged', () => {
    // The hex value lives in a data object, not a component body — should not produce fingerprint
    const content = `
      const theme = { primary: '#0f62fe' };
      export function Page() { return <div style={{ color: theme.primary }} />; }
    `;
    const result = checkInlineDrift(content, DS_EXPORTS, 'Page.tsx');
    // Page() body has no direct token — only theme reference
    expect(result.tokenFingerprints.some(f => f.componentName === 'Page')).toBe(false);
  });

  it('utility file without JSX → skipped by pre-filter', () => {
    const content = `
      export const getColor = () => '#da1e28';
    `;
    const result = checkInlineDrift(content, DS_EXPORTS, 'utils.ts');
    expect(result.tokenFingerprints).toHaveLength(0);
  });

  it('syntax error → no crash, empty result', () => {
    expect(() => checkInlineDrift('@@@ invalid !!!', DS_EXPORTS, 'bad.tsx')).not.toThrow();
  });
});

// ── checkDriftFull ────────────────────────────────────────────────────────────

describe('checkDriftFull', () => {
  it('clean file → totalCount 0', () => {
    const content = `
      import { Button } from '@acme/ds';
      export function Page() { return <Button>Go</Button>; }
    `;
    const result = checkDriftFull(content, DS_EXPORTS, CANONICAL, [], 'Page.tsx');
    expect(result.totalCount).toBe(0);
    expect(result.importDrift.count).toBe(0);
    expect(result.inlineDrift.localShadows).toHaveLength(0);
  });

  it('import drift + inline drift → totalCount is sum', () => {
    const content = `
      import { Button } from '../components/Button';
      function Modal({ children }: { children: React.ReactNode }) {
        return <div style={{ color: '#da1e28' }}>{children}</div>;
      }
      export function Page() { return <Modal><Button /></Modal>; }
    `;
    // '@acme/ds' matches no built-in profile, so Carbon token detection is opted
    // into explicitly here.
    const result = checkDriftFull(content, DS_EXPORTS, CANONICAL, [], 'Page.tsx', CARBON_PROFILE);
    // Button import from local → importDrift count 1
    // Modal locally defined shadow → localShadow
    // Modal body has #da1e28 → tokenFingerprint
    expect(result.importDrift.count).toBe(1);
    expect(result.inlineDrift.localShadows).toContain('Modal');
    expect(result.inlineDrift.tokenFingerprints[0].tokens).toContain('#da1e28');
    expect(result.totalCount).toBeGreaterThan(1);
  });

  it('unknown component_library without a profile → export-based rules only', () => {
    const content = `
      import { Button } from '../components/Button';
      function Modal({ children }: { children: React.ReactNode }) {
        return <div style={{ color: '#da1e28' }}>{children}</div>;
      }
      export function Page() { return <Modal><Button /></Modal>; }
    `;
    // No profile derives from '@acme/ds', so the Carbon hex must NOT be flagged
    // (it would carry a misleading Carbon token label). Import drift and the DS-export
    // shadow still fire — they need no profile.
    const result = checkDriftFull(content, DS_EXPORTS, CANONICAL, [], 'Page.tsx');
    expect(result.importDrift.count).toBe(1);
    expect(result.inlineDrift.localShadows).toContain('Modal');
    expect(result.inlineDrift.tokenFingerprints).toHaveLength(0);
    expect(result.inlineDrift.propMatches).toHaveLength(0);
  });

  it('carbon canonical package → carbon profile derived automatically', () => {
    const content = `
      function PromoTile() {
        return <div className="cds--tile" style={{ color: '#0f62fe' }} />;
      }
      export function Page() { return <PromoTile />; }
    `;
    const result = checkDriftFull(content, DS_EXPORTS, ['@carbon/react'], [], 'Page.tsx');
    expect(result.inlineDrift.tokenFingerprints).toHaveLength(1);
    expect(result.inlineDrift.tokenFingerprints[0].tokens).toContain('#0f62fe');
    expect(result.inlineDrift.tokenFingerprints[0].classNames).toContain('cds--tile');
  });
});

// ── Phase 3: prop-signature matching ─────────────────────────────────────────

describe('checkInlineDrift — propMatches (Phase 3)', () => {
  it('component with NumberInput prop signature → matched', () => {
    const content = `
      function StepperInput({ value, onChange, min, max, step, label }: StepperProps) {
        return <div><button>-</button><span>{value}</span><button>+</button></div>;
      }
      export function Page() { return <StepperInput value={1} onChange={() => {}} min={0} max={10} step={1} label="Qty" />; }
    `;
    const result = checkInlineDrift(content, DS_EXPORTS, 'Page.tsx');
    expect(result.propMatches).toHaveLength(1);
    expect(result.propMatches[0].componentName).toBe('StepperInput');
    expect(result.propMatches[0].matchedDs).toBe('NumberInput');
    expect(result.propMatches[0].matchedProps).toContain('value');
    expect(result.propMatches[0].matchedProps).toContain('onChange');
    expect(result.propMatches[0].matchedProps).toContain('min');
    expect(result.propMatches[0].matchedProps).toContain('max');
    expect(result.propMatches[0].score).toBeGreaterThanOrEqual(0.6);
  });

  it('component with InlineNotification prop signature → matched', () => {
    const content = `
      function PromoStrip({ kind, title, subtitle, onCloseButtonClick, lowContrast }: Props) {
        return <div>{title}</div>;
      }
      export function Page() { return <PromoStrip kind="info" title="Sale" subtitle="50% off" onCloseButtonClick={() => {}} lowContrast />; }
    `;
    const result = checkInlineDrift(content, DS_EXPORTS, 'Page.tsx');
    expect(result.propMatches.some(m => m.matchedDs === 'InlineNotification')).toBe(true);
  });

  it('component with completely unrelated props → no match', () => {
    const content = `
      function Avatar({ src, alt, size }: AvatarProps) {
        return <img src={src} alt={alt} />;
      }
      export function Page() { return <Avatar src="x.png" alt="me" size={32} />; }
    `;
    const result = checkInlineDrift(content, DS_EXPORTS, 'Page.tsx');
    expect(result.propMatches).toHaveLength(0);
  });

  it('single matching prop → not flagged (below min overlap)', () => {
    const content = `
      function Wrapper({ kind }: Props) {
        return <div />;
      }
      export function Page() { return <Wrapper kind="primary" />; }
    `;
    const result = checkInlineDrift(content, DS_EXPORTS, 'Page.tsx');
    expect(result.propMatches).toHaveLength(0);
  });

  it('exported function component → prop match still detected', () => {
    const content = `
      export function StepperInput({ value, onChange, min, max, step }: Props) {
        return <div />;
      }
    `;
    const result = checkInlineDrift(content, DS_EXPORTS, 'Page.tsx');
    expect(result.propMatches.some(m => m.matchedDs === 'NumberInput')).toBe(true);
  });

  it('utility file → skipped by pre-filter, no propMatches', () => {
    const content = `
      export function stepperInput({ value, onChange, min, max, step }: Props) {
        return { value };
      }
    `;
    const result = checkInlineDrift(content, DS_EXPORTS, 'utils.ts');
    expect(result.propMatches).toHaveLength(0);
  });
});

describe('DS_PROP_SIGNATURES', () => {
  it('NumberInput signature includes value, onChange, min, max, step', () => {
    const sig = DS_PROP_SIGNATURES['NumberInput'];
    expect(sig).toBeDefined();
    for (const prop of ['value', 'onChange', 'min', 'max', 'step']) {
      expect(sig, `expected ${prop} in NumberInput signature`).toContain(prop);
    }
  });

  it('InlineNotification signature includes kind, title, subtitle', () => {
    const sig = DS_PROP_SIGNATURES['InlineNotification'];
    expect(sig).toBeDefined();
    for (const prop of ['kind', 'title', 'subtitle']) {
      expect(sig, `expected ${prop} in InlineNotification signature`).toContain(prop);
    }
  });
});

// ── CARBON_TOKENS ─────────────────────────────────────────────────────────────

describe('CARBON_TOKENS', () => {
  it('includes high-specificity Carbon values', () => {
    expect(CARBON_TOKENS['#0f62fe']).toBeDefined(); // interactive blue
    expect(CARBON_TOKENS['#da1e28']).toBeDefined(); // error red
    expect(CARBON_TOKENS['#198038']).toBeDefined(); // success green
    expect(CARBON_TOKENS['#f1c21b']).toBeDefined(); // warning yellow
  });

  it('does not include generic web colors', () => {
    expect(CARBON_TOKENS['#ffffff']).toBeUndefined();
    expect(CARBON_TOKENS['#000000']).toBeUndefined();
    expect(CARBON_TOKENS['#cccccc']).toBeUndefined();
    expect(CARBON_TOKENS['#e0e0e0']).toBeUndefined(); // common gray, excluded
  });
});
