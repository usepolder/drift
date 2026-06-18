/**
 * Adoption ratio: canonical DS usages over total DS-relevant surface
 * (canonical usages + drift signals). Undefined when there is no DS surface at all,
 * so we don't show a misleading "100%" for a file that touches no design system.
 */
export function adoptionPct(canonicalUsages: number, driftSignals: number): number | undefined {
  const denom = canonicalUsages + driftSignals;
  if (denom === 0) return undefined;
  return (canonicalUsages / denom) * 100;
}
