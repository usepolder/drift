import * as yaml from 'js-yaml';
import type { CustomDetection } from './profiles';
import { normalizeColor } from './colors';

export interface PolderConfig extends CustomDetection {
  componentLibrary: string[];
  allowlist: string[];
  failOnDrift: boolean;
  /**
   * Where to resolve a package's exports when it isn't installed with usable types:
   * package name → directory (relative to the repo root), e.g. a checkout of the
   * design-system repo. See resolveDsSurface in parser.ts for the fallback chain.
   */
  libraryPaths?: Record<string, string>;
  // Custom detection data (all optional, from CustomDetection):
  //   tokens          — color value (hex/rgb/hsl) → token label, powers token-fingerprint
  //   classPrefixes   — DS class-name prefixes, powers token-fingerprint
  //   cssVariables    — DS CSS custom property names/prefixes, powers token-fingerprint
  //   utilityClasses  — Tailwind-style class patterns (`bg-brand-*`), powers token-fingerprint
  //   propSignatures  — DS component → distinctive props, powers prop-match
  //   subComponents   — sub-component element → DS parent, powers subcomponent
  //   nameSegments    — PascalCase word → DS parent, confidence boost only
}

interface RawConfig {
  component_library?: string | string[];
  allowlist?: string[];
  fail_on_drift?: boolean;
  library_paths?: Record<string, unknown>;
  tokens?: Record<string, unknown>;
  class_prefixes?: unknown[];
  css_variables?: unknown[];
  utility_classes?: unknown[];
  prop_signatures?: Record<string, unknown>;
  sub_components?: Record<string, unknown>;
  name_segments?: Record<string, unknown>;
}

function requireStringMap(value: unknown, key: string): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${key} must be a mapping of strings to strings`);
  }
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string') throw new Error(`${key}.${k} must be a string`);
  }
  return value as Record<string, string>;
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
    if (!cfg.component_library.every((x) => typeof x === 'string')) {
      throw new Error('component_library entries must all be strings');
    }
    componentLibrary = cfg.component_library;
  } else {
    throw new Error('component_library must be a string or array of strings');
  }

  const config: PolderConfig = {
    componentLibrary,
    // Keep only string entries; a non-string allowlist value is ignored rather than
    // crashing later string operations.
    allowlist: Array.isArray(cfg.allowlist) ? cfg.allowlist.filter((x) => typeof x === 'string') : [],
    failOnDrift: cfg.fail_on_drift === true,
  };

  if (cfg.library_paths !== undefined) {
    const paths = requireStringMap(cfg.library_paths, 'library_paths');
    // A path for a package that isn't canonical would never be consulted — that's
    // almost certainly a typo'd package name, so fail loudly.
    for (const pkg of Object.keys(paths)) {
      if (!componentLibrary.includes(pkg)) {
        throw new Error(`library_paths contains "${pkg}" which is not in component_library`);
      }
    }
    config.libraryPaths = paths;
  }

  // Custom detection data. Malformed entries throw (rather than being dropped) —
  // a silently-ignored typo here would look like the rule simply not working.
  Object.assign(config, readCustomKeys(cfg));

  return config;
}

/** Parse + validate the custom-detection keys from a raw YAML object. */
function readCustomKeys(cfg: RawConfig): CustomDetection {
  const out: CustomDetection = {};

  if (cfg.tokens !== undefined) {
    const tokens: Record<string, string> = {};
    for (const [k, v] of Object.entries(requireStringMap(cfg.tokens, 'tokens'))) {
      const color = normalizeColor(k);
      if (!color) {
        throw new Error(
          `tokens keys must be colors like "#0f62fe", "#fff", "rgb(15, 98, 254)" or "hsl(219, 99%, 53%)" (got "${k}")`,
        );
      }
      tokens[color.hex] = v;
    }
    out.tokens = tokens;
  }

  if (cfg.class_prefixes !== undefined) {
    if (!Array.isArray(cfg.class_prefixes) || !cfg.class_prefixes.every((x) => typeof x === 'string' && x.length > 0)) {
      throw new Error('class_prefixes must be an array of non-empty strings');
    }
    out.classPrefixes = cfg.class_prefixes as string[];
  }

  if (cfg.css_variables !== undefined) {
    if (
      !Array.isArray(cfg.css_variables) ||
      !cfg.css_variables.every((x) => typeof x === 'string' && x.startsWith('--') && x.length > 2)
    ) {
      throw new Error('css_variables must be an array of custom property names or prefixes like "--ds-color-"');
    }
    out.cssVariables = cfg.css_variables as string[];
  }

  if (cfg.utility_classes !== undefined) {
    if (!Array.isArray(cfg.utility_classes) || !cfg.utility_classes.every((x) => typeof x === 'string' && x.length > 0)) {
      throw new Error('utility_classes must be an array of non-empty class patterns like "bg-brand-*"');
    }
    out.utilityClasses = cfg.utility_classes as string[];
  }

  if (cfg.prop_signatures !== undefined) {
    if (typeof cfg.prop_signatures !== 'object' || cfg.prop_signatures === null || Array.isArray(cfg.prop_signatures)) {
      throw new Error('prop_signatures must be a mapping of component names to prop lists');
    }
    const signatures: Record<string, string[]> = {};
    for (const [name, props] of Object.entries(cfg.prop_signatures)) {
      if (!Array.isArray(props) || !props.every((p) => typeof p === 'string')) {
        throw new Error(`prop_signatures.${name} must be an array of prop names`);
      }
      // The matcher requires ≥2 overlapping props, so a shorter signature can never fire.
      if (props.length < 2) {
        throw new Error(`prop_signatures.${name} must list at least 2 props to be matchable`);
      }
      signatures[name] = props as string[];
    }
    out.propSignatures = signatures;
  }

  if (cfg.sub_components !== undefined) {
    out.subComponents = requireStringMap(cfg.sub_components, 'sub_components');
  }

  if (cfg.name_segments !== undefined) {
    out.nameSegments = requireStringMap(cfg.name_segments, 'name_segments');
  }

  return out;
}

/**
 * Parse a generated `.polder.profile.yml` (written by `polder-drift profile`).
 * Accepts only the custom-detection keys, validated exactly like `.polder.yml`;
 * unknown keys are ignored so the file can carry generator metadata.
 */
export function parseProfileFile(raw: string): CustomDetection {
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(`Invalid YAML in .polder.profile.yml: ${(err as Error).message}`);
  }
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid .polder.profile.yml: must be a YAML object');
  }
  return readCustomKeys(parsed as RawConfig);
}

export function readConfig(content: string | null): PolderConfig | null {
  if (content === null) return null;
  return parseConfig(content);
}
