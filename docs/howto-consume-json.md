# How to consume Polder Drift programmatically

This guide shows how to use Polder Drift's output from a script, an agent, or another
pipeline — to locate drift, gate a build, or feed a code-fixing tool. The supported,
package-friendly path is the `scan --json` report.

## Prerequisites

- Node 20+ and the `@usepolder/drift` package available (`npx @usepolder/drift` or a
  dev dependency).
- A resolvable config: a `.polder.yml`, or an auto-detected DS package in `package.json`
  (see [Configuration](reference-configuration.md)).
- Your dependencies installed (`npm ci`), so DS exports resolve for exact matching.

> **Why JSON, not `import`?** The published package ships only the bundled `dist/` and
> exposes the Action as its `main` and the CLI as its `bin`. It does **not** re-export
> the engine functions for library import, so `import { checkDriftFull } from
> '@usepolder/drift'` will not work against the npm package. Consume the `--json` report
> instead. (To call the TypeScript functions directly, see
> [Appendix: importing the engine from source](#appendix-importing-the-engine-from-source).)

## Steps

### 1. Produce a JSON report

```bash
npx @usepolder/drift scan --all --json > drift.json
```

`--json` writes the report to **stdout**; warnings (e.g. "could not resolve exports")
go to **stderr**, so redirecting stdout gives you clean JSON. Swap `--all` for
`--diff origin/main` to scan only what changed versus the base branch.

### 2. Read the report shape

```json
{
  "version": 1,
  "config": { "componentLibrary": ["@acme/ds"], "allowlist": [], "failOnDrift": false },
  "summary": { "filesAnalyzed": 12, "filesWithDrift": 2, "totalSignals": 5, "suppressedSignals": 0 },
  "files": [
    {
      "filename": "src/PLP.tsx",
      "totalCount": 3,
      "findings": [
        { "id": "a1b2c3d4e5f6", "rule": "import-drift", "severity": "high", "line": 3,
          "title": "Card from './ui/Card'",
          "detail": "DS component imported from a local path instead of the package" },
        { "id": "0f9e8d7c6b5a", "rule": "prop-match", "severity": "medium", "line": 18,
          "title": "PriceSlider ~ MuiSlider",
          "detail": "62% prop overlap: value, onChange, min, max, step" }
      ],
      "importDrift": {
        "count": 1,
        "symbols": ["Card from './ui/Card'"],
        "lines": { "Card from './ui/Card'": 3 }
      },
      "inlineDrift": {
        "localShadows": [],
        "tokenFingerprints": [
          { "componentName": "PriceSlider", "tokens": ["#1976d2"], "classNames": [] }
        ],
        "propMatches": [
          { "componentName": "PriceSlider", "matchedDs": "MuiSlider",
            "matchedProps": ["value", "onChange", "min", "max", "step"], "score": 0.625 }
        ],
        "subComponentMatches": [],
        "componentLines": { "PriceSlider": 18 }
      }
    }
  ]
}
```

`files[].findings[]` is usually all a downstream tool needs: each finding carries the
same stable `id` shown in the PR comment (usable in `.polderignore`), its rule,
severity, and the 1-based source `line` (the import specifier for import-drift, the
component definition for the inline rules), so a fixer can jump straight to the code.
The `importDrift`/`inlineDrift` shapes are the raw engine output for one file
(`FullDriftResult`), with the same line info in `importDrift.lines` and
`inlineDrift.componentLines`. Both views are already filtered by `.polderignore`.

### 3. Act on it

Pick the drift out of the report. Example in Node:

```js
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync('drift.json', 'utf8'));

for (const file of report.files) {
  if (file.totalCount === 0) continue;
  for (const sym of file.importDrift.symbols) {
    console.log(`${file.filename}: import drift — ${sym}`);
  }
  for (const pm of file.inlineDrift.propMatches) {
    console.log(`${file.filename}: ${pm.componentName} looks like ${pm.matchedDs} ` +
      `(${Math.round(pm.score * 100)}% prop overlap)`);
  }
}

console.log(`${report.summary.totalSignals} signals in ` +
  `${report.summary.filesWithDrift}/${report.summary.filesAnalyzed} files`);
```

### 4. Gate a build on the exit code

You don't have to parse JSON just to fail a build. `scan` already encodes the verdict in
its [exit code](reference-cli.md#exit-codes):

```bash
# Exit 1 if any drift is found, regardless of config
npx @usepolder/drift scan --all --fail-on-drift
```

| Code | Meaning |
|---|---|
| `0` | No drift, or drift found but fail-on-drift disabled. |
| `1` | Drift found and fail-on-drift enabled. |
| `2` | Config/usage error (bad flag, invalid YAML, not a git repo). |

In a shell gate, treat `2` distinctly from `1` — a `2` means the run never really
checked anything (often a missing `.polder.yml` or a non-git directory), not that the
code is clean.

## Verification

```bash
# Should print valid JSON and nothing on stderr when config + deps are in place
npx @usepolder/drift scan --all --json | node -e 'JSON.parse(require("fs").readFileSync(0)); console.log("ok")'
```

If you see `could not resolve exports … Falling back to PascalCase heuristic` on stderr,
run your install step first — the report is still valid but import-drift will be broader
and `localShadows` will be empty.

## Troubleshooting

- **Empty `files[]` / nothing analysed.** `scan`'s default mode is `--diff` (working-tree
  changes). With a clean tree that's empty — pass `--all` or an explicit `--diff <ref>`.
- **`git file discovery failed`.** `scan` shells out to git for discovery; run it inside
  a git repo, or pass explicit file paths.
- **Exit `2` with "no `.polder.yml`".** Add a config or run `polder-drift init`
  (see [Configuration](reference-configuration.md)).

## Appendix: importing the engine from source

If you are **vendoring or contributing** to Polder Drift (working in a checkout, not the
published package), the engine functions are exported from
[`src/parser.ts`](../src/parser.ts) and the comment core from
[`src/comment/`](../src/comment):

```ts
import { checkDriftFull, resolveExports } from './src/parser';
import { flattenFindings } from './src/comment/findings';
import { analyzePr } from './src/comment/analyze';

const dsExports = resolveExports('@mui/material', './node_modules');
const result = checkDriftFull(source, dsExports, ['@mui/material'], [], 'src/PLP.tsx');
const findings = flattenFindings('src/PLP.tsx', result); // each with a stable id
```

`analyzePr()` is the highest-level entry point — give it the changed files and
file-reader functions and it returns the rendered comment body plus a `shouldComment`
verdict ([analyze.ts](../src/comment/analyze.ts)). This is exactly what the GitHub and
Azure DevOps transports call.

## Related

- [CLI reference](reference-cli.md) — every flag and the full JSON shape
- [Detection rules](reference-detection-rules.md) — what each `inlineDrift.*` entry means
- [How detection works](explanation-how-detection-works.md) — the engine/core/transport split
