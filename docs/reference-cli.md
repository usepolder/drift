# CLI reference

The `polder-drift` CLI runs the same detection engine as the GitHub Action, locally or
in any pipeline. It is implemented in [`src/cli.ts`](../src/cli.ts) and ships as the
`bin` of the `@usepolder/drift` package.

```bash
npx @usepolder/drift <command> [options]
# or, installed globally:
polder-drift <command> [options]
```

Bare `polder-drift` (no command) prints top-level help and exits `0`.

## Commands

| Command | Purpose |
|---|---|
| `scan` | Analyse files for design system drift (the default work). |
| `ci` | Post the drift comment from a CI PR build (Azure DevOps). |
| `init` | Write a starter `.polder.yml`; `--claude` also wires Claude Code. |
| `profile` | Generate `.polder.profile.yml` from your design system's source. |
| `claude-hook` | Claude Code PostToolUse hook entrypoint (reads the payload on stdin). |
| `-h`, `--help` | Show help. |

`mcp` and `telemetry` are **reserved** command names (built in later phases). Running
them today prints `not available yet` and exits `2`.

To scan a file whose name collides with a command, pass it through `scan` explicitly:
`polder-drift scan ci.tsx`.

---

## `scan`

```bash
polder-drift scan [options] [files...]
```

Discovers source files, runs all five [detection rules](reference-detection-rules.md)
on each, and prints a human or JSON report.

> `scan` honours the repo-root `.polderignore`, the same way the PR-comment surfaces
> do, and reports how many findings it suppressed. See
> [Suppress findings](howto-suppress-findings.md).

### Discovery (pick one; default is `--diff` with no ref)

| Flag | Files analysed |
|---|---|
| `--diff [ref]` | Changed vs `ref`. **With no ref**, staged + unstaged + untracked working-tree changes. This is the **default** mode. |
| `--all` | Every tracked source file (`git ls-files`). |
| `[files...]` | The given paths, taken literally. Passing any path switches the mode to explicit unless `--all`/`--diff` was set. |

Only `.ts`, `.tsx`, `.js`, `.jsx` files are ever analysed; other paths are filtered
out. Discovery (except explicit paths) shells out to `git`, so `scan` must run inside a
git repository — otherwise it exits `2` with a "git file discovery failed" message.

### Output

| Flag | Effect |
|---|---|
| `--json` | Emit a machine-readable JSON report on stdout. Warnings stay on stderr. |
| *(default)* | Human-readable summary on stdout. |

### Options

| Flag | Effect | Default |
|---|---|---|
| `--config <path>` | Path to `.polder.yml`. | `<cwd>/.polder.yml` |
| `--cwd <dir>` | Working directory / repo root. | `process.cwd()` |
| `--fail-on-drift` | Exit `1` on any drift (overrides config). | — |
| `--no-fail` | Never exit non-zero on drift (overrides config). | — |
| `-h`, `--help` | Show scan help. | — |

`--fail-on-drift` and `--no-fail` both override `fail_on_drift` from config; if both are
present the last one on the command line wins.

### Config resolution

`scan` needs a `component_library` to compare against. It resolves config in this order
([resolve-config.ts](../src/resolve-config.ts)):

1. The `.polder.yml` at `--config` (an explicit file always wins; invalid YAML exits `2`).
2. Otherwise, **zero-config detection** of a known DS package from `package.json`.
   When detection is used, a note is printed to stderr.
3. Otherwise, exit `2` with guidance to run `polder-drift init`.

See [Configuration](reference-configuration.md) for the full precedence and the list of
auto-detected packages.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | No drift, or drift found but fail-on-drift is disabled. |
| `1` | Drift found **and** fail-on-drift is enabled. |
| `2` | Configuration or usage error (bad flag, invalid YAML, no config, not a git repo). |

### Examples

```bash
# Working-tree changes (the default) — what you're about to commit
polder-drift scan

# Everything changed since the base branch, machine-readable
polder-drift scan --diff origin/main --json

# Whole repo, fail the command if anything drifts
polder-drift scan --all --fail-on-drift

# Specific files
polder-drift scan src/Button.tsx src/Modal.tsx
```

### JSON report shape

`--json` writes a single object (`CliReport`, [cli.ts:32](../src/cli.ts)):

```json
{
  "version": 1,
  "config": { "componentLibrary": ["@acme/ds"], "allowlist": [], "failOnDrift": true },
  "summary": { "filesAnalyzed": 3, "filesWithDrift": 1, "totalSignals": 2, "suppressedSignals": 0 },
  "files": [
    {
      "filename": "src/Modal.tsx",
      "totalCount": 2,
      "findings": [
        { "id": "a1b2c3d4e5f6", "rule": "import-drift", "severity": "high", "line": 2,
          "title": "Button from './ui/Button'",
          "detail": "DS component imported from a local path instead of the package" },
        { "id": "f6e5d4c3b2a1", "rule": "prop-match", "severity": "medium", "line": 9,
          "title": "Modal ~ ComposedModal", "detail": "66% prop overlap: open, onClose" }
      ],
      "importDrift": { "count": 1, "symbols": ["Button from './ui/Button'"],
                       "lines": { "Button from './ui/Button'": 2 } },
      "inlineDrift": {
        "localShadows": [],
        "tokenFingerprints": [],
        "propMatches": [
          { "componentName": "Modal", "matchedDs": "ComposedModal",
            "matchedProps": ["open", "onClose"], "score": 0.66 }
        ],
        "subComponentMatches": [],
        "componentLines": { "Modal": 9 }
      }
    }
  ]
}
```

