# Getting started: catch your first drift

In this tutorial you'll run Polder Drift against a small, deliberately "drifted"
component and watch it flag four different kinds of design-system drift — with no
design system installed and no CI setup. By the end you'll understand the output and
know how to wire it into a pull request.

You'll build a one-file example that bypasses an `@mui/material` design system four ways,
then catch all four with a single command.

## What you'll need

- **Node 20+** (`node --version`).
- A terminal. That's it — no design-system package, no git history, no API keys.

We'll run the published CLI with `npx @usepolder/drift`, so there's nothing to install.

## Step 1: Set up a scratch project

Create an empty directory and a Polder Drift config that names a design system:

```bash
mkdir polder-tutorial && cd polder-tutorial

cat > .polder.yml <<'YAML'
component_library: "@mui/material"
allowlist: []
fail_on_drift: false
YAML
```

`.polder.yml` is the only config Polder Drift needs. `component_library` is the package
whose components are "the right way" to build UI — anything that re-implements or
re-imports those components is drift.

## Step 2: Write a component that drifts

Create `storefront.tsx`. Each piece below bypasses the design system in a different way —
the comments say how:

```bash
cat > storefront.tsx <<'TSX'
// 1. Import drift: a DS component pulled from a local copy, not the package
import { Card } from './ui/Card';
import { CardMedia, CardContent } from '@mui/material';

// 2. Token fingerprint: hardcodes #1976d2 (MUI primary.main)
// 3. Prop match: props overlap MUI's Slider API
function PriceSlider({ value, onChange, min, max, step, disabled }) {
  return (
    <div style={{ background: '#1976d2', position: 'relative' }}>
      {/* hand-rolled slider track + thumb */}
    </div>
  );
}

// 4. Sub-component: uses Card's parts with no <Card>, and is named "...Card"
function ProductCard({ product }) {
  return (
    <div>
      <CardMedia component="img" image={product.image} />
      <CardContent>{product.name}</CardContent>
    </div>
  );
}
TSX
```

Nothing here imports a real library, and `./ui/Card` doesn't even have to exist — the
engine reads the *source*, it doesn't run it.

## Step 3: Scan it

Run the scan against that one file:

```bash
npx @usepolder/drift scan storefront.tsx
```

You'll see a warning on stderr first, then the report on stdout:

```
polder-drift: could not resolve exports for "@mui/material" from node_modules. Run your install step first. Falling back to PascalCase heuristic.
⚠ 4 drift signal(s) across 1 of 1 file(s) analysed.

storefront.tsx
  import drift     Card from './ui/Card' (imported locally instead of from the package)
  token fingerprint PriceSlider (#1976d2)
  prop match       PriceSlider ~ MuiSlider (75%: value, onChange, min, max, step, disabled)
  subcomponent     ProductCard ~ MuiCard (high: CardMedia, CardContent)
```

**That's the result.** Four signals, four different rules:

- **import drift** — `Card` came from a local path instead of `@mui/material`.
- **token fingerprint** — `PriceSlider` hardcodes a known MUI theme color.
- **prop match** — `PriceSlider`'s props are 75% of MUI's `Slider` API: it's a fork.
- **subcomponent** — `ProductCard` renders `CardMedia`/`CardContent` with no `Card`
  wrapper, and its name contains "Card", so it's almost certainly rebuilding `Card`.

The warning is expected: we never installed `@mui/material`, so the engine couldn't read
its exact export list and fell back to a PascalCase heuristic for *import* drift. The
token, prop, and sub-component rules use built-in MUI/Carbon knowledge and work either
way. (Install the package to silence the warning and get exact import matching — see
[Level up](#level-up).)

## Step 4: See the machine-readable version

Add `--json` to get a structured report you can feed to a script or an agent:

```bash
npx @usepolder/drift scan storefront.tsx --json
```

```json
{
  "version": 1,
  "config": { "componentLibrary": ["@mui/material"], "allowlist": [], "failOnDrift": false },
  "summary": { "filesAnalyzed": 1, "filesWithDrift": 1, "totalSignals": 4 },
  "files": [
    {
      "filename": "storefront.tsx",
      "totalCount": 4,
      "importDrift": { "count": 1, "symbols": ["Card from './ui/Card'"] },
      "inlineDrift": {
        "localShadows": [],
        "tokenFingerprints": [{ "componentName": "PriceSlider", "tokens": ["#1976d2"], "classNames": [] }],
        "propMatches": [{ "componentName": "PriceSlider", "matchedDs": "MuiSlider",
          "matchedProps": ["value", "onChange", "min", "max", "step", "disabled"], "score": 0.75 }],
        "subComponentMatches": [{ "componentName": "ProductCard", "matchedDs": "MuiCard",
          "subComponentsUsed": ["CardMedia", "CardContent"], "nameSegment": "Card", "confidence": "high" }]
      }
    }
  ]
}
```

## Step 5: Make it fail a build

By default `scan` reports drift but exits `0` (so it never blocks by surprise):

```bash
npx @usepolder/drift scan storefront.tsx ; echo "exit: $?"
# … report … exit: 0
```

Add `--fail-on-drift` to turn drift into a non-zero exit you can gate CI on:

```bash
npx @usepolder/drift scan storefront.tsx --fail-on-drift ; echo "exit: $?"
# … report … exit: 1
```

## What you built

You wrote a component that drifts four ways and caught all four with one command — no
design system installed, no network, no CI. You also saw the JSON report and the
fail-on-drift exit code, which are the two hooks for automation.

### Level up

- **Exact import matching.** Run `npm init -y && npm i @mui/material`, then scan again —
  the stderr warning disappears and import drift matches MUI's real export list (and a
  same-named in-file component would now be caught as a *local shadow*).
- **Scan real changes.** Inside a git repo, `polder-drift scan` (no args) checks just
  your working-tree changes; `scan --diff origin/main` checks everything since the base
  branch; `scan --all` checks the whole repo.
- **Skip the config.** Delete `.polder.yml` in a repo that already depends on a known
  design system and Polder Drift will auto-detect it. `polder-drift init` writes a
  starter config for you.

### Put it on your pull requests

On GitHub, add the Action — it posts a single drift comment per PR, showing only what
that PR introduced plus a design-system adoption percentage:

```yaml
# .github/workflows/polder-drift.yml
name: Polder Drift
on: pull_request
jobs:
  drift:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write   # required: the Action posts a PR comment
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # full history — needed to report only the drift this PR introduces
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - uses: usepolder/drift@v1
```

The `pull-requests: write` line matters: the default `GITHUB_TOKEN` is read-only, so
without it the comment never appears. (Fork PRs are always read-only regardless.)

The `fetch-depth: 0` matters too: a shallow checkout has no base branch to diff against,
so the Action can't isolate new drift and reports **all** of it instead. Full history
gives you the "introduced by this PR" view.

On Azure DevOps, run `polder-drift ci` as a pipeline step — same comment, no extension.
See [Polder Drift on Azure DevOps](azure-pipelines.md).

## Where to go next

- [CLI reference](reference-cli.md) — every command, flag, and exit code
- [Detection rules](reference-detection-rules.md) — exactly what each of the five signals means
- [Configuration](reference-configuration.md) — `component_library`, `allowlist`, zero-config detection
- [Suppress findings](howto-suppress-findings.md) — when a finding is acceptable
- [How detection works](explanation-how-detection-works.md) — the design behind the engine
