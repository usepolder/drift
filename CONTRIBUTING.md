# Contributing to polder-drift

Thanks for helping. polder-drift is a free, Apache-2.0, local-first design-system drift
detector. It runs in your own CI (GitHub Action or Azure DevOps) and as a CLI, with no
hosted service and no code leaving your repo.

## Setup

```bash
npm ci
npm run typecheck
npm test
npm run build:all   # bundles BOTH the Action (dist/index.js) and the CLI (dist/cli/index.js)
```

Node 20+.

## How the code is organised

One pure engine, several thin surfaces:

```text
src/parser.ts        Pure detection engine (Babel AST + token fingerprints). No I/O.
src/comment/         Platform-agnostic comment core: findings + stable ids,
                     suppression (.polderignore), adoption %, new-in-PR diffing, render.
src/platforms/       Transports: github.ts (Octokit), azdo.ts (PR threads REST), the
                     PrPlatform interface, env detection, git helpers.
src/run-ci.ts        Shared CI runner (config + DS-export resolution + orchestration).
src/cli.ts           CLI: `scan`, `ci`, `init`. Engine + comment core, no host coupling.
src/detect.ts        Zero-config: detect the DS package from package.json.
```

Rules of thumb:
- Keep `src/comment/*` platform-agnostic. Anything host-specific belongs in `src/platforms/*`.
- Adding a CI host (e.g. GitLab) is a new `PrPlatform` implementation, not a fork.
- Avoid new runtime dependencies; favour explicit over clever.

For the full design rationale (why the engine is pure, the engine/core/transport split,
the anti-noise philosophy, and trade-offs), see
[docs/explanation-how-detection-works.md](docs/explanation-how-detection-works.md). The
detection rules themselves are documented in
[docs/reference-detection-rules.md](docs/reference-detection-rules.md).

## The committed bundle

The Action and CLI run from the committed `dist/` bundle. After changing anything under
`src/`, run `npm run build:all` and commit `dist/`. CI fails if `dist/` is out of date.

## Tests

Vitest. Add behaviour and edge-case coverage, not just smoke tests. Engine and comment
core should be testable without network or git (I/O is injected in `src/comment/analyze.ts`).

## Pull requests

- Branch off `main`; keep PRs focused.
- `npm run typecheck && npm test && npm run build:all` must be green; commit the rebuilt `dist/`.
- CodeRabbit reviews every PR automatically; `@coderabbitai review` re-runs it.
