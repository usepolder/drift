import { describe, it, expect } from 'vitest';
import { flattenFindings, findingId, countDriftedComponents, type Finding } from '../src/comment/findings';
import { parseSuppressions, applySuppressions, isSuppressed } from '../src/comment/suppress';
import { renderComment, COMMENT_MARKER } from '../src/comment/render';
import type { FullDriftResult } from '../src/parser';

function result(over: Partial<FullDriftResult['inlineDrift']> = {}, symbols: string[] = []): FullDriftResult {
  const inlineDrift = {
    localShadows: [],
    tokenFingerprints: [],
    propMatches: [],
    subComponentMatches: [],
    ...over,
  };
  const count =
    symbols.length +
    inlineDrift.localShadows.length +
    inlineDrift.tokenFingerprints.length +
    inlineDrift.propMatches.length +
    inlineDrift.subComponentMatches.length;
  return { importDrift: { count: symbols.length, symbols }, inlineDrift, totalCount: count };
}

describe('flattenFindings + stable ids', () => {
  it('flattens all five rule types', () => {
    const r = result(
      {
        localShadows: ['Button'],
        tokenFingerprints: [{ componentName: 'Card', tokens: ['#161616'], classNames: ['cds--btn'] }],
        propMatches: [{ componentName: 'Stepper', matchedDs: 'NumberInput', matchedProps: ['min', 'max'], score: 0.7 }],
        subComponentMatches: [
          { componentName: 'MyCard', matchedDs: 'MuiCard', subComponentsUsed: ['CardMedia'], nameSegment: 'Card', confidence: 'high' },
        ],
      },
      ["Button from './ui/Button'"],
    );
    const f = flattenFindings('src/X.tsx', r);
    expect(f.map((x) => x.rule).sort()).toEqual(
      ['import-drift', 'local-shadow', 'prop-match', 'subcomponent', 'token-fingerprint'].sort(),
    );
  });

  it('ids are deterministic and file-scoped', () => {
    expect(findingId('a.tsx', 'local-shadow', 'Button')).toBe(findingId('a.tsx', 'local-shadow', 'Button'));
    expect(findingId('a.tsx', 'local-shadow', 'Button')).not.toBe(findingId('b.tsx', 'local-shadow', 'Button'));
    expect(findingId('a.tsx', 'local-shadow', 'Button')).toMatch(/^[0-9a-f]{12}$/);
  });

  it('import-drift and local-shadow are high severity; tokens/props/subcomponents are medium', () => {
    const f = flattenFindings(
      'src/X.tsx',
      result({ localShadows: ['Button'], tokenFingerprints: [{ componentName: 'C', tokens: ['#fff'], classNames: [] }] }, ["B from './b'"]),
    );
    expect(f.find((x) => x.rule === 'import-drift')!.severity).toBe('high');
    expect(f.find((x) => x.rule === 'local-shadow')!.severity).toBe('high');
    expect(f.find((x) => x.rule === 'token-fingerprint')!.severity).toBe('medium');
  });
});

describe('countDriftedComponents', () => {
  it('folds the 3-4 inline signals about one local component into a single component', () => {
    // One local `Card` trips token-fingerprint + prop-match + subcomponent at once.
    const f = flattenFindings('src/Card.tsx', result({
      tokenFingerprints: [{ componentName: 'Card', tokens: ['#161616'], classNames: ['cds--btn'] }],
      propMatches: [{ componentName: 'Card', matchedDs: 'MuiChip', matchedProps: ['label', 'onDelete'], score: 0.7 }],
      subComponentMatches: [
        { componentName: 'Card', matchedDs: 'MuiCard', subComponentsUsed: ['CardMedia'], nameSegment: 'Card', confidence: 'high' },
      ],
    }));
    expect(f).toHaveLength(3);            // three raw findings...
    expect(countDriftedComponents(f)).toBe(1); // ...but one drifted component
  });

  it('counts each import-drift specifier as its own drifted component', () => {
    const f = flattenFindings('src/X.tsx', result({}, ["Button from './ui'", "Tile from './ui'"]));
    expect(countDriftedComponents(f)).toBe(2);
  });

  it('is file-scoped: same component name in two files counts twice', () => {
    const f = [
      ...flattenFindings('src/A.tsx', result({ localShadows: ['Button'] })),
      ...flattenFindings('src/B.tsx', result({ localShadows: ['Button'] })),
    ];
    expect(countDriftedComponents(f)).toBe(2);
  });

  it('returns 0 for no findings', () => {
    expect(countDriftedComponents([])).toBe(0);
  });
});

