# Detection rules reference

Polder Drift emits drift in **five shapes**. This page is the complete, factual
description of each: what triggers it, its severity, and what the engine needs in
place to detect it. The rules live in [`src/parser.ts`](../src/parser.ts); the
normalised finding shape lives in [`src/comment/findings.ts`](../src/comment/findings.ts).

For *why* the rules are built this conservative way, see
[How detection works](explanation-how-detection-works.md). To act on findings,
see [Suppress findings](howto-suppress-findings.md).

## Summary

| Rule (`DriftRule`) | Label | Severity | Needs resolved DS exports? | What it catches |
|---|---|---|---|---|
| `import-drift` | Import drift | **high** | No (falls back to PascalCase) | A DS component imported from a local path instead of the package |
| `local-shadow` | Local shadow | **high** | **Yes** | An in-file component whose name equals a DS export |
| `token-fingerprint` | Token fingerprint | medium | No | A component body that hardcodes a known DS hex token or DS class name |
| `prop-match` | Prop match | medium | No | A local component whose props overlap a DS component's API |
| `subcomponent` | Sub-component | medium | No | A local component that uses DS sub-components without their real parent |

Severity is fixed per rule in `SEVERITY` ([findings.ts:33](../src/comment/findings.ts)).
"High" findings are structural (a real DS component bypassed); "medium" findings are
heuristic look-alikes.

## What gets analysed

A file is parsed only if it looks like it contains components:

- **`.tsx` files** are always analysed.
- **`.ts` / `.js` / `.jsx` files** are analysed only when `isComponentFile()` returns
  true — that is, the source contains a `<PascalCase` JSX tag **or** an
  `export [default] function|const PascalCase` declaration
  ([parser.ts:111](../src/parser.ts)).

