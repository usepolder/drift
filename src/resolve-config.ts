/**
 * Resolve a PolderConfig for a run. Precedence:
 *   1. An explicit `.polder.yml` (always wins; throws on invalid YAML).
 *   2. Otherwise, zero-config detection of the DS package from package.json.
 *   3. Otherwise null (caller shows guidance).
 */
import * as fs from 'fs';
import { readConfig, type PolderConfig } from './config';
import { detectComponentLibrary } from './detect';

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

  if (content !== null) {
    const config = readConfig(content); // throws on invalid YAML; null only for empty
    return config ? { config, source: 'file' } : null;
  }

  const det = detectComponentLibrary(cwd);
  if (det.libraries.length > 0) {
    return { config: { componentLibrary: det.libraries, allowlist: [], failOnDrift: false }, source: 'detected' };
  }
  return null;
}
