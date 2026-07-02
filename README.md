# polder-drift

[![CI](https://github.com/usepolder/drift/actions/workflows/ci.yml/badge.svg)](https://github.com/usepolder/drift/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Design system drift detection for TypeScript/JavaScript codebases. It flags components
that bypass your registered design system: local imports of DS components, in-file
shadows of DS exports, hardcoded design tokens, and prop/sub-component look-alikes.

The detection engine ([`src/parser.ts`](src/parser.ts)) is pure and deterministic
(Babel AST + token fingerprints). It needs no network and no LLM. Two front ends share
the same engine:

- **GitHub Action** ([`src/index.ts`](src/index.ts)) — posts a drift summary as a PR comment.
- **CLI** ([`src/cli.ts`](src/cli.ts)) — the same checks locally, human or JSON output.

## Documentation

New here? Start with the tutorial, then dip into reference as needed.

| Doc | Kind | What it covers |
|-----|------|----------------|
| [Getting started](docs/getting-started.md) | Tutorial | Install to first finding in three steps, no DS or CI required |
| [CLI reference](docs/reference-cli.md) | Reference | `scan` / `ci` / `init`, every flag, exit codes, JSON shape |
| [Configuration](docs/reference-configuration.md) | Reference | `.polder.yml`, `allowlist`, zero-config detection, precedence |
| [Detection rules](docs/reference-detection-rules.md) | Reference | The five drift signals, severities, and triggers |
| [How detection works](docs/explanation-how-detection-works.md) | Explanation | Why it's pure/deterministic, the architecture, the anti-noise design |
| [Suppress findings](docs/howto-suppress-findings.md) | How-to | Silencing a finding, a rule, or a path with `.polderignore` |
| [Consume programmatically](docs/howto-consume-json.md) | How-to | Using the `--json` report from a script, agent, or pipeline |
| [Azure DevOps](docs/azure-pipelines.md) | How-to | Running `polder-drift ci` on Azure DevOps pull requests |

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
    permissions:
      contents: read
      pull-requests: write   # the Action upserts a PR comment; default GITHUB_TOKEN is read-only
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # full history — lets the Action report only the drift this PR introduces
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - uses: usepolder/drift@v1
```

The Action reads `.polder.yml`, analyses the files touched by the PR, and upserts a
single drift comment. Run your install step before it so DS exports resolve. The
`fetch-depth: 0` on the checkout matters: without the base branch the Action can't tell
new drift from pre-existing, so it falls back to reporting **all** drift — the full
history is what enables the "introduced by this PR" view below.

> **Permissions.** The Action posts the comment with the workflow's `GITHUB_TOKEN`,
> which is **read-only by default** (and always read-only on PRs from forks). Without
> `pull-requests: write` the comment is silently skipped (or the run fails when
> `fail_on_drift` is on). The `permissions:` block above grants exactly what it needs.

The comment shows design-system **adoption %**, only the drift **introduced by this PR**
(pre-existing drift is collapsed), each finding's **stable ID** for suppression, and the
**commit** that introduced it. Suppress noise via a repo-root `.polderignore`:

```
# .polderignore
a1b2c3d4e5f6        # one finding, by ID
rule:token-fingerprint   # a whole rule
path:src/legacy/**       # a path glob
```

## Azure DevOps

Same comment, on Azure DevOps PRs, no extension to install. Run the CLI as a pipeline step:

```yaml
- checkout: self
  fetchDepth: 0
- script: npm ci
- script: npx @usepolder/drift ci
  env:
    SYSTEM_ACCESSTOKEN: $(System.AccessToken)
```

Full setup, permissions, and gating: [docs/azure-pipelines.md](docs/azure-pipelines.md).

## Development

```bash
npm run typecheck
npm test
npm run build:all     # bundles both the Action (dist/) and the CLI (dist/cli/)
```

## License

[Apache-2.0](LICENSE).