The `files[].findings[]` list is the normalised view every surface shares: each entry
carries the same stable `id` the PR comment shows (and `.polderignore` suppresses).
The `importDrift`/`inlineDrift` shapes are the raw engine output (`FullDriftResult`),
already filtered by `.polderignore`. To consume the report programmatically, see
[Consume Polder Drift programmatically](howto-consume-json.md).

---

## `ci`

```bash
polder-drift ci
```

Posts the drift comment from inside a **CI pull-request build**. In v1 this targets
**Azure DevOps** ([commands/ci.ts](../src/commands/ci.ts)); GitHub should use the Action
instead. `ci` auto-detects the host from environment variables:

- On GitHub Actions → prints "use the Action" and exits `2`.
- On Azure DevOps → reads the `SYSTEM_PULLREQUEST_*` variables, analyses the PR diff,
  and upserts the comment via the PR threads REST API.
- No supported CI detected → exits `2` (use `scan` for local checks).

It exits `1` only when `fail_on_drift: true` and the PR introduces new drift; `0`
otherwise (including when there is no config). Full setup, required permissions, and
gating: [Polder Drift on Azure DevOps](azure-pipelines.md).

## `profile`

```bash
polder-drift profile [--force] [--cwd <dir>] [--config <path>]
```

Scans each `component_library` package's source — from `node_modules`, or the
directory named in `library_paths` — and generates `.polder.profile.yml`
([commands/profile.ts](../src/commands/profile.ts)): the auto-derived detection data
that powers the inline rules for in-house design systems.

What it derives, and the anti-noise filters applied
([generate-profile.ts](../src/generate-profile.ts)):

| Section | Derived from | Filtered out |
|---|---|---|
| `tokens` | Named hex constants (`brandCoral = '#ff3366'`) and CSS custom properties | Pure grays/white/black; test & story files |
| `class_prefixes` | Repeated BEM-style literals (`acme--…`) | Prefixes seen fewer than 3 times |
| `prop_signatures` | Component prop types (`XProps` interfaces, destructured params, `React.FC<XProps>`) | Ubiquitous props (`children`, `className`…); components with <2 distinctive props |
| `sub_components` | Compound export naming (`CardHeader` → `Card`) | Suffixes outside a part vocabulary (`ButtonGroup` is not a part of `Button`) |
| `name_segments` | Parents that own sub-components | Generic words (`Button`, `Input`, `List`…) |

The output is a **reviewable file, not runtime magic**: check it, prune anything that
looks generic, and commit it — every surface (scan, the Action, `ci`) loads it
automatically, with `.polder.yml` keys taking precedence
([resolve-config.ts](../src/resolve-config.ts)). An existing file is never
overwritten without `--force` (it may contain hand edits).

Exit codes: `0` written; `1` refused (file exists without `--force`, or nothing
distinctive found — no file written); `2` config/usage error.

## `init`

```bash
polder-drift init [--claude] [--cwd <dir>]
```

Writes a starter `.polder.yml` in `--cwd` ([commands/init.ts](../src/commands/init.ts)):

- If a known DS package is found in `package.json`, it is pre-filled and a "detected"
  message is printed. Exit `0`.
- Otherwise the file is written with a `@your-org/design-system` placeholder to edit.
  Exit `0`.
- If `.polder.yml` already exists, it is left untouched and `init` exits `1` — unless
  `--claude` is set, in which case init keeps the config and continues.

With `--claude`, init additionally wires the repo for Claude Code (all idempotent —
re-running refreshes rather than duplicates):

- Installs a `PostToolUse` hook in `.claude/settings.json` (matcher
  `Write|Edit|MultiEdit`, command `npx -y @usepolder/drift claude-hook`), merging with
  any existing settings. An unreadable or malformed settings file is left untouched
  (exit `1`, with the snippet to add manually).
- Writes a managed design-system section to `CLAUDE.md` between
  `<!-- polder-drift:begin -->` / `<!-- polder-drift:end -->` markers, naming the
  configured DS. Existing content outside the markers is preserved.

Exit codes: `0` done; `1` refused (config exists without `--claude`, unusable
settings file, or broken CLAUDE.md markers); `2` usage or invalid `.polder.yml`.
Full walkthrough: [Wire Polder Drift into Claude Code](howto-claude-code.md).

## `claude-hook`

```bash
polder-drift claude-hook   # reads the PostToolUse JSON payload on stdin
```

The Claude Code hook entrypoint ([commands/claude-hook.ts](../src/commands/claude-hook.ts)),
installed by `init --claude` — not normally run by hand. It scans the single file named
in the payload's `tool_input.file_path`, honouring the same `.polder.yml`,
`.polder.profile.yml`, and `.polderignore` as every other surface.

| Exit | Meaning |
|---|---|
| `2` | Drift found — findings on stderr are fed back to Claude, which self-corrects. |
| `0` | Clean file, non-source file, unconfigured repo, file missing/outside the project, or malformed payload — silent by design. |
| `1` | Invalid `.polder.yml` — error shown to the user, non-blocking for the agent. |

See [Wire Polder Drift into Claude Code](howto-claude-code.md) for behaviour details
and manual setup.

## Related

- [Getting started](getting-started.md) — install to first finding in three steps
- [Detection rules](reference-detection-rules.md) — what each signal means
- [Configuration](reference-configuration.md) — `.polder.yml` and zero-config detection
- [Consume Polder Drift programmatically](howto-consume-json.md) — using `--json`
