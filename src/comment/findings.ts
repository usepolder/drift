/**
 * Normalised drift findings shared by every surface (GitHub Action, AzDO, CLI).
 *
 * The engine (`parser.ts`) emits drift in five shapes. This flattens them into one
 * `Finding` type with a STABLE id, which is what makes suppression, dedup, and
 * "new in this PR" diffing possible across runs and across platforms.
 *
 *   FullDriftResult ──► flattenFindings() ──► Finding[]  (each with a stable id)
 */
import { createHash } from 'crypto';
import type { FullDriftResult } from '../parser';

export type DriftRule =
  | 'import-drift'
  | 'local-shadow'
  | 'token-fingerprint'
  | 'prop-match'
  | 'subcomponent';

export type Severity = 'high' | 'medium';

export interface Finding {
  id: string; // stable: sha1(file | rule | key), 12 hex chars
  file: string;
  rule: DriftRule;
  key: string; // symbol/component name used for the id and for dedup
  title: string;
  detail: string;
  severity: Severity;
  commit?: string; // git attribution (filled by the adoption/attribution pass)
}

const SEVERITY: Record<DriftRule, Severity> = {
  'import-drift': 'high',
  'local-shadow': 'high',
  'token-fingerprint': 'medium',
  'prop-match': 'medium',
  subcomponent: 'medium',
};

export const RULE_LABEL: Record<DriftRule, string> = {
  'import-drift': 'Import drift',
  'local-shadow': 'Local shadow',
  'token-fingerprint': 'Token fingerprint',
  'prop-match': 'Prop match',
  subcomponent: 'Sub-component',
};

/** Deterministic id for a finding. Same (file, rule, key) always yields the same id. */
export function findingId(file: string, rule: DriftRule, key: string): string {
  return createHash('sha1').update(`${file}|${rule}|${key}`).digest('hex').slice(0, 12);
}

/** Flatten one file's engine result into stable, normalised findings. */
export function flattenFindings(file: string, result: FullDriftResult): Finding[] {
  const out: Finding[] = [];
  const push = (rule: DriftRule, key: string, title: string, detail: string): void => {
    out.push({ id: findingId(file, rule, key), file, rule, key, title, detail, severity: SEVERITY[rule] });
  };

  for (const sym of result.importDrift.symbols) {
    push('import-drift', sym, sym, 'DS component imported from a local path instead of the package');
  }
  for (const name of result.inlineDrift.localShadows) {
    push('local-shadow', name, name, 'Component defined in-file with the same name as a DS export');
  }
  for (const fp of result.inlineDrift.tokenFingerprints) {
    push('token-fingerprint', fp.componentName, fp.componentName, [...fp.tokens, ...fp.classNames].join(', '));
  }
  for (const pm of result.inlineDrift.propMatches) {
    push(
      'prop-match',
      pm.componentName,
      `${pm.componentName} ~ ${pm.matchedDs}`,
      `${Math.round(pm.score * 100)}% prop overlap: ${pm.matchedProps.join(', ')}`,
    );
  }
  for (const sm of result.inlineDrift.subComponentMatches) {
    push(
      'subcomponent',
      sm.componentName,
      `${sm.componentName} ~ ${sm.matchedDs}`,
      `${sm.confidence}: uses ${sm.subComponentsUsed.join(', ')}`,
    );
  }
  return out;
}

/**
 * Collapse findings to the number of DISTINCT DRIFTED COMPONENTS.
 *
 * This is the drift counterpart of `countCanonicalUsages` (which counts DS import
 * specifiers — one per DS component used correctly). The adoption metric divides
 * the two, so both sides must be counted at the same granularity: per component.
 *
 * The subtlety this exists to fix: a single local component that reimplements a DS
 * component usually trips several inline signals at once (token-fingerprint +
 * prop-match + sub-component), which would count 3-4× against adoption if we used
 * the raw finding count. Every inline rule keys on the local component name, so
 * deduping by `(file, key)` folds those signals back into one component. import-drift
 * keys on the wrongly-sourced specifier (e.g. `Button from './ui'`), which is already
 * one drifted DS component per entry — the natural counterpart to one canonical import.
 */
export function countDriftedComponents(findings: Finding[]): number {
  const seen = new Set<string>();
  // `|` matches the delimiter convention in `findingId`; file paths and component
  // keys don't contain it, so distinct components never collide.
  for (const f of findings) seen.add(`${f.file}|${f.key}`);
  return seen.size;
}
