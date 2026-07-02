/**
 * Resolve a PolderConfig for a run. Precedence:
 *   1. An explicit `.polder.yml` (always wins; throws on invalid YAML).
 *   2. Otherwise, zero-config detection of the DS package from package.json.
 *   3. Otherwise null (caller shows guidance).
 *
 * Either way, a generated `.polder.profile.yml` (from `polder-drift profile`) is
 * loaded as an UNDERLAY for the custom-detection keys: it fills in what the config
 * doesn't set, and `.polder.yml` entries win on conflict.
 */
import * as fs from 'fs';
import * as path from 'path';
import { readConfig, parseProfileFile, type PolderConfig } from './config';
import { mergeCustomDetection, type CustomDetection } from './profiles';
import { detectComponentLibrary } from './detect';

export const PROFILE_FILENAME = '.polder.profile.yml';

export interface ResolvedConfig {
  config: PolderConfig;
  source: 'file' | 'detected';
}

export function resolveConfig(cwd: string, configPath: string): ResolvedConfig | null {
  let content: string | null = null;
  try {
    content = fs.readFileSync(configPath, 'utf8');
  } catch {
    /* no file — fall through to detection */
  }

  let resolved: ResolvedConfig | null = null;
  if (content !== null) {
    const config = readConfig(content); // throws on invalid YAML; null only for empty
    resolved = config ? { config, source: 'file' } : null;
  } else {
    const det = detectComponentLibrary(cwd);
    if (det.libraries.length > 0) {
      resolved = { config: { componentLibrary: det.libraries, allowlist: [], failOnDrift: false }, source: 'detected' };
    }
  }
  if (!resolved) return null;

  const generated = loadGeneratedProfile(cwd); // throws on invalid YAML — a corrupt file must not be silently skipped
  if (generated) {
    const c = resolved.config;
    const explicit: CustomDetection = {
      tokens: c.tokens,
      classPrefixes: c.classPrefixes,
      propSignatures: c.propSignatures,
      subComponents: c.subComponents,
      nameSegments: c.nameSegments,
    };
    Object.assign(c, mergeCustomDetection(generated, explicit));
  }
  return resolved;
}

function loadGeneratedProfile(cwd: string): CustomDetection | null {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(cwd, PROFILE_FILENAME), 'utf8');
  } catch {
    return null; // no generated profile — the common case
  }
  return parseProfileFile(raw);
}
