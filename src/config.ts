import * as yaml from 'js-yaml';

export interface PolderConfig {
  componentLibrary: string[];
  allowlist: string[];
  failOnDrift: boolean;
}

interface RawConfig {
  component_library?: string | string[];
  allowlist?: string[];
  fail_on_drift?: boolean;
}

export function parseConfig(raw: string): PolderConfig {
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(`Invalid YAML in .polder.yml: ${(err as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid .polder.yml: must be a YAML object');
  }

  const cfg = parsed as RawConfig;

  if (cfg.component_library === undefined || cfg.component_library === null) {
    throw new Error('component_library is required in .polder.yml');
  }

  let componentLibrary: string[];
  if (typeof cfg.component_library === 'string') {
    componentLibrary = [cfg.component_library];
  } else if (Array.isArray(cfg.component_library)) {
    if (cfg.component_library.length === 0) {
      throw new Error('component_library is required in .polder.yml');
    }
    componentLibrary = cfg.component_library;
  } else {
    throw new Error('component_library must be a string or array of strings');
  }

  return {
    componentLibrary,
    allowlist: Array.isArray(cfg.allowlist) ? cfg.allowlist : [],
    failOnDrift: cfg.fail_on_drift === true,
  };
}

export function readConfig(content: string | null): PolderConfig | null {
  if (content === null) return null;
  return parseConfig(content);
}
