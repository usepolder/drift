/**
 * Zero-config: detect the design-system package from package.json so a `.polder.yml`
 * is not required in the common case. Explicit config always wins (see resolve-config).
 */
import * as fs from 'fs';
import * as path from 'path';

/** Curated, well-known design-system packages, matched against deps/peerDeps. */
export const KNOWN_DS_PACKAGES = [
  '@carbon/react',
  '@mui/material',
  '@chakra-ui/react',
  '@mantine/core',
  'antd',
  '@fluentui/react',
  '@fluentui/react-components',
  '@shopify/polaris',
  'react-bootstrap',
  '@primer/react',
  '@adobe/react-spectrum',
  '@radix-ui/themes',
  '@nextui-org/react',
  '@heroui/react',
  'grommet',
];

export interface Detection {
  libraries: string[];
  source: 'detected' | 'none';
}

export function detectComponentLibrary(cwd: string, known: string[] = KNOWN_DS_PACKAGES): Detection {
  let pkg: { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  } catch {
    return { libraries: [], source: 'none' };
  }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
  const libraries = known.filter((k) => k in deps);
  return libraries.length > 0 ? { libraries, source: 'detected' } : { libraries: [], source: 'none' };
}
