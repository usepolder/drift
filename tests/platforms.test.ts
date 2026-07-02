import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { detectPlatform } from '../src/platforms/detect';
import { AzdoPlatform } from '../src/platforms/azdo';
import { GitHubPlatform } from '../src/platforms/github';
import { runCi } from '../src/run-ci';
import type { PrPlatform } from '../src/platforms/types';

describe('detectPlatform', () => {
  it('detects GitHub Actions', () => {
    expect(detectPlatform({ GITHUB_ACTIONS: 'true' } as NodeJS.ProcessEnv)).toBe('github');
  });
  it('detects Azure DevOps via TF_BUILD or SYSTEM_COLLECTIONURI', () => {
    expect(detectPlatform({ TF_BUILD: 'True' } as NodeJS.ProcessEnv)).toBe('azdo');
    expect(detectPlatform({ SYSTEM_COLLECTIONURI: 'https://dev.azure.com/x/' } as NodeJS.ProcessEnv)).toBe('azdo');
  });
  it('returns null when neither', () => {
    expect(detectPlatform({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('AzdoPlatform.fromEnv', () => {
  const fullEnv = {
    SYSTEM_COLLECTIONURI: 'https://dev.azure.com/acme/',
    SYSTEM_TEAMPROJECT: 'Web Platform',
    BUILD_REPOSITORY_ID: 'repo-guid',
    SYSTEM_PULLREQUEST_PULLREQUESTID: '42',
    SYSTEM_ACCESSTOKEN: 'tok',
    SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/main',
    BUILD_SOURCESDIRECTORY: '/agent/_work/1/s',
  } as NodeJS.ProcessEnv;

  it('builds from a full PR environment', () => {
    const p = AzdoPlatform.fromEnv(fullEnv, () => {});
    expect(p).not.toBeNull();
    expect(p!.name).toBe('azdo');
    expect(p!.workspace).toBe('/agent/_work/1/s');
    expect(p!.getBaseRef()).toBe('origin/main'); // refs/heads/ stripped, origin/ prefixed
  });

  it('returns null when required PR vars are missing', () => {
    const { SYSTEM_PULLREQUEST_PULLREQUESTID: _omit, ...partial } = fullEnv as Record<string, string>;
    expect(AzdoPlatform.fromEnv(partial as NodeJS.ProcessEnv, () => {})).toBeNull();
  });

  it('warns but still constructs when the OAuth token is empty', () => {
    let warned = '';
    const { SYSTEM_ACCESSTOKEN: _t, ...noToken } = fullEnv as Record<string, string>;
    const p = AzdoPlatform.fromEnv(noToken as NodeJS.ProcessEnv, (m) => (warned += m));
    expect(p).not.toBeNull();
    expect(warned).toContain('SYSTEM_ACCESSTOKEN');
  });

  it('upsertComment reports a skipped write (false), not success, when the token is empty', async () => {
    // No token means no credentials to write with; the result must be a truthful
    // "did not post" rather than a swallowed success. This path never hits the network.
    const { SYSTEM_ACCESSTOKEN: _t, ...noToken } = fullEnv as Record<string, string>;
    const p = AzdoPlatform.fromEnv(noToken as NodeJS.ProcessEnv, () => {})!;
    await expect(p.upsertComment('body', 'marker', true)).resolves.toBe(false);
  });
});

// The pagination, loop-guard, and throw-on-read-failure paths live in the real
// AzdoPlatform; the runCi tests below use a fake platform and never touch them. Drive
// them through upsertComment with a stubbed global fetch.
describe('AzdoPlatform.findExistingComment pagination', () => {
  const env = {
    SYSTEM_COLLECTIONURI: 'https://dev.azure.com/acme/',
    SYSTEM_TEAMPROJECT: 'Web Platform',
    BUILD_REPOSITORY_ID: 'repo-guid',
    SYSTEM_PULLREQUEST_PULLREQUESTID: '42',
    SYSTEM_ACCESSTOKEN: 'tok',
    SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/main',
    BUILD_SOURCESDIRECTORY: '/agent/_work/1/s',
  } as NodeJS.ProcessEnv;

  afterEach(() => vi.unstubAllGlobals());

  // Minimal Response stand-in: only the bits azdo.ts touches — ok/status/statusText,
  // json(), and the case-insensitive continuation-token header.
  function res(
    body: unknown,
    opts: { ok?: boolean; status?: number; continuation?: string | null } = {},
  ): Response {
    const { ok = true, status = 200, continuation = null } = opts;
    return {
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      json: async () => body,
      headers: { get: (n: string) => (n.toLowerCase() === 'x-ms-continuationtoken' ? continuation : null) },
    } as unknown as Response;
  }

  const method = (init?: RequestInit): string => (init?.method ?? 'GET').toUpperCase();

  it('follows the continuation token and matches the marker on a later page', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${method(init)} ${url}`);
      if (method(init) === 'GET') {
        // Page 1: no marker, hand back a continuation token so the scan must page on.
        if (!url.includes('continuationToken')) {
          return res({ value: [{ id: 1, comments: [{ id: 11, content: 'unrelated thread' }] }] }, { continuation: 'PAGE2' });
        }
        // Page 2: carries our marker, no further token.
        return res({ value: [{ id: 2, comments: [{ id: 22, content: 'prior body <!--polder-drift-->' }] }] });
      }
      return res(null); // PATCH
    });
    vi.stubGlobal('fetch', fetchMock);

    const p = AzdoPlatform.fromEnv(env, () => {})!;
    await expect(p.upsertComment('new body', '<!--polder-drift-->', true)).resolves.toBe(true);

    const gets = calls.filter((c) => c.startsWith('GET'));
    expect(gets).toHaveLength(2);
    expect(gets[1]).toContain('continuationToken=PAGE2'); // second page requested with the token
    const patches = calls.filter((c) => c.startsWith('PATCH'));
    expect(patches).toHaveLength(1);
    expect(patches[0]).toContain('/threads/2/comments/22'); // updated the comment found on page 2
    expect(calls.some((c) => c.startsWith('POST'))).toBe(false); // not a duplicate thread
  });

  it('stops after MAX_THREAD_PAGES (50) even if the server keeps echoing a token', async () => {
    let gets = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (method(init) === 'GET') {
        gets++;
        // Never the marker, always a token: without the cap this would loop forever.
        return res({ value: [{ id: gets, comments: [{ id: gets, content: 'no match' }] }] }, { continuation: 'SAME' });
      }
      return res(null); // POST
    });
    vi.stubGlobal('fetch', fetchMock);

    const p = AzdoPlatform.fromEnv(env, () => {})!;
    // createIfMissing: the bounded scan finds nothing, then creates the thread once.
    await expect(p.upsertComment('body', 'absent-marker', true)).resolves.toBe(true);
    expect(gets).toBe(50); // the loop guard fired at MAX_THREAD_PAGES
  });

  it('throws on a read failure instead of reporting "no comment" (which would duplicate-post)', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      method(init) === 'GET' ? res({ message: 'boom' }, { ok: false, status: 500 }) : res(null),
    );
    vi.stubGlobal('fetch', fetchMock);

    const p = AzdoPlatform.fromEnv(env, () => {})!;
    await expect(p.upsertComment('body', '<!--polder-drift-->', true)).rejects.toThrow('GET 500');
    // A failed read must NOT fall through to a POST that double-posts the comment.
    const posted = fetchMock.mock.calls.some(([, init]) => method(init as RequestInit) === 'POST');
    expect(posted).toBe(false);
  });
});

// GitHubPlatform.findExistingComment walks every page of issue comments so the marker
// isn't missed on a PR with >100 comments (which would duplicate-post). Drive the real
// pagination loop through upsertComment with a stubbed octokit + Action context — the
// GitHub analog of the AzDO fetch-stub test above.
describe('GitHubPlatform.findExistingComment pagination', () => {
  const ORIG_REPO = process.env.GITHUB_REPOSITORY;

  afterEach(() => {
    vi.restoreAllMocks();
    github.context.payload = {};
    if (ORIG_REPO === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = ORIG_REPO;
  });

  interface Comment {
    id: number;
    body: string;
  }

  // Build a GitHubPlatform whose octokit serves `pages` of issue comments (the `page`
  // param is 1-based). Returns the platform plus the listComments/update/create spies.
  function platformWith(pages: Comment[][]) {
    const listComments = vi.fn(async ({ page }: { page: number }) => ({ data: pages[page - 1] ?? [] }));
    const updateComment = vi.fn(async () => ({ data: {} }));
    const createComment = vi.fn(async () => ({ data: {} }));
    const octokit = { rest: { issues: { listComments, updateComment, createComment } } };

    vi.spyOn(github, 'getOctokit').mockReturnValue(octokit as unknown as ReturnType<typeof github.getOctokit>);
    vi.spyOn(core, 'getInput').mockReturnValue('test-token');
    process.env.GITHUB_REPOSITORY = 'acme/web';
    github.context.payload = { pull_request: { number: 42, base: { sha: 'base-sha' } } };

    return { platform: GitHubPlatform.fromEnv()!, listComments, updateComment, createComment };
  }

  // A full 100-comment page forces the loop to request the next page; a short page (or
  // the marker turning up) ends the walk.
  const fullPage = (start: number): Comment[] =>
    Array.from({ length: 100 }, (_, i) => ({ id: start + i, body: `noise ${start + i}` }));

  it('walks to a later page and updates the marker comment found there', async () => {
    const marker = '<!--polder-drift-->';
    const { platform, listComments, updateComment, createComment } = platformWith([
      fullPage(1), // page 1: 100 unrelated comments → must page on
      [{ id: 999, body: `prior body ${marker}` }], // page 2: our comment, short page → stop
    ]);

    await expect(platform.upsertComment('new body', marker, true)).resolves.toBe(true);

    expect(listComments).toHaveBeenCalledTimes(2);
    expect(listComments.mock.calls[1][0]).toMatchObject({ page: 2, per_page: 100 }); // second page requested
    expect(updateComment).toHaveBeenCalledTimes(1);
    expect(updateComment.mock.calls[0][0]).toMatchObject({ comment_id: 999, body: 'new body' }); // updated, not duplicated
    expect(createComment).not.toHaveBeenCalled();
  });

  it('stops on the first short page without over-fetching', async () => {
    const { platform, listComments } = platformWith([
      [{ id: 1, body: 'only page' }], // a single sub-100 page means there is no second page to fetch
    ]);
    await expect(platform.upsertComment('body', '<!--polder-drift-->', true)).resolves.toBe(true);
    expect(listComments).toHaveBeenCalledTimes(1);
  });

  it('propagates a list failure instead of reporting "no comment" (which would duplicate-post)', async () => {
    const { platform, listComments, createComment } = platformWith([]);
    listComments.mockRejectedValueOnce(new Error('HttpError: 500'));
    await expect(platform.upsertComment('body', '<!--polder-drift-->', true)).rejects.toThrow('500');
    // A failed read must NOT fall through to a create that double-posts the comment.
    expect(createComment).not.toHaveBeenCalled();
  });
});

// GitHubPlatform.getChangedSourceFiles walks every page of pulls.listFiles so PRs with
// >100 changed files are fully analysed instead of silently truncated to the first page.
describe('GitHubPlatform.getChangedSourceFiles pagination', () => {
  const ORIG_REPO = process.env.GITHUB_REPOSITORY;

  afterEach(() => {
    vi.restoreAllMocks();
    github.context.payload = {};
    if (ORIG_REPO === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = ORIG_REPO;
  });

  interface PrFile {
    filename: string;
    status: string;
  }

  function platformWith(pages: PrFile[][]) {
    const listFiles = vi.fn(async ({ page }: { page: number }) => ({ data: pages[page - 1] ?? [] }));
    const octokit = { rest: { pulls: { listFiles } } };

    vi.spyOn(github, 'getOctokit').mockReturnValue(octokit as unknown as ReturnType<typeof github.getOctokit>);
    vi.spyOn(core, 'getInput').mockReturnValue('test-token');
    process.env.GITHUB_REPOSITORY = 'acme/web';
    github.context.payload = { pull_request: { number: 42, base: { sha: 'base-sha' } } };

    return { platform: GitHubPlatform.fromEnv()!, listFiles };
  }

  const fullPage = (start: number): PrFile[] =>
    Array.from({ length: 100 }, (_, i) => ({ filename: `src/File${start + i}.tsx`, status: 'modified' }));

  it('collects files across pages instead of stopping at the first 100', async () => {
    const { platform, listFiles } = platformWith([
      fullPage(1), // page 1 is full → must page on
      [
        { filename: 'src/File101.tsx', status: 'modified' },
        { filename: 'src/Removed.tsx', status: 'removed' }, // filtered out
        { filename: 'README.md', status: 'modified' }, // not a source file
      ],
    ]);

    const files = await platform.getChangedSourceFiles();
    expect(listFiles).toHaveBeenCalledTimes(2);
    expect(listFiles.mock.calls[1][0]).toMatchObject({ page: 2, per_page: 100 });
    expect(files).toHaveLength(101);
    expect(files).toContain('src/File101.tsx');
    expect(files).not.toContain('src/Removed.tsx');
    expect(files).not.toContain('README.md');
  });

  it('stops on the first short page without over-fetching', async () => {
    const { platform, listFiles } = platformWith([[{ filename: 'src/A.tsx', status: 'added' }]]);
    await expect(platform.getChangedSourceFiles()).resolves.toEqual(['src/A.tsx']);
    expect(listFiles).toHaveBeenCalledTimes(1);
  });
});

// run-ci must report the *true* posted state and surface a failed write loudly, rather
// than claiming a comment was posted when the transport never wrote one (findings #3/#16).
describe('runCi post-state tracking', () => {
  // When `baseContent` is given, the dir is a real git repo: the clean version is
  // committed as the base, then the working tree is dirtied with `content`. This is the
  // only way to exercise the base-available path — fail-on-drift is gated on a base
  // actually being in the clone (PR #2), and `baseRefExists` shells out to real git.
  function withConfiguredRepo(
    file: string,
    content: string,
    fn: (dir: string) => Promise<void>,
    baseContent?: string,
  ): Promise<void> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polder-runci-'));
    fs.writeFileSync(path.join(dir, '.polder.yml'), 'component_library: "@acme/ds"\n');
    if (baseContent !== undefined) {
      const g = (args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
      g(['init', '-q']);
      g(['config', 'user.email', 'test@polder.dev']);
      g(['config', 'user.name', 'test']);
      fs.writeFileSync(path.join(dir, file), baseContent);
      g(['add', '.']);
      g(['commit', '-q', '-m', 'base']);
    }
    fs.writeFileSync(path.join(dir, file), content);
    return fn(dir).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
  }

  const DRIFT = `import { Button } from './ui/Button';\nexport const X = () => <Button />;\n`;
  // A clean base for the same file: no local import, so it produces no drift and DRIFT's
  // finding counts as genuinely new in the PR.
  const CLEAN = `export const X = () => null;\n`;

  function fakePlatform(opts: {
    workspace: string;
    files: string[];
    upsert: PrPlatform['upsertComment'];
    onFail?: (m: string) => void;
    baseRef?: string | null;
  }): PrPlatform {
    return {
      name: 'azdo',
      workspace: opts.workspace,
      getBaseRef: () => opts.baseRef ?? null, // default: no base → all findings are "new"
      getChangedSourceFiles: async () => opts.files,
      upsertComment: opts.upsert,
      fail: (m) => opts.onFail?.(m),
    };
  }

  it('reports posted:true only when the transport actually wrote a comment', async () => {
    await withConfiguredRepo('drift.tsx', DRIFT, async (dir) => {
      const res = await runCi(
        fakePlatform({ workspace: dir, files: ['drift.tsx'], upsert: async () => true }),
        { warn: () => {} },
      );
      expect(res.posted).toBe(true);
      expect(res.postError).toBeUndefined();
    });
  });

  it('reports posted:false (no error) when the transport intentionally skips the write', async () => {
    await withConfiguredRepo('clean.tsx', 'export const a = 1;\n', async (dir) => {
      const res = await runCi(
        fakePlatform({ workspace: dir, files: ['clean.tsx'], upsert: async () => false }),
        { warn: () => {} },
      );
      expect(res.posted).toBe(false);
      expect(res.postError).toBeUndefined();
    });
  });

  it('a thrown write is reported as posted:false with the error surfaced loudly via warn', async () => {
    await withConfiguredRepo('drift.tsx', DRIFT, async (dir) => {
      let warned = '';
      const res = await runCi(
        fakePlatform({
          workspace: dir,
          files: ['drift.tsx'],
          upsert: async () => {
            throw new Error('POST 403 Forbidden');
          },
        }),
        { warn: (m) => (warned += m + '\n') },
      );
      expect(res.posted).toBe(false);
      expect(res.postError).toBe('POST 403 Forbidden');
      expect(warned).toContain('403 Forbidden');
      expect(warned).toContain('NOT on the PR');
    });
  });

  it('a failed write during a fail-on-drift run is folded into the loud failure message', async () => {
    // Real base (CLEAN) + drifted head (DRIFT) so the finding is genuinely new and the
    // base is available — fail-on-drift only fires when we can tell new from pre-existing.
    await withConfiguredRepo(
      'drift.tsx',
      DRIFT,
      async (dir) => {
        let failMsg = '';
        const res = await runCi(
          fakePlatform({
            workspace: dir,
            files: ['drift.tsx'],
            baseRef: 'HEAD',
            upsert: async () => {
              throw new Error('POST 403 Forbidden');
            },
            onFail: (m) => (failMsg = m),
          }),
          { warn: () => {}, failOnDriftOverride: true },
        );
        expect(res.failed).toBe(true);
        expect(res.posted).toBe(false);
        // The build goes red AND the operator is told why no comment appeared.
        expect(failMsg).toContain('new drift signal');
        expect(failMsg).toContain('could not be posted');
        expect(failMsg).toContain('403 Forbidden');
      },
      CLEAN,
    );
  });
});