describe('suppression', () => {
  const findings: Finding[] = [
    { id: 'aaaaaaaaaaaa', file: 'src/a.tsx', rule: 'token-fingerprint', key: 'C', title: 'C', detail: '', severity: 'medium' },
    { id: 'bbbbbbbbbbbb', file: 'src/legacy/b.tsx', rule: 'import-drift', key: 'B', title: 'B', detail: '', severity: 'high' },
  ];

  it('suppresses by exact id', () => {
    const s = parseSuppressions('aaaaaaaaaaaa\n');
    expect(applySuppressions(findings, s).map((f) => f.id)).toEqual(['bbbbbbbbbbbb']);
  });

  it('suppresses by rule', () => {
    const s = parseSuppressions('rule:import-drift\n');
    expect(applySuppressions(findings, s).map((f) => f.id)).toEqual(['aaaaaaaaaaaa']);
  });

  it('suppresses by path glob (bare and path:)', () => {
    expect(isSuppressed(findings[1], parseSuppressions('src/legacy/**'))).toBe(true);
    expect(isSuppressed(findings[1], parseSuppressions('path:src/legacy/**'))).toBe(true);
    expect(isSuppressed(findings[0], parseSuppressions('src/legacy/**'))).toBe(false);
  });

  it('ignores comments and blank lines', () => {
    const s = parseSuppressions('# a comment\n\n   \nrule:token-fingerprint\n');
    expect(s.rules.has('token-fingerprint')).toBe(true);
    expect(s.ids.size).toBe(0);
  });
});

describe('renderComment', () => {
  const f = (id: string, sev: 'high' | 'medium' = 'high'): Finding => ({
    id,
    file: 'src/a.tsx',
    rule: sev === 'high' ? 'import-drift' : 'token-fingerprint',
    key: id,
    title: id,
    detail: 'x',
    severity: sev,
  });

  it('posts when there is a new finding; body carries marker + new count', () => {
    const r = renderComment([f('new1')], { preexistingIds: new Set() });
    expect(r.shouldComment).toBe(true);
    expect(r.body).toContain(COMMENT_MARKER);
    expect(r.body).toContain('1 new drift signal');
    expect(r.body).toContain('`new1`');
  });

  it('stays quiet when all findings are pre-existing', () => {
    const r = renderComment([f('old1')], { preexistingIds: new Set(['old1']) });
    expect(r.shouldComment).toBe(false);
    expect(r.body).toContain('No new design system drift');
    expect(r.body).toContain('pre-existing drift signal');
  });

  it('threshold high: medium-only new findings do not trigger a comment', () => {
    const r = renderComment([f('m1', 'medium')], { minSeverityToComment: 'high' });
    expect(r.shouldComment).toBe(false);
    expect(r.newFindings).toHaveLength(1);
  });

  it('renders adoption headline with delta', () => {
    const r = renderComment([f('n1')], { adoptionPct: 94, adoptionDeltaPct: -2 });
    expect(r.body).toContain('Design system adoption: 94%');
    expect(r.body).toContain('-2.0 pts');
  });

  it('shows git attribution when commit present', () => {
    const r = renderComment([{ ...f('n1'), commit: 'abcdef1234567890' }]);
    expect(r.body).toContain('@abcdef1');
  });
});
