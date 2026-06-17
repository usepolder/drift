import { describe, it, expect } from 'vitest';
import { parseConfig, readConfig } from '../src/config';

describe('parseConfig', () => {
  it('absent config → readConfig returns null', () => {
    expect(readConfig(null)).toBeNull();
  });

  it('component_library as string → single-element array', () => {
    const cfg = parseConfig('component_library: "@acme/ds"');
    expect(cfg.componentLibrary).toEqual(['@acme/ds']);
  });

  it('component_library as array of strings → all entries preserved', () => {
    const cfg = parseConfig(
      'component_library:\n  - "@acme/ds"\n  - "@acme/icons"',
    );
    expect(cfg.componentLibrary).toEqual(['@acme/ds', '@acme/icons']);
  });

  it('component_library as empty array → throws', () => {
    expect(() => parseConfig('component_library: []')).toThrow(
      'component_library is required',
    );
  });

  it('component_library missing → throws', () => {
    expect(() => parseConfig('fail_on_drift: false')).toThrow(
      'component_library is required',
    );
  });

  it('invalid YAML → throws with human-readable error', () => {
    expect(() => parseConfig(': : invalid')).toThrow('Invalid YAML');
  });

  it('allowlist present → included; absent → defaults to []', () => {
    const withAllowlist = parseConfig(
      'component_library: "@acme/ds"\nallowlist:\n  - "src/wrappers/"',
    );
    expect(withAllowlist.allowlist).toEqual(['src/wrappers/']);

    const withoutAllowlist = parseConfig('component_library: "@acme/ds"');
    expect(withoutAllowlist.allowlist).toEqual([]);
  });

  it('fail_on_drift: true parsed correctly', () => {
    const cfg = parseConfig('component_library: "@acme/ds"\nfail_on_drift: true');
    expect(cfg.failOnDrift).toBe(true);
  });

  it('fail_on_drift: false is default', () => {
    const cfg = parseConfig('component_library: "@acme/ds"');
    expect(cfg.failOnDrift).toBe(false);
  });
});
