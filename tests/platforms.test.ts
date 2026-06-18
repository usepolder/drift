import { describe, it, expect } from 'vitest';
import { detectPlatform } from '../src/platforms/detect';
import { AzdoPlatform } from '../src/platforms/azdo';

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
});
