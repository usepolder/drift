/**
 * Orchestration core: turn a PR's changed files into a rendered comment + verdict.
 *
 * Pure-ish: all I/O (reading current/base file versions, git blame) is injected, so
 * this is fully unit-testable without git or a network. GitHub and Azure DevOps
 * transports supply the readers and then post `result.body` when `result.shouldComment`.
 */
import { checkDriftFull, countCanonicalUsages } from '../parser';
import type { DetectionProfile } from '../profiles';
import { flattenFindings, countDriftedComponents, type Finding } from './findings';
import { applySuppressions, type SuppressRules } from './suppress';
import { renderComment, type RenderResult } from './render';
import { adoptionPct } from './adoption';

export interface AnalyzeParams {
  files: string[];
  /** Current (PR head) content of a file, or null if unreadable/removed. */
  readCurrent: (file: string) => string | null;
  /** Base-branch content of a file, or null. Omit to treat all findings as "new". */
  readBase?: (file: string) => string | null;
  /**
   * Whether the base ref is actually available for diffing. When false (e.g. a
   * shallow checkout where the base commit isn't fetched), we cannot tell new from
   * pre-existing drift, so the comment says so and the caller skips fail-on-drift.
   * Defaults to true.
   */
  baseAvailable?: boolean;
  /** Introducing commit for a file's drift (short/long SHA), or undefined. */
  blame?: (file: string) => string | undefined;
  dsExports: Set<string>;
  canonicalPkgs: string[];
  allowlist: string[];
  /**
   * Detection profile for the inline rules. Omit to derive from `canonicalPkgs`
   * alone; pass one built from config to include custom tokens/signatures.
   */
  profile?: DetectionProfile;
  suppress: SuppressRules;
  minSeverityToComment?: 'high' | 'medium';
  marker?: string;
}

export interface AnalyzeResult extends RenderResult {
  totalFindings: number;
  adoptionPct?: number;
  baseAvailable: boolean;
}

export function analyzePr(p: AnalyzeParams): AnalyzeResult {
  const baseAvailable = p.baseAvailable !== false;
  let findings: Finding[] = [];
  let canonicalUsages = 0;

  for (const file of p.files) {
    const content = p.readCurrent(file);
    if (content == null) continue;
    const res = checkDriftFull(content, p.dsExports, p.canonicalPkgs, p.allowlist, file, p.profile);
    findings.push(...flattenFindings(file, res));
    canonicalUsages += countCanonicalUsages(content, p.dsExports, p.canonicalPkgs);
  }

  findings = applySuppressions(findings, p.suppress);

  if (p.blame) {
    const cache = new Map<string, string | undefined>();
    for (const f of findings) {
      if (!cache.has(f.file)) cache.set(f.file, p.blame!(f.file));
      const c = cache.get(f.file);
      if (c) f.commit = c;
    }
  }

  // Pre-existing drift (for "new in this PR") + base adoption (for the delta), both
  // from the base versions of the changed files.
  let preexistingIds: Set<string> | undefined;
  let adoptionDeltaPct: number | undefined;
  const driftedComponents = countDriftedComponents(findings);
  if (p.readBase && baseAvailable) {
    preexistingIds = new Set<string>();
    let baseCanonical = 0;
    const baseFindings: Finding[] = [];
    for (const file of p.files) {
      const base = p.readBase(file);
      if (base == null) continue;
      const res = checkDriftFull(base, p.dsExports, p.canonicalPkgs, p.allowlist, file, p.profile);
      // Suppress base findings the same way head findings are (analyze above), so the
      // adoption delta compares like with like and .polderignore doesn't fake a gain.
      const ff = applySuppressions(flattenFindings(file, res), p.suppress);
      for (const f of ff) preexistingIds.add(f.id);
      baseFindings.push(...ff);
      baseCanonical += countCanonicalUsages(base, p.dsExports, p.canonicalPkgs);
    }
    const baseAdopt = adoptionPct(baseCanonical, countDriftedComponents(baseFindings));
    const headAdopt = adoptionPct(canonicalUsages, driftedComponents);
    if (baseAdopt !== undefined && headAdopt !== undefined) {
      adoptionDeltaPct = headAdopt - baseAdopt;
    }
  }

  const adopt = adoptionPct(canonicalUsages, driftedComponents);
  const render = renderComment(findings, {
    preexistingIds,
    adoptionPct: adopt,
    adoptionDeltaPct,
    minSeverityToComment: p.minSeverityToComment,
    marker: p.marker,
    baseAvailable,
  });

  return { ...render, totalFindings: findings.length, adoptionPct: adopt, baseAvailable };
}
