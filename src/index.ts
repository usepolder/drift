import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs';
import * as path from 'path';
import { readConfig } from './config';
import { resolveExports, checkDriftFull, type FullDriftResult } from './parser';

const COMMENT_MARKER = '<!-- polder-drift-comment -->';
const MAX_FILES = 100;
const MAX_TABLE_ROWS = 20;

// ── Setup guide (no .polder.yml found) ───────────────────────────────────────

const SETUP_GUIDE = `${COMMENT_MARKER}
## Polder — Design System Drift

No \`.polder.yml\` found in this repo. To enable drift detection, add one:

\`\`\`yaml
component_library: "@your-org/design-system"
fail_on_drift: false
\`\`\`

Then re-run this Action. [Full setup guide →](https://github.com/usepolder/drift#setup)
`;

// ── PR comment ────────────────────────────────────────────────────────────────

interface FileResult {
  filename: string;
  result: FullDriftResult;
}

function buildComment(fileResults: FileResult[], capped: boolean): string {
  const totalSignals = fileResults.reduce((s, r) => s + r.result.totalCount, 0);
  const driftedFiles = fileResults.filter((r) => r.result.totalCount > 0);

  const lines: string[] = [COMMENT_MARKER, '## Polder — Design System Drift', ''];

  if (totalSignals === 0) {
    lines.push('✅ No design system drift detected in files touched by this PR.');
    if (capped) lines.push('', `> Analysis capped at ${MAX_FILES} files.`);
    return lines.join('\n');
  }

  lines.push(
    `⚠️ **${totalSignals} drift signal${totalSignals === 1 ? '' : 's'}** across ` +
      `${driftedFiles.length} file${driftedFiles.length === 1 ? '' : 's'} touched by this PR`,
  );
  lines.push('');

  // ── Import drift ───────────────────────────────────────────────────────────

  const importRows: string[] = [];
  for (const { filename, result } of driftedFiles) {
    for (const sym of result.importDrift.symbols) {
      importRows.push(`| \`${filename}\` | \`${sym}\` |`);
    }
  }
  if (importRows.length > 0) {
    lines.push(`### 🔴 Import drift (${importRows.length})`);
    lines.push('DS component imported from a local path instead of the canonical package.');
    lines.push('');
    lines.push('| File | Symbol |');
    lines.push('|------|--------|');
    lines.push(...importRows.slice(0, MAX_TABLE_ROWS));
    if (importRows.length > MAX_TABLE_ROWS) {
      lines.push(`| … | _and ${importRows.length - MAX_TABLE_ROWS} more_ |`);
    }
    lines.push('');
  }

  // ── Local shadows ──────────────────────────────────────────────────────────

  const shadowRows: string[] = [];
  for (const { filename, result } of driftedFiles) {
    for (const name of result.inlineDrift.localShadows) {
      shadowRows.push(`| \`${filename}\` | \`${name}\` |`);
    }
  }
  if (shadowRows.length > 0) {
    lines.push(`### 🔴 Local shadows (${shadowRows.length})`);
    lines.push('Component defined in-file with the same name as a DS export.');
    lines.push('');
    lines.push('| File | Component |');
    lines.push('|------|-----------|');
    lines.push(...shadowRows.slice(0, MAX_TABLE_ROWS));
    if (shadowRows.length > MAX_TABLE_ROWS) {
      lines.push(`| … | _and ${shadowRows.length - MAX_TABLE_ROWS} more_ |`);
    }
    lines.push('');
  }

  // ── Token fingerprints ─────────────────────────────────────────────────────

  const tokenRows: string[] = [];
  for (const { filename, result } of driftedFiles) {
    for (const fp of result.inlineDrift.tokenFingerprints) {
      const parts: string[] = [];
      if (fp.tokens.length > 0) parts.push(fp.tokens.map((t) => `\`${t}\``).join(', '));
      if (fp.classNames.length > 0) parts.push(fp.classNames.map((c) => `\`${c}\``).join(', '));
      tokenRows.push(`| \`${filename}\` | \`${fp.componentName}\` | ${parts.join(' · ')} |`);
    }
  }
  if (tokenRows.length > 0) {
    lines.push(`### 🟡 Token fingerprints (${tokenRows.length})`);
    lines.push('Locally-defined component body contains Carbon design tokens or `cds--` class names.');
    lines.push('');
    lines.push('| File | Component | Carbon signals |');
    lines.push('|------|-----------|----------------|');
    lines.push(...tokenRows.slice(0, MAX_TABLE_ROWS));
    if (tokenRows.length > MAX_TABLE_ROWS) {
      lines.push(`| … | | _and ${tokenRows.length - MAX_TABLE_ROWS} more_ |`);
    }
    lines.push('');
  }

  // ── Prop signature matches ─────────────────────────────────────────────────

  const propRows: string[] = [];
  for (const { filename, result } of driftedFiles) {
    for (const pm of result.inlineDrift.propMatches) {
      const pct = Math.round(pm.score * 100);
      propRows.push(
        `| \`${filename}\` | \`${pm.componentName}\` | \`${pm.matchedDs}\` | ${pct}% | ${pm.matchedProps.map((p) => `\`${p}\``).join(', ')} |`,
      );
    }
  }
  if (propRows.length > 0) {
    lines.push(`### 🟣 Prop signature matches (${propRows.length})`);
    lines.push("Locally-defined component's prop API closely mirrors a DS component.");
    lines.push('');
    lines.push('| File | Component | Matches DS | Score | Matched props |');
    lines.push('|------|-----------|------------|-------|---------------|');
    lines.push(...propRows.slice(0, MAX_TABLE_ROWS));
    if (propRows.length > MAX_TABLE_ROWS) {
      lines.push(`| … | | | | _and ${propRows.length - MAX_TABLE_ROWS} more_ |`);
    }
    lines.push('');
  }

  // ── Footer ─────────────────────────────────────────────────────────────────

  if (capped) {
    lines.push(`> ⚠️ Analysis capped at ${MAX_FILES} files. Large PRs may have additional drift.`);
    lines.push('');
  }

  lines.push('<details>');
  lines.push('<summary>What is design system drift?</summary>');
  lines.push('');
  lines.push('Drift happens when developers build custom components that duplicate DS ones,');
  lines.push('losing accessibility guarantees, theming, and maintainability in the process.');
  lines.push('');
  lines.push('**Signal types:**');
  lines.push('- 🔴 **Import drift** — DS component imported from a local path instead of the package');
  lines.push('- 🔴 **Local shadow** — component defined in-file with the same name as a DS export');
  lines.push('- 🟡 **Token fingerprint** — component body hardcodes Carbon hex values or `cds--` classes');
  lines.push('- 🟣 **Prop match** — component props mirror a known DS component API (≥60% overlap)');
  lines.push('');
  lines.push('Results cover all drift found in files touched by this PR, including pre-existing signals.');
  lines.push('</details>');

  return lines.join('\n');
}

