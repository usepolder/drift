# How detection works (and why it's built this way)

This page explains the design behind Polder Drift: why the engine is pure and
deterministic, how the pieces fit together, and why the rules are deliberately
conservative. For the factual rule-by-rule description, see
[Detection rules](reference-detection-rules.md).

## The problem

Design systems decay one pull request at a time. Someone copies a `Button` into a local
file to tweak one prop, hardcodes `#1976d2` instead of using the theme token, or
rebuilds a `Card` out of `CardMedia` and `CardContent` because the import was a hassle.
Each change is individually reasonable and individually invisible in review. A quarter
later the design system is "adopted" on paper and bypassed in practice.

The obvious tools don't fit:

- **A human reviewer** can't hold the entire DS surface in their head and won't notice
  that a 200-line component is a hand-rolled `Slider`.
- **An LLM linter** is non-deterministic, costs money per PR, is slow, and sends your
  source code to a third party — a non-starter for many teams.

Polder Drift is the boring, deterministic alternative: parse the code, compare it
against the design system, and comment on what's new. No network, no model, no code
leaving the repo.

## The approach

### A pure engine

All detection lives in [`src/parser.ts`](../src/parser.ts). It is a pure function of
`(fileContent, dsExports, canonicalPkgs, allowlist)` → findings. It uses the Babel
parser (with `errorRecovery`, so partial/invalid files degrade instead of throwing) and
a set of curated token/prop/sub-component dictionaries. It does no I/O, makes no network
calls, and is fully deterministic: the same input always yields the same output.

That purity is what makes the rest of the system simple. The engine can be unit-tested
without git or a network, the CLI and the Action share it byte-for-byte, and a finding
computed in CI is identical to one computed on a laptop.

### Engine → core → transports

```
                 ┌──────────────────────────────────────────┐
                 │  src/parser.ts  (pure detection engine)   │
                 │  AST + token/prop/sub-component dicts      │
                 └───────────────────┬──────────────────────┘
                                     │ FullDriftResult
                 ┌───────────────────▼──────────────────────┐
                 │  src/comment/  (platform-agnostic core)   │
                 │  flatten → stable ids → suppress →        │
                 │  adoption % → new-in-PR diff → render md   │
                 └───────────────────┬──────────────────────┘
                          body + shouldComment
            ┌────────────────────────┼────────────────────────┐
            ▼                        ▼                         ▼
   src/platforms/github.ts   src/platforms/azdo.ts        src/cli.ts
   (Octokit, PR comment)     (PR threads REST)       (scan / ci / init)
```

The **comment core** ([`src/comment/`](../src/comment)) knows nothing about GitHub or
Azure DevOps. All I/O it needs — reading the current and base versions of a file,
running `git blame` for attribution — is **injected** as functions into `analyzePr()`
([analyze.ts](../src/comment/analyze.ts)). A **transport** is the thin layer that
implements the `PrPlatform` interface ([types.ts](../src/platforms/types.ts)): tell the
core which files changed, and post whatever markdown it returns.

The payoff: **adding a CI host is one new transport, not a fork.** GitLab support would
be a single `PrPlatform` implementation; the engine, the rules, the suppression, the
adoption math, and the rendered comment are all reused unchanged.

### Stable ids make "new in this PR" possible

Every finding carries a deterministic id: `sha1(file | rule | key)`, truncated to 12
hex chars ([findings.ts:50](../src/comment/findings.ts)). The id depends only on *what*
and *where* the drift is, never on line numbers or run order, so the same drift always
hashes to the same id.

That one property unlocks the features that keep the comment quiet and useful:

- **New-in-PR diffing.** The core runs the engine on both the PR head and the base
  versions of each changed file, collects the base finding ids into a set, and reports
  only the head findings whose id is *not* in that set ([analyze.ts:62](../src/comment/analyze.ts)).
  Pre-existing drift is collapsed into a `<details>` summary, not re-litigated.
- **Suppression.** A `.polderignore` entry can name an exact finding id, and it stays
  valid across runs because the id is stable.
- **Idempotent comments.** A single comment is upserted (found by a hidden marker and
  updated in place), so re-runs don't pile up duplicates.

## The anti-noise philosophy

The number-one reason a tool like this gets uninstalled is a **noisy comment**. Every
design choice bends toward fewer, higher-confidence findings:

- **Small, high-specificity dictionaries.** The token tables hold only distinctive DS
  hex values; generic colors (`#ffffff`, common grays) are omitted on purpose. The
  prop signatures and name segments exclude generic words (Button, Input, Text, Icon)
  so a `ButtonGroup` isn't flagged on its name alone.
- **Thresholds, not hunches.** Prop matching requires a 60% overlap *and* at least two
  matched props before it fires.
- **Composition is not drift.** A sub-component used *with* its real parent
  (`<Card><CardMedia/></Card>`) is legitimate and skipped; only an orphaned
  sub-component is flagged.
- **Only comment on new drift.** Existing drift is summarised, never alarmed about, so
  turning the tool on in a large repo doesn't produce a wall of red.
- **Adoption is undefined without a DS surface.** A file that touches no design system
  shows no adoption number rather than a misleading "100%"
  ([adoption.ts](../src/comment/adoption.ts)).

The bet: a check that cries wolf gets muted; a check that speaks only when it's
confident gets trusted.

## Trade-offs

Every one of those choices gives something up. Named honestly:

- **Coverage is dictionary-bound.** Token, prop, and sub-component detection currently
  ships Carbon and MUI knowledge. Other design systems get the import-drift and
  local-shadow rules (which are library-agnostic) but not the heuristic look-alike
  rules until their dictionaries are added. This is a deliberate precision-over-recall
  trade: better to miss some drift than to flood the comment.
- **The heuristic fallback is blunt.** Without `node_modules`, import drift degrades to
  "flag any PascalCase local import" and local-shadow turns off entirely. Installing
  dependencies before a run restores exact matching.
- **Export resolution is regex-based.** `.d.ts` parsing uses regular expressions over
  `export` statements and `export *` re-export chains rather than a full TypeScript
  type checker — fast and dependency-light, but it can miss exotic re-export shapes.
- **Per-PR file caps.** The GitHub transport lists up to 100 changed files per PR.
  Enormous PRs may not be fully covered.

## Alternatives considered

Visible in the code and its comments:

- **Full theme palettes vs. high-specificity tokens.** Loading every value from a DS
  theme would catch more hardcoded colors but would also match incidental grays and
  whites everywhere. The engine ships a hand-picked subset instead, trading recall for
  a low false-positive rate.
- **A real type checker vs. regex `.d.ts` parsing.** Running `tsc` over each DS package
  would give exact exports but adds a heavy dependency and real latency to every run.
  The regex resolver with a PascalCase fallback was chosen to keep runs fast and
  dependency-light.
- **LLM-based detection vs. a pure AST engine.** Rejected for determinism, cost,
  latency, and privacy, as described under "The problem".

## Related

- [Detection rules](reference-detection-rules.md) — the factual rule reference
- [CLI reference](reference-cli.md) — running the engine locally
- [Consume Polder Drift programmatically](howto-consume-json.md) — building on the engine
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — the same architecture, for contributors
