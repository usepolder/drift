/**
 * Adoption ratio, defined at COMPONENT granularity so the numerator and denominator
 * compare like with like:
 *
 *     canonicalUsages / (canonicalUsages + driftedComponents)
 *
 *   - `canonicalUsages`   — DS import specifiers (one per DS component used correctly).
 *   - `driftedComponents` — distinct drifted components (see `countDriftedComponents`).
 *
 * Both count components, not findings. (The old form divided canonical usages by the
 * raw finding count, but one drifted local component emits 3-4 inline findings, so it
 * depressed adoption several times harder than one correct import raised it.)
 *
 * Undefined when there is no DS surface at all, so we don't show a misleading "100%"
 * for a file that touches no design system.
 */
export function adoptionPct(canonicalUsages: number, driftedComponents: number): number | undefined {
  const denom = canonicalUsages + driftedComponents;
  if (denom === 0) return undefined;
  return (canonicalUsages / denom) * 100;
}