// ── GitHub comment helpers ────────────────────────────────────────────────────

async function findExistingComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<number | null> {
  try {
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
    });
    const polderComments = comments.filter((c) => c.body?.includes(COMMENT_MARKER));
    if (polderComments.length === 0) return null;
    return polderComments[polderComments.length - 1].id;
  } catch (err) {
    throw new Error(`GitHub API error listing comments: ${(err as Error).message}`);
  }
}

async function upsertComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  const existingId = await findExistingComment(octokit, owner, repo, prNumber);
  try {
    if (existingId !== null) {
      await octokit.rest.issues.updateComment({ owner, repo, comment_id: existingId, body });
    } else {
      await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
    }
  } catch (err) {
    throw new Error(`Failed to post PR comment: ${(err as Error).message}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const token = core.getInput('github-token', { required: true });
  const octokit = github.getOctokit(token);
  const ctx = github.context;

  if (!ctx.payload.pull_request) {
    core.warning('Polder: not a pull_request event — skipping');
    return;
  }

  const { owner, repo } = ctx.repo;
  const prNumber = ctx.payload.pull_request.number;

  // Load .polder.yml from the PR head
  let configContent: string | null = null;
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: '.polder.yml',
      ref: ctx.payload.pull_request.head.sha,
    });
    if ('content' in data && typeof data.content === 'string') {
      configContent = Buffer.from(data.content, 'base64').toString('utf8');
    }
  } catch (err: unknown) {
    if ((err as { status?: number }).status !== 404) throw err;
  }

  if (configContent === null) {
    await upsertComment(octokit, owner, repo, prNumber, SETUP_GUIDE);
    return;
  }

  let config;
  try {
    config = readConfig(configContent);
    if (!config) {
      await upsertComment(octokit, owner, repo, prNumber, SETUP_GUIDE);
      return;
    }
  } catch (err) {
    core.setFailed(`Polder: invalid .polder.yml — ${(err as Error).message}`);
    return;
  }

  // Resolve DS exports from node_modules (requires dependencies installed before this action)
  const workspace = process.env.GITHUB_WORKSPACE ?? '.';
  const nodeModulesDir = path.join(workspace, 'node_modules');
  const dsExports = new Set<string>();
  for (const pkg of config.componentLibrary) {
    const pkgExports = resolveExports(pkg, nodeModulesDir);
    if (pkgExports.size === 0) {
      core.warning(
        `Polder: could not resolve exports for "${pkg}" from node_modules. ` +
          `Run npm/yarn install before this action. Falling back to PascalCase heuristic.`,
      );
    }
    for (const name of pkgExports) dsExports.add(name);
  }

  // Fetch PR file list
  const { data: prFiles } = await octokit.rest.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
    per_page: MAX_FILES,
  });
  const capped = prFiles.length === MAX_FILES;

  const sourceFiles = prFiles.filter(
    (f) => /\.(ts|tsx|js|jsx)$/.test(f.filename) && f.status !== 'removed',
  );

  // Analyse each file from disk (requires actions/checkout before this step)
  const fileResults: FileResult[] = [];

  for (const file of sourceFiles) {
    const filePath = path.join(workspace, file.filename);
    let fileContent: string;
    try {
      fileContent = fs.readFileSync(filePath, 'utf8');
    } catch {
      core.debug(`Polder: could not read ${file.filename} from workspace — skipping`);
      continue;
    }

    const result = checkDriftFull(
      fileContent,
      dsExports,
      config.componentLibrary,
      config.allowlist,
      file.filename,
    );

    core.debug(
      `Polder: ${file.filename} — ${result.totalCount} signal(s) ` +
        `(import: ${result.importDrift.count}, ` +
        `tokens: ${result.inlineDrift.tokenFingerprints.length}, ` +
        `props: ${result.inlineDrift.propMatches.length}, ` +
        `shadows: ${result.inlineDrift.localShadows.length})`,
    );

    fileResults.push({ filename: file.filename, result });
  }

  const body = buildComment(fileResults, capped);
  await upsertComment(octokit, owner, repo, prNumber, body);

  const totalSignals = fileResults.reduce((s, r) => s + r.result.totalCount, 0);
  if (config.failOnDrift && totalSignals > 0) {
    core.setFailed(
      `Polder: ${totalSignals} drift signal${totalSignals === 1 ? '' : 's'} detected across ` +
        `${fileResults.filter((r) => r.result.totalCount > 0).length} file(s)`,
    );
  }
}

run().catch((err: Error) => {
  core.setFailed(err.message);
});
