import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { resolveExports, checkDrift, checkInlineDrift, checkDriftFull, DS_PROP_SIGNATURES } from '../src/parser';

const SCENARIOS = path.resolve(__dirname, 'fixtures/carbon');
const NODE_MODULES = path.resolve(__dirname, '../node_modules');
const CANONICAL = ['@carbon/react', '@carbon/icons-react'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function readScenario(name: string): string {
  return fs.readFileSync(path.join(SCENARIOS, name), 'utf8');
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let carbonExports: Set<string>;

beforeAll(() => {
  carbonExports = new Set<string>();
  for (const pkg of CANONICAL) {
    for (const name of resolveExports(pkg, NODE_MODULES)) {
      carbonExports.add(name);
    }
  }
});

// ── Export resolution ─────────────────────────────────────────────────────────

describe('Carbon export resolution', () => {
  it('resolves exports from installed node_modules', () => {
    expect(carbonExports.size).toBeGreaterThan(0);
  });

  it('includes core components used by the testbed', () => {
    for (const name of ['Button', 'Tag', 'Tile', 'Modal', 'TextInput', 'IconButton']) {
      expect(carbonExports.has(name), `expected ${name} in Carbon exports`).toBe(true);
    }
  });

  it('includes icons from @carbon/icons-react', () => {
    for (const name of ['ShoppingCart', 'Bookmark', 'StarFilled']) {
      expect(carbonExports.has(name), `expected ${name} in Carbon exports`).toBe(true);
    }
  });
});

// ── Clean scenarios ───────────────────────────────────────────────────────────

describe('Clean scenarios (Product Cards)', () => {
  it('reports 0 drift — all imports are canonical', () => {
    const content = readScenario('ProductCardsScenario.tsx');
    const { driftCount, driftedSymbols } = checkDrift(
      content, carbonExports, CANONICAL, [], 'ProductCardsScenario.tsx',
    );
    expect(driftCount).toBe(0);
    expect(driftedSymbols).toHaveLength(0);
  });

  it('reports 0 drift — form scenario', () => {
    const { driftCount } = checkDrift(
      readScenario('FormScenario.tsx'), carbonExports, CANONICAL, [], 'FormScenario.tsx',
    );
    expect(driftCount).toBe(0);
  });

  it('reports 0 drift — notification scenario', () => {
    const { driftCount } = checkDrift(
      readScenario('NotificationScenario.tsx'), carbonExports, CANONICAL, [], 'NotificationScenario.tsx',
    );
    expect(driftCount).toBe(0);
  });

  it('reports 0 drift — modal scenario', () => {
    const { driftCount } = checkDrift(
      readScenario('ModalScenario.tsx'), carbonExports, CANONICAL, [], 'ModalScenario.tsx',
    );
    expect(driftCount).toBe(0);
  });
});

// ── Drifted scenario ──────────────────────────────────────────────────────────

describe('Product Cards II (drifted)', () => {
  it('reports 0 import-level drift — all top-level imports are still canonical', () => {
    const content = readScenario('ProductCardsDriftedScenario.tsx');
    const { driftCount } = checkDrift(
      content, carbonExports, CANONICAL, [], 'ProductCardsDriftedScenario.tsx',
    );
    // The file imports @carbon/react and @carbon/icons-react at the top —
    // those are canonical. The drift is expressed differently, which is the
    // gap this test suite is here to document.
    expect(driftCount).toBe(0);
  });

  it('KNOWN GAP: inline-defined component shadowing a DS export is not detected', () => {
    // Reproduces the pattern used in Product Cards II: a function defined
    // in the same file as a drop-in for a Carbon component. Since no
    // non-canonical import statement exists, import-level analysis reports clean.
    const inline = `
      import { Button, Tag } from '@carbon/react';

      function CardShell({ children }: { children: React.ReactNode }) {
        return <div style={{ background: '#f4f4f4', border: '1px solid #e0e0e0' }}>{children}</div>;
      }

      export function Card() {
        return <CardShell><Button>Buy</Button></CardShell>;
      }
    `;
    const { driftCount } = checkDrift(inline, carbonExports, CANONICAL, [], 'Card.tsx');
    expect(driftCount).toBe(0); // Tool reports clean — false negative.
  });

  it('KNOWN GAP: cross-file inline drift is not detected when importing from a local barrel', () => {
    // A team might move their custom components to a shared file and import from there.
    // As long as none of those symbols match Carbon export names, the checker stays silent.
    const withBarrel = `
      import { Button } from '@carbon/react';
      import { CardShell, PillBadge, StepperInput } from '../components/custom';

      export function Page() {
        return <CardShell><PillBadge>Sale</PillBadge><Button>Buy</Button></CardShell>;
      }
    `;
    const { driftCount } = checkDrift(withBarrel, carbonExports, CANONICAL, [], 'Page.tsx');
    // CardShell / PillBadge / StepperInput are not in Carbon's exports → silent.
    expect(driftCount).toBe(0);
  });
});

// ── What the tool DOES catch ──────────────────────────────────────────────────

describe('Import-level drift detection (confirmed coverage)', () => {
  it('flags a Carbon symbol imported from a local path instead of @carbon/react', () => {
    const content = `
      import { Tile, Tag } from '@carbon/react';
      import { Button } from '../components/CustomButton';
      export function Card() { return <Tile><Button>Buy</Button></Tile>; }
    `;
    const { driftCount, driftedSymbols } = checkDrift(
      content, carbonExports, CANONICAL, [], 'Card.tsx',
    );
    expect(driftCount).toBe(1);
    expect(driftedSymbols[0]).toContain('Button');
  });

  it('flags multiple drifted symbols in one import statement', () => {
    const content = `
      import { Button, Modal } from '../components';
      export function Page() { return <Button />; }
    `;
    const { driftCount, driftedSymbols } = checkDrift(
      content, carbonExports, CANONICAL, [], 'Page.tsx',
    );
    expect(driftCount).toBe(2);
    expect(driftedSymbols.some(s => s.includes('Button'))).toBe(true);
    expect(driftedSymbols.some(s => s.includes('Modal'))).toBe(true);
  });

  it('does not flag a symbol that shadows Carbon only by coincidence if it is allowlisted', () => {
    const content = `
      import { Button } from '#ds-wrappers/Button';
      export function Page() { return <Button />; }
    `;
    const { driftCount } = checkDrift(
      content, carbonExports, CANONICAL, ['#ds-wrappers/'], 'Page.tsx',
    );
    expect(driftCount).toBe(0);
  });

  it('does not flag third-party packages that happen to export a matching name', () => {
    const content = `
      import { Button } from 'some-other-lib';
      export function Page() { return <Button />; }
    `;
    const { driftCount } = checkDrift(
      content, carbonExports, CANONICAL, [], 'Page.tsx',
    );
    expect(driftCount).toBe(0);
  });
});

// ── Phase 2: inline drift against testbed ────────────────────────────────────

describe('Phase 2 — inline drift (carbon-testbed)', () => {
  it('clean scenario has no local shadows', () => {
    const content = readScenario('ProductCardsScenario.tsx');
    const { localShadows } = checkInlineDrift(
      content, carbonExports, 'ProductCardsScenario.tsx',
    );
    expect(localShadows).toHaveLength(0);
  });

  it('drifted scenario has no local shadows (custom components use different names)', () => {
    // None of the custom component names (CardShell, PillBadge, etc.) match Carbon exports —
    // this is the harder-to-catch drift pattern that token fingerprinting addresses.
    const content = readScenario('ProductCardsDriftedScenario.tsx');
    const { localShadows } = checkInlineDrift(
      content, carbonExports, 'ProductCardsDriftedScenario.tsx',
    );
    expect(localShadows).toHaveLength(0);
  });

  it('drifted scenario has more token fingerprints than clean scenario', () => {
    const cleanResult = checkInlineDrift(
      readScenario('ProductCardsScenario.tsx'), carbonExports, 'ProductCardsScenario.tsx',
    );
    const driftedResult = checkInlineDrift(
      readScenario('ProductCardsDriftedScenario.tsx'), carbonExports, 'ProductCardsDriftedScenario.tsx',
    );
    expect(driftedResult.tokenFingerprints.length).toBeGreaterThan(
      cleanResult.tokenFingerprints.length,
    );
  });

  it('drifted scenario: specific custom components are fingerprinted', () => {
    const content = readScenario('ProductCardsDriftedScenario.tsx');
    const { tokenFingerprints } = checkInlineDrift(
      content, carbonExports, 'ProductCardsDriftedScenario.tsx',
    );
    const names = tokenFingerprints.map(f => f.componentName);

    // These custom components use Carbon token values in their bodies
    expect(names).toContain('PillBadge');
    expect(names).toContain('GhostIconBtn');
    expect(names).toContain('PromoStrip');
    expect(names).toContain('StockDot');
  });

  it('PillBadge fingerprint includes Carbon error and success tokens', () => {
    const content = readScenario('ProductCardsDriftedScenario.tsx');
    const { tokenFingerprints } = checkInlineDrift(
      content, carbonExports, 'ProductCardsDriftedScenario.tsx',
    );
    const pill = tokenFingerprints.find(f => f.componentName === 'PillBadge');
    expect(pill).toBeDefined();
    expect(pill!.tokens).toContain('#da1e28'); // Carbon support-error
    expect(pill!.tokens).toContain('#198038'); // Carbon support-success
  });

  it('checkDriftFull: drifted scenario reports higher totalCount than clean', () => {
    const clean = checkDriftFull(
      readScenario('ProductCardsScenario.tsx'),
      carbonExports, CANONICAL, [], 'ProductCardsScenario.tsx',
    );
    const drifted = checkDriftFull(
      readScenario('ProductCardsDriftedScenario.tsx'),
      carbonExports, CANONICAL, [], 'ProductCardsDriftedScenario.tsx',
    );
    expect(drifted.totalCount).toBeGreaterThan(clean.totalCount);
  });
});

// ── Phase 3 — prop-signature matching ────────────────────────────────────────

describe('Phase 3 — prop-signature matching (carbon-testbed)', () => {
  it('clean scenario has no prop matches', () => {
    const content = readScenario('ProductCardsScenario.tsx');
    const { inlineDrift } = checkDriftFull(
      content, carbonExports, CANONICAL, [], 'ProductCardsScenario.tsx',
    );
    expect(inlineDrift.propMatches).toHaveLength(0);
  });

  it('KNOWN GAP: drifted scenario has no prop matches — custom components use stripped-down APIs', () => {
    // The testbed's custom components (StepperInput: {value,onChange}, PromoStrip: {text},
    // GhostIconBtn: {label,children,onClick}) all expose fewer than 60% of the corresponding
    // DS component's signature — deliberately minimal to stay under the match threshold.
    // Phase 3 catches more faithful forks that copy a larger slice of the DS API surface.
    const content = readScenario('ProductCardsDriftedScenario.tsx');
    const { inlineDrift } = checkDriftFull(
      content, carbonExports, CANONICAL, [], 'ProductCardsDriftedScenario.tsx',
    );
    expect(inlineDrift.propMatches).toHaveLength(0);
  });

  it('synthetic faithful NumberInput fork → caught by prop match', () => {
    // A fork that copies most of the NumberInput API triggers a match.
    const content = `
      import { Button } from '@carbon/react';
      function StepperInput({ value, onChange, min, max, step, label, invalidText }: Props) {
        return <div><button>-</button><span>{value}</span><button>+</button></div>;
      }
      export function Page() {
        return <StepperInput value={1} onChange={() => {}} min={0} max={10} step={1} label="Qty" invalidText="Required" />;
      }
    `;
    const { inlineDrift } = checkDriftFull(
      content, carbonExports, CANONICAL, [], 'Page.tsx',
    );
    expect(inlineDrift.propMatches.some(m => m.matchedDs === 'NumberInput')).toBe(true);
    const match = inlineDrift.propMatches.find(m => m.matchedDs === 'NumberInput')!;
    expect(match.componentName).toBe('StepperInput');
    expect(match.score).toBeGreaterThanOrEqual(0.6);
  });

  it('synthetic faithful Modal fork → caught by prop match', () => {
    const content = `
      function CustomModal({ open, onRequestClose, modalHeading, primaryButtonText, secondaryButtonText }: Props) {
        if (!open) return null;
        return <div role="dialog"><h2>{modalHeading}</h2></div>;
      }
      export function Page() { return <CustomModal open={true} onRequestClose={() => {}} modalHeading="Confirm" primaryButtonText="OK" secondaryButtonText="Cancel" />; }
    `;
    const { inlineDrift } = checkDriftFull(
      content, carbonExports, CANONICAL, [], 'Page.tsx',
    );
    expect(inlineDrift.propMatches.some(m => m.matchedDs === 'Modal')).toBe(true);
  });

  it('DS_PROP_SIGNATURES covers all Carbon components used in the testbed', () => {
    // Every component appearing in the drifted testbed that has a DS counterpart
    // should have a signature in the map.
    for (const name of ['NumberInput', 'InlineNotification', 'Modal', 'Toggle', 'Dropdown']) {
      expect(DS_PROP_SIGNATURES[name], `${name} missing from DS_PROP_SIGNATURES`).toBeDefined();
    }
  });
});
