# Drift audit: 11 proposed issues

Generated from a repo scan of `usepolder/drift` @ v1.1.2. Each section below is one
issue, ready to paste (title = heading, body = the rest).

---

## 1. Token detection only understands 6-digit hex

**Labels:** `improvement`, `detection`

### Problem

`HEX_COLOR_RE = /#[0-9a-fA-F]{6}\b/g` (`src/parser.ts`) plus the profile class-prefix
patterns are the entire surface of the token-fingerprint rule. Grepping `src/` for
`rgb`, `hsl` or `var(--` returns zero hits.

Not detected today:

- `rgb()` / `rgba()` / `hsl()` / `hsla()`
- 3-digit hex (`#fff`)
- 8-digit hex with alpha (`#0f62fe80`)
- CSS custom properties (`var(--ds-color-interactive)`)
- Tailwind utilities and arbitrary values (`bg-[#0f62fe]`)

### Why it matters

Any codebase styling with CSS variables or Tailwind gets near-zero inline signal,
which is most modern frontends. It is also the root cause behind poor shadcn/Tailwind
coverage: that kind of drift is almost entirely class-string and CSS-var shaped.

### Suggested direction

Normalise colour values to a canonical form before lookup (hex3 to hex6, strip alpha,
`rgb()`/`hsl()` to hex) so a single token map keeps working. Add a config key for CSS
custom property names and one for Tailwind-style class patterns, matching how `tokens`
and `class_prefixes` already work in `.polder.yml`. Keep the low-false-positive stance:
only values present in the profile should fire.

### Done when

- Token fingerprinting fires on the formats above, driven by the same profile data
- `polder-drift profile` can extract CSS-var token names from a design system's source
- Fixtures cover each format in both a drifted and a clean scenario

---

## 2. Re-exports and dynamic imports are invisible to the import-drift rule

**Labels:** `improvement`, `detection`, `false-negative`

### Problem

`checkDriftAst` (`src/parser.ts`) iterates `ast.program.body` and `continue`s on
anything that is not an `ImportDeclaration`. So these pass completely clean:

```ts
export { Button } from './ui/Button';          // re-export of a local DS fork
export * from './ui';                          // barrel re-export
const Button = (await import('./ui/Button')).default;
const Modal = React.lazy(() => import('./ui/Modal'));
const { Tag } = require('./ui/Tag');
```

while the identical static import is flagged `high` severity.

### Why it matters

A barrel file re-exporting a forked DS component is the single most common way drift
spreads across a codebase: one fork, then every consumer imports it from a path that
looks legitimate. It is exactly the shape the engine cannot see.

### Suggested direction

Handle `ExportNamedDeclaration` with a local `source`, `ExportAllDeclaration` with a
local source, dynamic `import()` call expressions, and `require()` calls, reusing the
existing `isLocalOrAlias` and `isAllowlisted` checks. For `export *` the specifier set
is unknown without resolution, so either resolve the target file or emit a distinct
lower-confidence finding rather than guessing.

### Done when

- Each form above produces an import-drift finding with the correct line
- Finding ids stay stable for the existing static-import cases (no `.polderignore` churn)

---

## 3. The linter has no linter

**Labels:** `improvement`, `tooling`, `ci`

### Problem

No ESLint, Biome, or Prettier config anywhere in the repo, and no `lint` script in
`package.json`. CI (`.github/workflows/ci.yml`) runs typecheck, test, and build only.

### Why it matters

Two reasons:

1. Credibility. The product's pitch is "enforce consistency mechanically".
2. Real bugs. Module-level `/g` regexes with manual `lastIndex` resets
   (`REEXPORT_RE`, `JSX_ELEMENT_RE`, `HEX_COLOR_RE` in `src/parser.ts`) are exactly
   the class of defect a lint rule catches. They are currently correct by convention
   and one careless edit away from silently skipping matches.

### Suggested direction

Add ESLint (flat config) or Biome with a small, strict rule set, a `lint` script, and
a CI step. Then fix the `/g` regex pattern properly: build the regexes per call, or
use `matchAll`, so `lastIndex` state cannot leak between scans.

### Done when

- `npm run lint` exists and passes
- CI fails on lint errors
- The shared-mutable-regex pattern is gone from `src/parser.ts`

---

## 4. Findings never reach the Files-changed view (no inline comments, annotations, or SARIF)

**Labels:** `feature`, `github-action`, `integrations`

### Problem

`src/platforms/github.ts` only calls `issues.createComment` / `issues.updateComment`.
There is no `pulls.createReview` with inline comments, no check-run annotations, and
no SARIF output.

