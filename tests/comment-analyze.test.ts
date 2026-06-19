import { describe, it, expect } from 'vitest';
import { analyzePr, type AnalyzeParams } from '../src/comment/analyze';

const HEAD = `import { Tile } from '@acme/ds';\nimport { Button } from './ui/Button';\nexport const X = () => <Button />;\n`;
const BASE_CLEAN = `import { Tile } from '@acme/ds';\nexport const X = () => <Tile />;\n`;

function base(over: Partial<AnalyzeParams> = {}): AnalyzeParams {
  return {
    files: ['src/X.tsx'],
    readCurrent: () => HEAD,
    dsExports: new Set(['Button', 'Tile']),
    canonicalPkgs: ['@acme/ds'],
    allowlist: [],
    suppress: { ids: new Set(), rules: new Set(), globs: [] },
    ...over,
  };
}

describe('analyzePr', () => {
  it('flags new drift, counts canonical usage, computes adoption', () => {
    const r = analyzePr(base({ readBase: () => BASE_CLEAN }));
    expect(r.shouldComment).toBe(true);
    expect(r.totalFindings).toBe(1); // Button import drift
    // head: 1 canonical (Tile) + 1 drift (Button) => 50%
    expect(Math.round(r.adoptionPct!)).toBe(50);
    expect(r.newFindings).toHaveLength(1);
    expect(r.body).toContain('Design system adoption: 50%');
    // base adoption 100% -> delta -50 pts
    expect(r.body).toContain('-50.0 pts');
  });

  it('a local component that trips several inline signals counts as ONE drifted component', () => {
    // `ProductCard` reimplements a DS component and trips three inline rules at once:
    // token-fingerprint (#0f62fe + cds-- class), prop-match (MuiChip prop signature),
    // and subcomponent (<CardMedia>/<CardContent> without a real <Card>, name "Card").
    const MULTI =
      `import { Tile } from '@acme/ds';\n` +
      `export const ProductCard = ({ label, onDelete, color, size, variant, icon, disabled }) => {\n` +
      `  return (\n` +
      `    <div className="cds--tile" style={{ color: '#0f62fe' }}>\n` +
      `      <CardMedia />\n` +
      `      <CardContent />\n` +
      `    </div>\n` +
      `  );\n` +
      `};\n`;
    const r = analyzePr(base({ readCurrent: () => MULTI }));
    expect(r.totalFindings).toBe(3); // three raw findings on one component
    // 1 canonical (Tile) vs 1 drifted component => 50%, NOT 1/(1+3)=25% as the old
    // finding-count metric reported (a single drift would have dominated the headline).
    expect(Math.round(r.adoptionPct!)).toBe(50);
    expect(r.body).toContain('Design system adoption: 50%');
  });

  it('stays quiet when the same drift already exists on base', () => {
    const r = analyzePr(base({ readBase: () => HEAD }));
    expect(r.shouldComment).toBe(false);
    expect(r.existingFindings).toHaveLength(1);
    expect(r.newFindings).toHaveLength(0);
  });

  it('with no base reader, all findings are treated as new', () => {
    const r = analyzePr(base());
    expect(r.shouldComment).toBe(true);
    expect(r.newFindings).toHaveLength(1);
  });

  it('suppression removes the finding entirely', () => {
    const r = analyzePr(
      base({ suppress: { ids: new Set(), rules: new Set(['import-drift']), globs: [] } }),
    );
    expect(r.totalFindings).toBe(0);
    expect(r.shouldComment).toBe(false);
  });

  it('git attribution flows onto findings via the injected blame reader', () => {
    const r = analyzePr(base({ blame: () => 'cafebabecafebabe' }));
    expect(r.newFindings[0].commit).toBe('cafebabecafebabe');
    expect(r.body).toContain('@cafebab');
  });

  it('skips unreadable files without throwing', () => {
    const r = analyzePr(base({ files: ['gone.tsx', 'src/X.tsx'], readCurrent: (f) => (f === 'gone.tsx' ? null : HEAD) }));
    expect(r.totalFindings).toBe(1);
  });
});
