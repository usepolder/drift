# polder-drift

Design system drift detection for TypeScript/JavaScript codebases. It flags components
that bypass your registered design system: local imports of DS components, in-file
shadows of DS exports, hardcoded design tokens, and prop/sub-component look-alikes.

The detection engine ([`src/parser.ts`](src/parser.ts)) is pure and deterministic
(Babel AST + token fingerprints). It needs no network and no LLM. Two front ends share
the same engine:

- **GitHub Action** ([`src/index.ts`](src/index.ts)) — posts a drift summary as a PR comment.
- **CLI** ([`src/cli.ts`](src/cli.ts)) — the same checks locally, human or JSON output.

## Configuration

Both front ends read a `.polder.yml` at the repo root:

```yaml
component_library: "@your-org/design-system"   # string or list
allowlist: []                                   # symbols to ignore
fail_on_drift: false                            # non-zero exit / failed check on drift
```

DS exports are resolved from `node_modules`, so run your install step before either
front end. If a package can't be resolved, it falls back to a PascalCase heuristic.

## CLI

```bash
npx @usepolder/drift scan --all
```

The CLI uses subcommands. `scan` does the analysis; bare `polder-drift` prints help.
(Global installs expose the command as `polder-drift`.)

```bash
# Working-tree changes (staged + unstaged + untracked) — the default
polder-drift scan

# Everything changed since a ref (e.g. in CI against the base branch)
polder-drift scan --diff origin/main

# Whole repo
polder-drift scan --all

# Specific files
polder-drift scan src/Button.tsx src/Modal.tsx

# Machine-readable output for agents / pipelines
polder-drift scan --json --all
```

### `scan` options

| Flag | Effect |
|------|--------|
| `--diff [ref]` | Changed files vs `ref`; no ref = working-tree changes (default mode) |
| `--all` | Every tracked source file |
| `[files...]` | Explicit file paths |
| `--json` | Emit a JSON report on stdout (warnings stay on stderr) |
| `--config <path>` | Path to `.polder.yml` (default: `<cwd>/.polder.yml`) |
| `--cwd <dir>` | Repo root (default: `process.cwd()`) |
| `--fail-on-drift` | Exit 1 on any drift (overrides config) |
| `--no-fail` | Never exit non-zero on drift (overrides config) |
| `-h, --help` | Show help |

### Exit codes

- `0` — no drift, or drift found but fail-on-drift disabled
- `1` — drift found and fail-on-drift enabled
- `2` — configuration or usage error

### JSON shape

```json
{
  "version": 1,
  "config": { "componentLibrary": ["@acme/ds"], "allowlist": [], "failOnDrift": true },
  "summary": { "filesAnalyzed": 3, "filesWithDrift": 1, "totalSignals": 2 },
  "files": [
    {
      "filename": "src/Modal.tsx",
      "totalCount": 2,
      "importDrift": { "count": 1, "symbols": ["Button from './ui/Button'"] },
      "inlineDrift": {
        "localShadows": [],
        "tokenFingerprints": [],
        "propMatches": [{ "componentName": "Modal", "matchedDs": "ComposedModal", "matchedProps": ["open", "onClose"], "score": 0.66 }],
        "subComponentMatches": []
      }
    }
  ]
}
```

The `files[]` entries are the same `FullDriftResult` shape the Action renders, so an
agent can consume this directly to locate and fix drift.

## GitHub Action

```yaml
# .github/workflows/polder-drift.yml
name: Polder Drift
on: pull_request
jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - uses: usepolder/drift@v1
```

The Action reads `.polder.yml`, analyses the files touched by the PR, and upserts a
single drift comment. Run your install step before it so DS exports resolve.

## Development

```bash
npm run typecheck
npm test
npm run build:all     # bundles both the Action (dist/) and the CLI (dist/cli/)
```

## License

[Apache-2.0](LICENSE).