Every finding already carries `file` and a 1-based `line` (`src/comment/findings.ts`),
so the data needed is already there.

### Why it matters

- Reviewers get a markdown table they have to cross-reference by hand against the diff.
- Platform and security teams cannot ingest results into GitHub code scanning or any
  other SARIF consumer.
- A single comment on a large PR scrolls out of view; inline comments do not.

### Suggested direction

Three increments, independently shippable:

1. `pulls.createReview` with inline comments for findings on changed lines, falling
   back to the summary comment for findings outside the diff.
2. A check run with annotations, so findings show in the Checks tab.
3. `polder-drift scan --sarif` writing SARIF 2.1.0, uploadable via
   `github/codeql-action/upload-sarif`.

Keep the existing single summary comment as the default; make the richer surfaces opt-in
so behaviour does not change under anyone silently.

---

## 5. Thresholds and severities are hardcoded; fail_on_drift is all-or-nothing

**Labels:** `improvement`, `config`

### Problem

- `SEVERITY` (`src/comment/findings.ts`) is a frozen rule-to-severity map.
- `PROP_MATCH_THRESHOLD = 0.6` and `PROP_MATCH_MIN_OVERLAP = 2` are constants in
  `src/parser.ts`.
- `Severity` is only `high | medium`, so `minSeverityToComment` has almost no range.
- `.polderignore` can mute a rule entirely, but there is nothing in between.

A team cannot express: "fail on new import-drift, warn on prop-match, ignore
token-fingerprint below 3 hits".

### Why it matters

The only dials are all-on and all-off, so a repo that finds one rule noisy turns the
whole tool off rather than tuning it.

### Suggested direction

A `rules:` block in `.polder.yml`:

```yaml
rules:
  import-drift:      { severity: high,   fail: true }
  prop-match:        { severity: low,    threshold: 0.75, min_overlap: 3 }
  token-fingerprint: { enabled: false }
```

Add `low` to `Severity`. Thread the prop-match thresholds through `DetectionProfile`
rather than reading module constants. `fail_on_drift: true` keeps its current meaning
as a shorthand for "fail on everything".

### Related

`src/cli.ts` reserves `mcp` and `telemetry` as subcommands that error with "not
available yet". That is shipped dead surface: either build them or drop them from the
reserved set and the help text.

---

## 6. Vendored-DS mode (the right way to support shadcn)

**Labels:** `feature`, `detection`

### Problem

shadcn breaks the core assumption of the engine. The design system lives *inside* your
repo (`components/ui/**`), so "imported from a local path" is the correct state, not
drift. Pointing `component_library` at a package name does nothing, and every rule
either fires on everything or on nothing.

The same applies to any in-house copy-paste design system, which is common well beyond
shadcn.

### Suggested direction

Invert the model with a `vendored_library` config key:

```yaml
vendored_library:
  path: components/ui
```

Then:

- Treat `components/ui/**` as the canonical surface. Imports from it are adoption.
- Snapshot a fingerprint per vendored component: prop signature, class strings, CVA
  variant keys, exported name.
- Flag divergence from the registry/upstream version of that component (a locally
  edited `button.tsx` that has drifted from the shadcn source).
- Flag copies made *outside* the vendored directory, which is the real drift signal in
  this setup.

`polder-drift profile --vendored` can generate the fingerprints, reusing the existing
`src/generate-profile.ts` machinery.

### Done when

- A shadcn starter app scans clean
- A hand-edited `components/ui/button.tsx` and a `src/components/MyButton.tsx` copy
  both produce findings
- Docs cover the vendored setup alongside the package-based one

---

## 7. `polder-drift fix` codemod

**Labels:** `feature`, `cli`

### Problem

`codemod` is already a keyword in `package.json` but nothing implements it. A repo with
200 pre-existing findings gets a wall of text and no path forward.

### Why it matters

This is what makes adoption of the tool survive first contact with a legacy codebase.
A 200-finding report becomes a single reviewable migration PR instead of a reason to
uninstall.

### Suggested direction

Two rules are mechanically rewritable and should be the whole v1:

- **import-drift:** rewrite the local import to the canonical package import, merging
  into an existing canonical import statement when one is present.
- **local-shadow:** delete the in-file definition and import the DS export, when the
  shadow's usage is compatible.

Findings already carry stable ids and exact lines, so targeting is solved. Where a fix
is not provably safe, write a `.polderignore` entry with a comment instead of guessing.

```bash
polder-drift fix --diff origin/main          # fix what this branch touched
polder-drift fix --all --rule import-drift   # whole-repo, one rule
polder-drift fix --all --dry-run             # print the diff, change nothing
```

