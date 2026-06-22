# Configuration reference

Polder Drift reads one config file, `.polder.yml`, at the repo root. The same file is
used by all three surfaces: the GitHub Action, the `polder-drift ci` command, and the
`polder-drift scan` CLI. Suppression is a separate file, `.polderignore`
(see [Suppress findings](howto-suppress-findings.md)).

Config parsing lives in [`src/config.ts`](../src/config.ts); resolution and zero-config
detection live in [`src/resolve-config.ts`](../src/resolve-config.ts) and
[`src/detect.ts`](../src/detect.ts).

## `.polder.yml`

```yaml
component_library: "@your-org/design-system"   # string or list — REQUIRED
allowlist: []                                   # import-source prefixes to ignore
fail_on_drift: false                            # fail the check / exit non-zero on drift
```

### `component_library` (required)

The canonical design-system package(s). Imports **from** these packages are correct;
local re-imports of their exports are [import drift](reference-detection-rules.md#1-import-drift-import-drift-high).

- Accepts a **string** or a **list of strings**.
- Required. A missing key, `null`, or an empty list throws a config error (exit `2`).
- Any other type (number, object) throws `component_library must be a string or array of strings`.

```yaml
# Single package
component_library: "@carbon/react"

# Multiple packages — all are treated as canonical
component_library:
  - "@carbon/react"
  - "@mui/material"
```

**Export resolution.** At run time the package's exports are read from
`node_modules/<pkg>` — from the `types`/`typings` `.d.ts` entry (following
`export * from …` chains), or, for packages that ship one `.d.ts` per export
(e.g. `@carbon/icons-react`), from the `.d.ts` filenames in `lib/`, `es/`, or `dist/`.
**Run your install step before any run** so resolution succeeds. If a package can't be
resolved, the engine warns on stderr and falls back to a PascalCase heuristic, which is
broader and noisier and disables the `local-shadow` rule.

### `allowlist` (optional, default `[]`)

A list of import-source **prefixes** to treat as not-drift. An import is skipped when
its source string `startsWith` any allowlist entry.

```yaml
allowlist:
  - "./src/legacy"     # imports from the legacy tree are not flagged
  - "#design-tokens"   # a subpath alias you consider canonical
```

Non-array values are ignored (treated as empty). Allowlisting affects only the
[import-drift](reference-detection-rules.md) rule; to silence other rules or specific
findings, use [`.polderignore`](howto-suppress-findings.md).

### `fail_on_drift` (optional, default `false`)

When `true`, the run fails on **newly introduced** drift:

- **Action / `ci`** — sets a failed check / non-zero exit when the PR adds new drift.
- **CLI `scan`** — exit `1` when any drift is found (override per-run with
  `--fail-on-drift` / `--no-fail`).

Only the literal boolean `true` enables it; any other value is treated as `false`.

## Resolution precedence

A run resolves its config in this order ([resolve-config.ts](../src/resolve-config.ts)):

1. **Explicit `.polder.yml`** at the config path. It always wins. Invalid YAML is a hard
   error (exit `2`) — detection is **not** attempted as a fallback for a broken file.
2. **Zero-config detection.** With no file present, Polder Drift inspects `package.json`
   `dependencies` + `peerDependencies` for a known DS package. If one or more match, it
   runs with `{ componentLibrary: [...detected], allowlist: [], failOnDrift: false }` and
   notes the detection on stderr.
3. **Nothing resolvable** → the CLI exits `2` with guidance to run `polder-drift init`;
   the Action and `ci` warn and do nothing.

### Auto-detected packages

Detection matches these curated, well-known design systems
(`KNOWN_DS_PACKAGES` in [detect.ts:9](../src/detect.ts)):

```
@carbon/react              @mui/material            @chakra-ui/react
@mantine/core              antd                     @fluentui/react
@fluentui/react-components @shopify/polaris         react-bootstrap
@primer/react              @adobe/react-spectrum    @radix-ui/themes
@nextui-org/react          @heroui/react            grommet
```

If your design system is a private or in-house package, it won't be auto-detected —
commit a `.polder.yml` (or run `polder-drift init`, which writes a placeholder you edit).

## Examples

A minimal monorepo app using Carbon, blocking merges on new drift:

```yaml
component_library: "@carbon/react"
fail_on_drift: true
```

A repo migrating off a legacy UI kit, ignoring the legacy tree while it's torn down:

```yaml
component_library:
  - "@mui/material"
allowlist:
  - "./src/legacy-ui"
fail_on_drift: false
```

## Related

- [CLI reference](reference-cli.md) — `--config`, `--cwd`, exit codes
- [Detection rules](reference-detection-rules.md) — what `component_library` is compared against
- [Suppress findings](howto-suppress-findings.md) — `.polderignore`, the other config file
- [Azure DevOps](azure-pipelines.md) — running `ci` in a pipeline
