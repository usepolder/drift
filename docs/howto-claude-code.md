# Wire Polder Drift into Claude Code

AI agents are a major source of design-system drift: asked for a button, they happily
hand-roll one instead of importing yours. The GitHub Action catches that at review
time; this integration catches it **at write time** — every file Claude Code writes or
edits is scanned immediately, and findings are fed back to the agent so it fixes the
drift in the same turn, before the diff ever reaches a PR.

## Setup

From the repo root:

```bash
npx @usepolder/drift init --claude
```

That writes three things, each idempotent (re-running refreshes rather than duplicates):

| Artifact | What it does |
|---|---|
| `.polder.yml` | The standard starter config, auto-detecting your DS — only if missing; an existing config is never touched. |
| `.claude/settings.json` | A `PostToolUse` hook (matcher `Write\|Edit\|MultiEdit`) running `npx -y @usepolder/drift claude-hook`. Merged into existing settings; other hooks and keys are preserved. |
| `CLAUDE.md` | A managed section (between `<!-- polder-drift:begin -->` / `<!-- polder-drift:end -->` markers) naming your design system and telling the agent how to stay on it. Appended to an existing file; only the marked section is ever rewritten. |

Commit all three so the whole team's agents get the same guardrail. If you'd rather
keep the hook personal, move the hook entry from `.claude/settings.json` into
`.claude/settings.local.json`.

**Install the package too.** The hook command uses `npx -y`, which resolves the locally
installed `@usepolder/drift` when present and only falls back to fetching it otherwise.
For a fast hook (it runs on every edit), add it to the repo:

```bash
npm install --save-dev @usepolder/drift
```

If your design system changes, edit `.polder.yml` and re-run
`npx @usepolder/drift init --claude` — the CLAUDE.md section is refreshed in place.

## How the hook behaves

`claude-hook` reads the PostToolUse JSON payload on stdin, scans just the touched file
with the same engine (and the same `.polder.yml`, `.polder.profile.yml`, and
`.polderignore`) every other surface uses, and exits:

| Situation | Exit | Effect |
|---|---|---|
| Drift found | `2` | Findings on stderr are **fed back to Claude**, which fixes them in the same turn. |
| File is clean | `0` | Silent. |
| Not a `.ts`/`.tsx`/`.js`/`.jsx` file | `0` | Silent — nothing to scan. |
| No `.polder.yml` and no detectable DS | `0` | Silent — the hook never nags unconfigured repos. |
| File outside the project, or already deleted | `0` | Silent. |
| Malformed payload | `0` | Silent — a broken hook must never block the edit loop. |
| Invalid `.polder.yml` | `1` | Error on stderr, shown to **you** (not the agent), non-blocking. |

The asymmetry is deliberate: the hook is loud only when there is real, actionable
drift. Findings suppressed via `.polderignore` don't fire it, so an agent can't be
sent chasing drift you've already accepted — and a locally quiet hook means a quiet
PR comment later.

## Manual setup

If you prefer to wire it yourself, the settings entry `init --claude` installs is:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{ "type": "command", "command": "npx -y @usepolder/drift claude-hook" }]
      }
    ]
  }
}
```

Any agent harness that can run a command after file edits can use the same entrypoint —
pipe it a JSON object with `cwd` and `tool_input.file_path` and act on exit code `2`.
For agents that consume reports instead of hooks, see
[Consume Polder Drift programmatically](howto-consume-json.md).

## Related

- [CLI reference](reference-cli.md) — `init` and `claude-hook` flags and exit codes
- [Suppress findings](howto-suppress-findings.md) — when a finding is acceptable
- [Configuration](reference-configuration.md) — `.polder.yml` and zero-config detection
