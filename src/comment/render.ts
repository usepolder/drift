/**
 * Platform-agnostic comment core. Takes findings + context, returns a rendered
 * markdown body and a decision about whether to post. Knows nothing about GitHub or
 * Azure DevOps; transports feed it findings and post whatever it returns.
 */
import type { Finding, DriftRule } from './findings';
import { RULE_LABEL } from './findings';

export const COMMENT_MARKER = '<!-- polder-drift-comment -->';

export interface RenderOptions {
  /** Finding ids that already existed before this PR (pre-existing drift). */
  preexistingIds?: Set<string>;
  /** DS adoption percentage (0-100), if computed. */
  adoptionPct?: number;
  /** Change in adoption vs the base branch, in percentage points. */
  adoptionDeltaPct?: number;
  /** Only post when there is a NEW finding at or above this severity. Default 'medium'. */
  minSeverityToComment?: 'high' | 'medium';
  marker?: string;
  /**
   * Whether the base ref was available for "new in this PR" diffing. When false, the
   * comment cannot distinguish new from pre-existing drift, so it says so and reports
   * all drift instead of pretending everything is new. Defaults to true.
   */
  baseAvailable?: boolean;
}

export interface RenderResult {
  body: string;
  shouldComment: boolean;
  newFindings: Finding[];
  existingFindings: Finding[];
}

const SEV_RANK: Record<'high' | 'medium', number> = { high: 2, medium: 1 };
const RULE_ORDER: DriftRule[] = ['import-drift', 'local-shadow', 'token-fingerprint', 'prop-match', 'subcomponent'];

export function renderComment(findings: Finding[], opts: RenderOptions = {}): RenderResult {
  const marker = opts.marker ?? COMMENT_MARKER;
  const preexisting = opts.preexistingIds ?? new Set<string>();
  const minRank = SEV_RANK[opts.minSeverityToComment ?? 'medium'];

  const baseAvailable = opts.baseAvailable !== false;

  // Base unavailable (e.g. shallow checkout): we cannot tell new from pre-existing,
  // so report ALL drift honestly rather than mislabelling everything as "new", and
  // do not let the caller fail the build on a count we can't trust.
  if (!baseAvailable) {
    const reportable = findings.filter((f) => SEV_RANK[f.severity] >= minRank);
    const lines: string[] = [marker, '## Polder Drift', ''];
    lines.push(
      '> Base branch not available (shallow checkout), so this run cannot tell which ' +
        'drift this PR introduced. Showing all drift. Add `fetch-depth: 0` to your ' +
        'checkout for new-only reporting.',
      '',
    );
    if (opts.adoptionPct !== undefined) {
      lines.push(`**Design system adoption: ${opts.adoptionPct.toFixed(0)}%**`, '');
    }
    if (findings.length === 0) {
      lines.push('No design system drift detected.', '', footer());
    } else {
      lines.push(`${findings.length} drift signal${findings.length === 1 ? '' : 's'} detected:`, '');
      lines.push(...renderTable(findings));
      lines.push('', footer());
    }
    return {
      body: lines.join('\n'),
      shouldComment: reportable.length > 0,
      newFindings: [],
      existingFindings: findings,
    };
  }

  const newFindings = findings.filter((f) => !preexisting.has(f.id));
  const existingFindings = findings.filter((f) => preexisting.has(f.id));

  const hasReportableNew = newFindings.some((f) => SEV_RANK[f.severity] >= minRank);
  const shouldComment = hasReportableNew;

  const lines: string[] = [marker, '## Polder Drift', ''];

  // Headline: adoption if we have it, else a signal count.
  if (opts.adoptionPct !== undefined) {
    const delta =
      opts.adoptionDeltaPct === undefined
        ? ''
        : ` (${opts.adoptionDeltaPct >= 0 ? '+' : ''}${opts.adoptionDeltaPct.toFixed(1)} pts in this PR)`;
    lines.push(`**Design system adoption: ${opts.adoptionPct.toFixed(0)}%**${delta}`, '');
  }

  if (newFindings.length === 0) {
    lines.push('No new design system drift introduced by this PR.');
    if (existingFindings.length > 0) {
      lines.push('', renderExistingSummary(existingFindings));
    }
    lines.push('', footer());
    return { body: lines.join('\n'), shouldComment, newFindings, existingFindings };
  }

  lines.push(
    `${newFindings.length} new drift signal${newFindings.length === 1 ? '' : 's'} introduced by this PR:`,
    '',
  );
  lines.push(...renderTable(newFindings));

  if (existingFindings.length > 0) {
    lines.push('', renderExistingSummary(existingFindings));
  }
  lines.push('', footer());

  return { body: lines.join('\n'), shouldComment, newFindings, existingFindings };
}

function renderTable(findings: Finding[]): string[] {
  const sorted = [...findings].sort(
    (a, b) => RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule) || a.file.localeCompare(b.file),
  );
  const rows = sorted.map((f) => {
    const where = f.commit ? `${f.file} \`@${f.commit.slice(0, 7)}\`` : f.file;
    return `| ${RULE_LABEL[f.rule]} | \`${f.title}\` | ${f.detail} | ${where} | \`${f.id}\` |`;
  });
  return [
    '| Type | What | Detail | Where | ID |',
    '|------|------|--------|-------|----|',
    ...rows,
  ];
}

function renderExistingSummary(existing: Finding[]): string {
  const byRule = new Map<DriftRule, number>();
  for (const f of existing) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  const parts = RULE_ORDER.filter((r) => byRule.has(r)).map((r) => `${byRule.get(r)} ${RULE_LABEL[r].toLowerCase()}`);
  return `<details><summary>${existing.length} pre-existing drift signal(s) (not introduced by this PR)</summary>\n\n${parts.join(', ')}\n</details>`;
}

function footer(): string {
  return (
    'Suppress a finding by adding its `ID` to `.polderignore`, or a whole rule with ' +
    '`rule:<type>`. — [Polder Drift](https://github.com/usepolder/drift)'
  );
}
