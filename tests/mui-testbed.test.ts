import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { resolveExports, checkDrift, checkInlineDrift, checkDriftFull, DS_PROP_SIGNATURES, MUI_TOKENS, DS_SUBCOMPONENT_MAP, DS_NAME_SEGMENTS } from '../src/parser';

const SCENARIOS = path.resolve(__dirname, 'fixtures/mui');
const NODE_MODULES = path.resolve(__dirname, '../node_modules');
const CANONICAL = ['@mui/material', '@mui/icons-material'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function readScenario(name: string): string {
  return fs.readFileSync(path.join(SCENARIOS, name), 'utf8');
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let muiExports: Set<string>;

beforeAll(() => {
  muiExports = new Set<string>();
  for (const pkg of CANONICAL) {
    for (const name of resolveExports(pkg, NODE_MODULES)) {
      muiExports.add(name);
    }
  }
});

// ── Export resolution ─────────────────────────────────────────────────────────

describe('MUI export resolution', () => {
  it('resolves exports from installed node_modules', () => {
    expect(muiExports.size).toBeGreaterThan(0);
  });

  it('includes core MUI components used by the testbed', () => {
    for (const name of ['Button', 'Chip', 'Rating', 'Slider', 'Badge', 'Select', 'Card']) {
      expect(muiExports.has(name), `expected ${name} in MUI exports`).toBe(true);
    }
  });
});

// ── Phase 1: import drift ─────────────────────────────────────────────────────

describe('Phase 1 — import drift (MUI testbed)', () => {
  it('clean PLP — no import drift (all imports from @mui/material)', () => {
    const content = readScenario('PLPScenario.tsx');
    const result = checkDrift(content, muiExports, CANONICAL, [], 'PLPScenario.tsx');
    expect(result.driftCount).toBe(0);
    expect(result.driftedSymbols).toHaveLength(0);
  });

  it('drifted PLP — no import drift (drifted components are defined inline, not imported locally)', () => {
    // The drifted file still imports from @mui/material for layout primitives.
    // Drift is inlined — we expect zero import drift but non-zero inline drift.
    const content = readScenario('PLPDriftedScenario.tsx');
    const result = checkDrift(content, muiExports, CANONICAL, [], 'PLPDriftedScenario.tsx');
    expect(result.driftCount).toBe(0);
  });
});

// ── Phase 2: token fingerprints ───────────────────────────────────────────────

describe('Phase 2 — token fingerprints (MUI testbed)', () => {
  it('clean PLP — no MUI token fingerprints', () => {
    const content = readScenario('PLPScenario.tsx');
    const result = checkInlineDrift(content, muiExports, 'PLPScenario.tsx');
    // Real MUI components use theme tokens, not hardcoded hex values
    expect(result.tokenFingerprints).toHaveLength(0);
  });

  it('drifted PLP — StarRating detected via #ed6c02 (MUI warning.main)', () => {
    const content = readScenario('PLPDriftedScenario.tsx');
    const result = checkInlineDrift(content, muiExports, 'PLPDriftedScenario.tsx');
    const starRating = result.tokenFingerprints.find((fp) => fp.componentName === 'StarRating');
    expect(starRating).toBeDefined();
    expect(starRating?.tokens).toContain('#ed6c02');
  });

  it('drifted PLP — LabelChip detected via #1976d2 (MUI primary.main)', () => {
    const content = readScenario('PLPDriftedScenario.tsx');
    const result = checkInlineDrift(content, muiExports, 'PLPDriftedScenario.tsx');
    const labelChip = result.tokenFingerprints.find((fp) => fp.componentName === 'LabelChip');
    expect(labelChip).toBeDefined();
    expect(labelChip?.tokens).toContain('#1976d2');
    expect(labelChip?.tokens).toContain('#d32f2f');
  });

  it('drifted PLP — PriceSlider detected via #1976d2 (MUI primary.main)', () => {
    const content = readScenario('PLPDriftedScenario.tsx');
    const result = checkInlineDrift(content, muiExports, 'PLPDriftedScenario.tsx');
    const priceSlider = result.tokenFingerprints.find((fp) => fp.componentName === 'PriceSlider');
    expect(priceSlider).toBeDefined();
    expect(priceSlider?.tokens).toContain('#1976d2');
  });

  it('drifted PLP — CartCounter detected via #d32f2f (MUI error.main)', () => {
    const content = readScenario('PLPDriftedScenario.tsx');
    const result = checkInlineDrift(content, muiExports, 'PLPDriftedScenario.tsx');
    const cartCounter = result.tokenFingerprints.find((fp) => fp.componentName === 'CartCounter');
    expect(cartCounter).toBeDefined();
    expect(cartCounter?.tokens).toContain('#d32f2f');
  });

  it('drifted PLP — at least 4 token fingerprints detected', () => {
    const content = readScenario('PLPDriftedScenario.tsx');
    const result = checkInlineDrift(content, muiExports, 'PLPDriftedScenario.tsx');
    expect(result.tokenFingerprints.length).toBeGreaterThanOrEqual(4);
  });
});

// ── Phase 3: prop-signature matching ─────────────────────────────────────────

describe('Phase 3 — prop-signature matching (MUI testbed)', () => {
  it('clean PLP — no prop matches (real MUI components, no custom forks)', () => {
    const content = readScenario('PLPScenario.tsx');
    const result = checkInlineDrift(content, muiExports, 'PLPScenario.tsx');
    expect(result.propMatches).toHaveLength(0);
  });

  it('drifted PLP — StarRating matches MuiRating (score ≥ 0.8)', () => {
    const content = readScenario('PLPDriftedScenario.tsx');
    const result = checkInlineDrift(content, muiExports, 'PLPDriftedScenario.tsx');
    const match = result.propMatches.find(
      (m) => m.componentName === 'StarRating' && m.matchedDs === 'MuiRating',
    );
    expect(match).toBeDefined();
    expect(match!.score).toBeGreaterThanOrEqual(0.8);
    expect(match!.matchedProps).toContain('value');
    expect(match!.matchedProps).toContain('onChange');
    expect(match!.matchedProps).toContain('readOnly');
  });

  it('drifted PLP — LabelChip matches MuiChip (score ≥ 0.6)', () => {
    const content = readScenario('PLPDriftedScenario.tsx');
    const result = checkInlineDrift(content, muiExports, 'PLPDriftedScenario.tsx');
    const match = result.propMatches.find(
      (m) => m.componentName === 'LabelChip' && m.matchedDs === 'MuiChip',
    );
    expect(match).toBeDefined();
    expect(match!.score).toBeGreaterThanOrEqual(0.6);
    expect(match!.matchedProps).toContain('label');
    expect(match!.matchedProps).toContain('onDelete');
    expect(match!.matchedProps).toContain('color');
  });

  it('drifted PLP — PriceSlider matches MuiSlider (score ≥ 0.6)', () => {
    const content = readScenario('PLPDriftedScenario.tsx');
    const result = checkInlineDrift(content, muiExports, 'PLPDriftedScenario.tsx');
    const match = result.propMatches.find(
      (m) => m.componentName === 'PriceSlider' && m.matchedDs === 'MuiSlider',
    );
    expect(match).toBeDefined();
    expect(match!.score).toBeGreaterThanOrEqual(0.6);
    expect(match!.matchedProps).toContain('value');
    expect(match!.matchedProps).toContain('onChange');
    expect(match!.matchedProps).toContain('min');
    expect(match!.matchedProps).toContain('max');
  });

  it('drifted PLP — CartCounter matches MuiBadge (score ≥ 0.6)', () => {
    const content = readScenario('PLPDriftedScenario.tsx');
    const result = checkInlineDrift(content, muiExports, 'PLPDriftedScenario.tsx');
    const match = result.propMatches.find(
      (m) => m.componentName === 'CartCounter' && m.matchedDs === 'MuiBadge',
    );
    expect(match).toBeDefined();
    expect(match!.score).toBeGreaterThanOrEqual(0.6);
    expect(match!.matchedProps).toContain('badgeContent');
    expect(match!.matchedProps).toContain('color');
  });

  it('drifted PLP — SortDropdown matches MuiSelect (score = 1.0)', () => {
    const content = readScenario('PLPDriftedScenario.tsx');
    const result = checkInlineDrift(content, muiExports, 'PLPDriftedScenario.tsx');
    const match = result.propMatches.find(
      (m) => m.componentName === 'SortDropdown' && m.matchedDs === 'MuiSelect',
    );
    expect(match).toBeDefined();
    expect(match!.score).toBe(1.0);
    expect(match!.matchedProps).toContain('value');
    expect(match!.matchedProps).toContain('onChange');
    expect(match!.matchedProps).toContain('label');
    expect(match!.matchedProps).toContain('multiple');
    expect(match!.matchedProps).toContain('renderValue');
    expect(match!.matchedProps).toContain('disabled');
  });

  it('SimpleProductCard — Phase 1/2/3 still miss it (single prop, no MUI tokens)', () => {
    const content = readScenario('PLPDriftedScenario.tsx');
    const result = checkDriftFull(content, muiExports, CANONICAL, [], 'PLPDriftedScenario.tsx');
    const shadowMatch = result.inlineDrift.localShadows.includes('SimpleProductCard');
    const tokenMatch = result.inlineDrift.tokenFingerprints.some(
      (fp) => fp.componentName === 'SimpleProductCard',
    );
    const propMatch = result.inlineDrift.propMatches.some(
      (m) => m.componentName === 'SimpleProductCard',
    );
    // Phase 1, 2, 3 all miss it — Phase 4 catches it
    expect(shadowMatch).toBe(false);
    expect(tokenMatch).toBe(false);
    expect(propMatch).toBe(false);
  });
});

// ── Phase 4: sub-component detection ─────────────────────────────────────────

describe('Phase 4 — sub-component detection (MUI testbed)', () => {
  it('clean PLP — no sub-component matches (ProductCard wraps real MUI Card, not a reimplementation)', () => {
    const content = readScenario('PLPScenario.tsx');
    const result = checkInlineDrift(content, muiExports, 'PLPScenario.tsx');
    expect(result.subComponentMatches).toHaveLength(0);
  });

  it('drifted PLP — SimpleProductCard caught via CardMedia (uses sub-component without parent)', () => {
    const content = readScenario('PLPDriftedScenario.tsx');
    const result = checkInlineDrift(content, muiExports, 'PLPDriftedScenario.tsx');
    const match = result.subComponentMatches.find(m => m.componentName === 'SimpleProductCard');
    expect(match).toBeDefined();
    expect(match?.matchedDs).toBe('MuiCard');
    expect(match?.subComponentsUsed).toContain('CardMedia');
  });

  it('drifted PLP — SimpleProductCard has high confidence (sub-component + name segment)', () => {
    const content = readScenario('PLPDriftedScenario.tsx');
    const result = checkInlineDrift(content, muiExports, 'PLPDriftedScenario.tsx');
    const match = result.subComponentMatches.find(m => m.componentName === 'SimpleProductCard');
    expect(match?.confidence).toBe('high');
    expect(match?.nameSegment).toBe('Card');
  });

  it('drifted PLP — exactly 1 sub-component match (only SimpleProductCard is a reimplementation)', () => {
    const content = readScenario('PLPDriftedScenario.tsx');
    const result = checkInlineDrift(content, muiExports, 'PLPDriftedScenario.tsx');
    expect(result.subComponentMatches).toHaveLength(1);
  });

  it('clean PLP — totalCount is still 0 after Phase 4 added', () => {
    const content = readScenario('PLPScenario.tsx');
    const result = checkDriftFull(content, muiExports, CANONICAL, [], 'PLPScenario.tsx');
    expect(result.totalCount).toBe(0);
  });
});

// ── Phase 4: DS_SUBCOMPONENT_MAP + DS_NAME_SEGMENTS ──────────────────────────

describe('DS_SUBCOMPONENT_MAP', () => {
  it('CardMedia, CardContent, CardHeader, CardActions all map to MuiCard', () => {
    expect(DS_SUBCOMPONENT_MAP['CardMedia']).toBe('MuiCard');
    expect(DS_SUBCOMPONENT_MAP['CardContent']).toBe('MuiCard');
    expect(DS_SUBCOMPONENT_MAP['CardHeader']).toBe('MuiCard');
    expect(DS_SUBCOMPONENT_MAP['CardActions']).toBe('MuiCard');
  });

  it('Dialog family maps to MuiDialog', () => {
    expect(DS_SUBCOMPONENT_MAP['DialogTitle']).toBe('MuiDialog');
    expect(DS_SUBCOMPONENT_MAP['DialogContent']).toBe('MuiDialog');
    expect(DS_SUBCOMPONENT_MAP['DialogActions']).toBe('MuiDialog');
  });

  it('Carbon DataTable sub-components map to DataTable', () => {
    expect(DS_SUBCOMPONENT_MAP['TableToolbar']).toBe('DataTable');
    expect(DS_SUBCOMPONENT_MAP['TableSelectRow']).toBe('DataTable');
    expect(DS_SUBCOMPONENT_MAP['TableExpandRow']).toBe('DataTable');
  });
});

describe('DS_NAME_SEGMENTS', () => {
  it('Card maps to MuiCard', () => {
    expect(DS_NAME_SEGMENTS['Card']).toBe('MuiCard');
  });

  it('includes distinctive MUI segments', () => {
    for (const seg of ['Slider', 'Rating', 'Chip', 'Badge', 'Dialog', 'Accordion']) {
      expect(DS_NAME_SEGMENTS[seg], `expected ${seg} in DS_NAME_SEGMENTS`).toBeDefined();
    }
  });

  it('does not include generic words that would cause false positives', () => {
    expect(DS_NAME_SEGMENTS['Button']).toBeUndefined();
    expect(DS_NAME_SEGMENTS['Input']).toBeUndefined();
    expect(DS_NAME_SEGMENTS['Text']).toBeUndefined();
    expect(DS_NAME_SEGMENTS['Icon']).toBeUndefined();
  });
});

// ── Combined: checkDriftFull ──────────────────────────────────────────────────

describe('checkDriftFull (MUI testbed)', () => {
  it('clean PLP — totalCount is 0', () => {
    const content = readScenario('PLPScenario.tsx');
    const result = checkDriftFull(content, muiExports, CANONICAL, [], 'PLPScenario.tsx');
    expect(result.totalCount).toBe(0);
  });

  it('drifted PLP — totalCount ≥ 10 (5 prop matches + 4 token fingerprints + 1 sub-component)', () => {
    const content = readScenario('PLPDriftedScenario.tsx');
    const result = checkDriftFull(content, muiExports, CANONICAL, [], 'PLPDriftedScenario.tsx');
    expect(result.totalCount).toBeGreaterThanOrEqual(10);
  });

  it('drifted PLP — finds both prop matches and token fingerprints', () => {
    const content = readScenario('PLPDriftedScenario.tsx');
    const result = checkDriftFull(content, muiExports, CANONICAL, [], 'PLPDriftedScenario.tsx');
    expect(result.inlineDrift.propMatches.length).toBeGreaterThanOrEqual(4);
    expect(result.inlineDrift.tokenFingerprints.length).toBeGreaterThanOrEqual(4);
    expect(result.importDrift.count).toBe(0); // all drift is inline, not import-based
  });
});

// ── MUI_TOKENS coverage ───────────────────────────────────────────────────────

describe('MUI_TOKENS', () => {
  it('covers primary, error, success, warning, info palettes', () => {
    expect(MUI_TOKENS['#1976d2']).toMatch(/primary/);
    expect(MUI_TOKENS['#d32f2f']).toMatch(/error/);
    expect(MUI_TOKENS['#2e7d32']).toMatch(/success/);
    expect(MUI_TOKENS['#ed6c02']).toMatch(/warning/);
    expect(MUI_TOKENS['#0288d1']).toMatch(/info/);
  });

  it('has 15 MUI token entries', () => {
    expect(Object.keys(MUI_TOKENS)).toHaveLength(15);
  });
});

// ── DS_PROP_SIGNATURES MUI entries ────────────────────────────────────────────

describe('DS_PROP_SIGNATURES — MUI entries', () => {
  it('MuiSlider signature includes value, onChange, min, max, step', () => {
    expect(DS_PROP_SIGNATURES.MuiSlider).toEqual(
      expect.arrayContaining(['value', 'onChange', 'min', 'max', 'step']),
    );
  });

  it('MuiRating signature includes value, onChange, precision, readOnly', () => {
    expect(DS_PROP_SIGNATURES.MuiRating).toEqual(
      expect.arrayContaining(['value', 'onChange', 'precision', 'readOnly']),
    );
  });

  it('MuiChip signature includes label, onDelete, color', () => {
    expect(DS_PROP_SIGNATURES.MuiChip).toEqual(
      expect.arrayContaining(['label', 'onDelete', 'color']),
    );
  });

  it('MuiBadge signature includes badgeContent, color, max', () => {
    expect(DS_PROP_SIGNATURES.MuiBadge).toEqual(
      expect.arrayContaining(['badgeContent', 'color', 'max']),
    );
  });

  it('MuiSelect signature includes value, onChange, label, multiple, renderValue, disabled', () => {
    expect(DS_PROP_SIGNATURES.MuiSelect).toEqual(
      expect.arrayContaining(['value', 'onChange', 'label', 'multiple', 'renderValue', 'disabled']),
    );
  });
});
