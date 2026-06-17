import { describe, it, expect } from 'vitest';

// buildComment is not exported from index.ts (it depends on @actions/* at module load).
// We inline a copy here that stays in sync with the implementation.
// If you change buildComment in src/index.ts, update this copy too.

const COMMENT_MARKER = '<!-- polder-drift-comment -->';
const MAX_TABLE_ROWS = 20;

interface FileResult {
  filename: string;
  result: {
    importDrift: { count: number; symbols: string[] };
    inlineDrift: {
      localShadows: string[];
      tokenFingerprints: { componentName: string; tokens: string[]; classNames: string[] }[];
      propMatches: { componentName: string; matchedDs: string; score: number; matchedProps: string[] }[];
    };
    totalCount: number;
  };
}

function buildComment(fileResults: FileResult[], capped: boolean): string {
  const totalSignals = fileResults.reduce((s, r) => s + r.result.totalCount, 0);
  const driftedFiles = fileResults.filter((r) => r.result.totalCount > 0);
  const lines: string[] = [COMMENT_MARKER, '## Polder — Design System Drift', ''];

  if (totalSignals === 0) {
    lines.push('✅ No design system drift detected in files touched by this PR.');
    if (capped) lines.push('', `> Analysis capped at ${MAX_TABLE_ROWS} files.`);
    return lines.join('\n');
  }

  lines.push(
    `⚠️ **${totalSignals} drift signal${totalSignals === 1 ? '' : 's'}** across ` +
      `${driftedFiles.length} file${driftedFiles.length === 1 ? '' : 's'} touched by this PR`,
  );
  lines.push('');

  const importRows: string[] = [];
  for (const { filename, result } of driftedFiles) {
    for (const sym of result.importDrift.symbols) {
      importRows.push(`| \`${filename}\` | \`${sym}\` |`);
    }
  }
  if (importRows.length > 0) {
    lines.push(`### 🔴 Import drift (${importRows.length})`);
    lines.push('DS component imported from a local path instead of the canonical package.');
    lines.push('');
    lines.push('| File | Symbol |');
    lines.push('|------|--------|');
    lines.push(...importRows.slice(0, MAX_TABLE_ROWS));
    if (importRows.length > MAX_TABLE_ROWS) {
      lines.push(`| … | _and ${importRows.length - MAX_TABLE_ROWS} more_ |`);
    }
    lines.push('');
  }

  const shadowRows: string[] = [];
  for (const { filename, result } of driftedFiles) {
    for (const name of result.inlineDrift.localShadows) {
      shadowRows.push(`| \`${filename}\` | \`${name}\` |`);
    }
  }
  if (shadowRows.length > 0) {
    lines.push(`### 🔴 Local shadows (${shadowRows.length})`);
    lines.push('Component defined in-file with the same name as a DS export.');
    lines.push('');
    lines.push('| File | Component |');
    lines.push('|------|-----------|');
    lines.push(...shadowRows.slice(0, MAX_TABLE_ROWS));
    if (shadowRows.length > MAX_TABLE_ROWS) {
      lines.push(`| … | _and ${shadowRows.length - MAX_TABLE_ROWS} more_ |`);
    }
    lines.push('');
  }

  const tokenRows: string[] = [];
  for (const { filename, result } of driftedFiles) {
    for (const fp of result.inlineDrift.tokenFingerprints) {
      const parts: string[] = [];
      if (fp.tokens.length > 0) parts.push(fp.tokens.map((t) => `\`${t}\``).join(', '));
      if (fp.classNames.length > 0) parts.push(fp.classNames.map((c) => `\`${c}\``).join(', '));
      tokenRows.push(`| \`${filename}\` | \`${fp.componentName}\` | ${parts.join(' · ')} |`);
    }
  }
  if (tokenRows.length > 0) {
    lines.push(`### 🟡 Token fingerprints (${tokenRows.length})`);
    lines.push('Locally-defined component body contains Carbon design tokens or `cds--` class names.');
    lines.push('');
    lines.push('| File | Component | Carbon signals |');
    lines.push('|------|-----------|----------------|');
    lines.push(...tokenRows.slice(0, MAX_TABLE_ROWS));
    if (tokenRows.length > MAX_TABLE_ROWS) {
      lines.push(`| … | | _and ${tokenRows.length - MAX_TABLE_ROWS} more_ |`);
    }
    lines.push('');
  }

  const propRows: string[] = [];
  for (const { filename, result } of driftedFiles) {
    for (const pm of result.inlineDrift.propMatches) {
      const pct = Math.round(pm.score * 100);
      propRows.push(
        `| \`${filename}\` | \`${pm.componentName}\` | \`${pm.matchedDs}\` | ${pct}% | ${pm.matchedProps.map((p) => `\`${p}\``).join(', ')} |`,
      );
    }
  }
  if (propRows.length > 0) {
    lines.push(`### 🟣 Prop signature matches (${propRows.length})`);
    lines.push("Locally-defined component's prop API closely mirrors a DS component.");
    lines.push('');
    lines.push('| File | Component | Matches DS | Score | Matched props |');
    lines.push('|------|-----------|------------|-------|---------------|');
    lines.push(...propRows.slice(0, MAX_TABLE_ROWS));
    if (propRows.length > MAX_TABLE_ROWS) {
      lines.push(`| … | | | | _and ${propRows.length - MAX_TABLE_ROWS} more_ |`);
    }
    lines.push('');
  }

  if (capped) {
    lines.push(`> ⚠️ Analysis capped at ${MAX_TABLE_ROWS} files. Large PRs may have additional drift.`);
    lines.push('');
  }

  return lines.join('\n');
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const clean: FileResult = {
  filename: 'src/components/Card.tsx',
  result: {
    importDrift: { count: 0, symbols: [] },
    inlineDrift: { localShadows: [], tokenFingerprints: [], propMatches: [] },
    totalCount: 0,
  },
};

const withImportDrift: FileResult = {
  filename: 'src/features/checkout/OrderSummary.tsx',
  result: {
    importDrift: { count: 1, symbols: ["Button from '../atoms/Button'"] },
    inlineDrift: { localShadows: [], tokenFingerprints: [], propMatches: [] },
    totalCount: 1,
  },
};

const withTokenFingerprint: FileResult = {
  filename: 'src/features/product/ProductCard.tsx',
  result: {
    importDrift: { count: 0, symbols: [] },
    inlineDrift: {
      localShadows: [],
      tokenFingerprints: [{ componentName: 'PillBadge', tokens: ['#da1e28', '#198038'], classNames: [] }],
      propMatches: [],
    },
    totalCount: 1,
  },
};

const withPropMatch: FileResult = {
  filename: 'src/components/forms/QuantityField.tsx',
  result: {
    importDrift: { count: 0, symbols: [] },
    inlineDrift: {
      localShadows: [],
      tokenFingerprints: [],
      propMatches: [{ componentName: 'QuantityField', matchedDs: 'NumberInput', score: 1.0, matchedProps: ['value', 'onChange', 'min', 'max', 'step', 'label', 'invalidText'] }],
    },
    totalCount: 1,
  },
};

const withShadow: FileResult = {
  filename: 'src/features/cart/CartDrawer.tsx',
  result: {
    importDrift: { count: 0, symbols: [] },
    inlineDrift: {
      localShadows: ['Button'],
      tokenFingerprints: [],
      propMatches: [],
    },
    totalCount: 1,
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildComment', () => {
  it('zero drift → clean message, contains marker', () => {
    const out = buildComment([clean], false);
    expect(out).toContain(COMMENT_MARKER);
    expect(out).toContain('✅ No design system drift');
    expect(out).not.toContain('⚠️');
  });

  it('zero drift with capped → mentions cap', () => {
    const out = buildComment([clean], true);
    expect(out).toContain('capped');
  });

  it('import drift → shows import drift section with file and symbol', () => {
    const out = buildComment([withImportDrift], false);
    expect(out).toContain('Import drift (1)');
    expect(out).toContain('OrderSummary.tsx');
    expect(out).toContain("Button from '../atoms/Button'");
  });

  it('token fingerprint → shows token section with component and tokens', () => {
    const out = buildComment([withTokenFingerprint], false);
    expect(out).toContain('Token fingerprints (1)');
    expect(out).toContain('PillBadge');
    expect(out).toContain('#da1e28');
    expect(out).toContain('#198038');
  });

  it('prop match → shows prop match section with score and matched props', () => {
    const out = buildComment([withPropMatch], false);
    expect(out).toContain('Prop signature matches (1)');
    expect(out).toContain('QuantityField');
    expect(out).toContain('NumberInput');
    expect(out).toContain('100%');
    expect(out).toContain('`value`');
  });

  it('local shadow → shows shadow section', () => {
    const out = buildComment([withShadow], false);
    expect(out).toContain('Local shadows (1)');
    expect(out).toContain('CartDrawer.tsx');
    expect(out).toContain('`Button`');
  });

  it('mixed signals → all sections present, total count correct', () => {
    const mixed: FileResult = {
      filename: 'src/features/checkout/Big.tsx',
      result: {
        importDrift: { count: 1, symbols: ["Modal from '../Modal'"] },
        inlineDrift: {
          localShadows: ['Button'],
          tokenFingerprints: [{ componentName: 'PriceTag', tokens: ['#da1e28'], classNames: [] }],
          propMatches: [{ componentName: 'QtySelector', matchedDs: 'NumberInput', score: 0.86, matchedProps: ['value', 'onChange', 'min', 'max', 'step', 'label'] }],
        },
        totalCount: 4,
      },
    };
    const out = buildComment([mixed], false);
    expect(out).toContain('4 drift signals');
    expect(out).toContain('Import drift');
    expect(out).toContain('Local shadows');
    expect(out).toContain('Token fingerprints');
    expect(out).toContain('Prop signature matches');
  });

  it('clean file mixed with drifted → clean file does not appear in tables', () => {
    const out = buildComment([clean, withImportDrift], false);
    expect(out).toContain('OrderSummary.tsx');
    expect(out).not.toContain('Card.tsx');
  });

  it('capped flag → warning appears in drifted comment', () => {
    const out = buildComment([withImportDrift], true);
    expect(out).toContain('capped');
  });

  it('always contains the COMMENT_MARKER for upsert detection', () => {
    for (const results of [[clean], [withImportDrift], [withTokenFingerprint]]) {
      expect(buildComment(results, false)).toContain(COMMENT_MARKER);
    }
  });

  it('token fingerprint with classNames — both appear in output', () => {
    const withClass: FileResult = {
      filename: 'src/components/ui/NavItem.tsx',
      result: {
        importDrift: { count: 0, symbols: [] },
        inlineDrift: {
          localShadows: [],
          tokenFingerprints: [{ componentName: 'NavItem', tokens: ['#0f62fe'], classNames: ['cds--side-nav__item'] }],
          propMatches: [],
        },
        totalCount: 1,
      },
    };
    const out = buildComment([withClass], false);
    expect(out).toContain('#0f62fe');
    expect(out).toContain('cds--side-nav__item');
  });
});