### Done when

- `--dry-run` prints a unified diff
- Fixes are idempotent: a second run is a no-op
- Round-trip tests: fix the drifted fixtures, rescan, zero findings, output still parses

---

## 8. Drift budget with a baseline file

**Labels:** `feature`, `ci`, `adoption`

### Problem

A repo with existing drift either fails CI forever or turns failure off entirely.
There is no way to say "freeze what is there, fail only on new".

`src/run-ci.ts` already computes new-vs-pre-existing findings and an adoption delta,
so the analysis exists. Only persistence and the gate are missing.

### Suggested direction

- `polder-drift baseline` writes `.polder.baseline` recording accepted finding ids.
- `fail_on_new: true` fails only on findings absent from the baseline.
- Optional ratchet: `min_adoption_delta: 0`, so adoption percentage may not drop.
- `polder-drift baseline --prune` drops ids that no longer occur, so the baseline
  shrinks as drift is fixed and cannot silently re-accept a reintroduced finding.

### Why it matters

This is the feature that lets a team adopt the tool on day one without a cleanup sprint
first. It also makes the CI signal trustworthy, which is the precondition for anyone
turning on `fail_on_drift` at all.

### Done when

- A repo with existing drift passes CI on an unrelated change
- Introducing one new finding fails it
- Fixing a baselined finding and reintroducing it fails it

---

## 9. Trend tracking and an adoption dashboard

**Labels:** `feature`, `adoption`

### Problem

`analyzePr` computes an adoption percentage per run and then discards it. There is no
history, so no trend, and no answer to "is adoption going up?".

### Suggested direction

Emit a durable run record (adoption %, finding counts by rule, drifted component names,
commit, branch, timestamp) to either a JSON artifact committed on the default branch or
a configurable HTTP endpoint. Then report:

- Adoption curve over time, per repo and per team
- Most-drifted DS components, which tells the design system team what to actually build
  or fix next
- Which components get reimplemented most often, and where

### Why it matters

Per-PR findings tell an author what to change. Trends tell the design system team where
the system itself is failing its users, which is the more valuable signal and the one
nothing currently produces.

### Pairs with

Issue for Slack/Teams notifications: the weekly digest off this data is more useful than
a per-PR ping.

---

## 10. Editor-time feedback via LSP or an ESLint plugin

**Labels:** `feature`, `dx`

### Problem

Drift is cheapest to fix at the moment it is typed and most expensive at review time.
Today the earliest signal is the Claude Code `PostToolUse` hook
(`src/commands/claude-hook.ts`), which only covers agent edits.

### Why it matters

The hook already proves the write-time loop works and is the strongest part of the
product. Extending it to humans typing in an editor is the same idea with a much larger
audience. The engine is pure, deterministic, needs no network and no LLM, so it is
genuinely suited to running on every keystroke.

### Suggested direction

Two options, not mutually exclusive:

1. `eslint-plugin-polder-drift`: lowest adoption friction, inherits every editor's
   existing ESLint integration, and gets `--fix` for free once the codemod work lands.
2. A language server: better for non-ESLint setups and for showing adoption inline, but
   much more surface to own.

Recommend starting with the ESLint plugin.

### Done when

- Squiggles appear under drifted imports in VS Code with no editor-specific config
- The plugin shares the engine with the CLI (one detection implementation, not two)

---

## 11. Slack and Teams notifications when components drift

**Labels:** `feature`, `integrations`

### Problem

Drift findings only exist where someone is already looking: a PR comment, or a terminal.
The design system owners, who most want to know a component is being forked, never see
them.

### Suggested direction

Start cheap. A `notify:` block in `.polder.yml` with the webhook URL read from an env
var, fired from `src/run-ci.ts`, which already knows new findings, total findings,
adoption, and adoption delta:

```yaml
notify:
  slack:
    webhook_env: POLDER_SLACK_WEBHOOK
    on: new-high            # new-high (default) | new-any | never
  teams:
    webhook_env: POLDER_TEAMS_WEBHOOK
```

Gate on new high-severity findings by default. A channel that pings on every
medium-severity prop-match becomes a muted channel within a week.

Later, once trend data exists (see the trend-tracking issue), add a weekly digest:
adoption delta, top drifted components, new forks this week. That is the message the
design system team actually wants, and it is more useful than per-PR pings.

### Done when

- One webhook per platform, URL never read from the config file itself, only from env
- Failure to notify never fails the build, and is warned about loudly
- The notification links back to the PR and names the findings, without leaking file
  contents
