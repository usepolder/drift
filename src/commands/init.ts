/**
 * `polder-drift init` — write a starter `.polder.yml`, seeded from detection when possible.
 */
import * as fs from 'fs';
import * as path from 'path';
import { detectComponentLibrary } from '../detect';

export function runInitSubcommand(_argv: string[], cwd: string = process.cwd()): number {
  const target = path.join(cwd, '.polder.yml');
  if (fs.existsSync(target)) {
    process.stderr.write('polder-drift init: .polder.yml already exists; leaving it untouched.\n');
    return 1;
  }

  const det = detectComponentLibrary(cwd);
  const libs = det.libraries.length > 0 ? det.libraries : ['@your-org/design-system'];

  const libYaml =
    libs.length === 1
      ? `component_library: "${libs[0]}"`
      : `component_library:\n${libs.map((l) => `  - "${l}"`).join('\n')}`;
  const content = `${libYaml}\nallowlist: []\nfail_on_drift: false\n`;

  fs.writeFileSync(target, content);
  if (det.source === 'detected') {
    process.stdout.write(`polder-drift init: wrote .polder.yml (detected ${libs.join(', ')}).\n`);
  } else {
    process.stdout.write('polder-drift init: wrote .polder.yml — edit component_library to your design system package.\n');
  }
  return 0;
}