Files that fail to parse (even with Babel's `errorRecovery`) yield zero findings
rather than an error.

---

## 1. Import drift (`import-drift`, high)

A DS component imported from a **local path** instead of from the canonical package.

**Triggers when** an `import` declaration's source is local — it starts with `./`,
`../`, `#` (subpath alias), or `/` — **and** an imported specifier's name matches a
resolved DS export.

```tsx
// Drift: Button is a DS export, imported from a local copy
import { Button } from './ui/Button';

// Not drift: imported from the canonical package
import { Button } from '@carbon/react';
```

**Never drift:**

- Bare third-party imports (`import x from 'lodash'`) — only local/alias paths are checked.
- Imports from a configured `component_library` package.
- Imports whose source starts with any `allowlist` prefix (see
  [Configuration](reference-configuration.md)).

**Fallback when DS exports can't be resolved.** If `node_modules` was not installed
and exports resolve to an empty set, the engine cannot know which names are DS
components. It then flags any **PascalCase** specifier imported from a local path
(`/^[A-Z]/`). This is broader and noisier — install dependencies before a run to get
exact matching. The CLI and CI runner print a warning to stderr when they fall back.

**Detail string:** `DS component imported from a local path instead of the package`.
**Finding key / id input:** the full symbol, e.g. ``Button from './ui/Button'``.

## 2. Local shadow (`local-shadow`, high)

A component defined in the file under the **same name as a DS export** — a drop-in
replacement that will silently shadow the real component for readers.

**Triggers when** a top-level `function PascalName` or `const PascalName = (props) => …`
has a name that is a resolved DS export.

```tsx
// Drift: 'Modal' is a DS export, redefined locally
export function Modal({ open, children }) { /* hand-rolled */ }
```

**Requires resolved DS exports.** With the PascalCase fallback (no `node_modules`),
local-shadow is **not** emitted — the engine has no export list to compare against.

**Detail string:** `Component defined in-file with the same name as a DS export`.

## 3. Token fingerprint (`token-fingerprint`, medium)

A component body that hardcodes a **design-token hex value** or a **DS CSS class name**
— a strong sign the component reimplements DS styling by hand.

**Triggers when** a component's function body contains either:

- a 6-digit hex color present in `CARBON_TOKENS` or `MUI_TOKENS`, **or**
- a class name matching `cds--…` (Carbon) or `Mui<Component>-…` (MUI).

```tsx
function PriceSlider() {
  // #1976d2 is MUI primary.main → token fingerprint
  return <div style={{ background: '#1976d2' }} />;
}
```

The token dictionaries are intentionally small and high-specificity. Generic values
(`#ffffff`, `#cccccc`, common grays) are **deliberately omitted** to keep the
false-positive rate low. Current coverage: **14 Carbon tokens** and **15 MUI v5 tokens**
(`CARBON_TOKENS` / `MUI_TOKENS` in [parser.ts:238](../src/parser.ts)).

**Detail string:** the matched tokens and class names, comma-joined, e.g.
`#1976d2, MuiSlider-root`.

## 4. Prop match (`prop-match`, medium)

A local component whose **destructured props overlap a DS component's known API** —
a hand-rolled fork of a DS component.

**Triggers when** the component's first parameter is an object pattern whose property
names overlap a DS component's prop signature with:

- **score ≥ 0.60**, where `score = matchedProps / dsSignatureLength`, **and**
- **at least 2** matched props.

The best-scoring DS component wins. Signatures are curated per component in
`DS_PROP_SIGNATURES` ([parser.ts:411](../src/parser.ts)) and include only
distinctive props — broad enough to catch forks, tight enough to avoid matching
unrelated components that happen to share a common prop name.

```tsx
// 5/8 MuiSlider props (value, onChange, min, max, step) → score 0.625 ≥ 0.60 → match
function PriceSlider({ value, onChange, min, max, step, disabled }) { … }
```

**Detail string:** e.g. `62% prop overlap: value, onChange, min, max, step`.

## 5. Sub-component (`subcomponent`, medium)

A local component that renders DS **sub-components without their real parent** —
e.g. a `<CardMedia>` and `<CardContent>` with no `<Card>` wrapping them, which means
the component is rebuilding the parent from scratch.

**Triggers when** the body uses a JSX element listed in `DS_SUBCOMPONENT_MAP`
(e.g. `CardMedia → MuiCard`) **and** the real parent element is **not** also present
in the body. Legitimate composition (`<Card><CardMedia/></Card>`) is skipped because
the parent is present.

**Confidence:**

- **high** — a sub-component is used *and* a PascalCase word in the component's name
  matches `DS_NAME_SEGMENTS` for the same parent (e.g. a component named
  `SimpleProductCard` matching the `Card` segment).
- **medium** — sub-component usage only, no name-segment hit.

```tsx
// Uses CardMedia/CardContent, no <Card> present, name contains "Card" → high
function ProductCard() {
  return (<><CardMedia /><CardContent /></>);
}
```

`DS_NAME_SEGMENTS` is conservative on purpose: generic words (Button, Input, Text,
Icon, List) are excluded so a component named `ButtonGroup` is not flagged on its name
alone.

**Detail string:** e.g. `high: uses CardMedia, CardContent`.

---

## Severity, IDs, and adoption

**Stable finding id.** Every finding gets a deterministic 12-hex-char id,
`sha1(file | rule | key)` ([findings.ts:50](../src/comment/findings.ts)). The same
drift in the same file always produces the same id across runs and across platforms —
which is what makes suppression and "new in this PR" diffing work. The `key` is the
symbol for `import-drift`, otherwise the component name.

**Adoption %.** Alongside drift, the engine counts *canonical* DS usages (specifiers
imported from a `component_library` package whose name is a known export). Adoption is
`canonical / (canonical + drift) × 100`, and is **undefined** when there is no DS
surface at all — so a file that touches no design system never shows a misleading
"100%" ([adoption.ts](../src/comment/adoption.ts)). On a PR comment, adoption is shown
with the change in percentage points versus the base branch.

## Related

- [How detection works](explanation-how-detection-works.md) — the design rationale and trade-offs
- [CLI reference](reference-cli.md) — how to run the rules locally
- [Configuration reference](reference-configuration.md) — `component_library`, `allowlist`, detection
- [Suppress findings](howto-suppress-findings.md) — silencing a rule, id, or path
