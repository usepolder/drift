import * as fs from 'fs';
import * as path from 'path';
import { parse, type ParserOptions } from '@babel/parser';
import type { ImportDeclaration, Identifier } from '@babel/types';

const BABEL_OPTIONS: ParserOptions = {
  plugins: ['typescript', 'jsx'],
  sourceType: 'module',
  errorRecovery: true,
};

// Matches `export * from './path'` and `export { X } from './path'`
const REEXPORT_RE = /export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;

function extractNames(dts: string, names: Set<string>): void {
  let m: RegExpExecArray | null;

  // export [declare] function|class|const|enum|interface|type Name
  const declRe =
    /\bexport\s+(?:declare\s+)?(?:function|class|const|enum|interface|type)\s+([a-zA-Z][a-zA-Z0-9_]*)/g;
  while ((m = declRe.exec(dts)) !== null) {
    names.add(m[1]);
  }

  // export [type] { A, B as C, type D } — walk every specifier
  const blockRe = /\bexport\s+(?:type\s*)?\{([^}]+)\}/g;
  while ((m = blockRe.exec(dts)) !== null) {
    const block = m[1];
    // Each specifier: [type] localName [as exportedName]
    const specRe =
      /(?:^|,)\s*(?:type\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)(?:\s+as\s+([a-zA-Z_$][a-zA-Z0-9_$]*))?/g;
    let spec: RegExpExecArray | null;
    while ((spec = specRe.exec(block)) !== null) {
      const exported = spec[2] ?? spec[1];
      if (exported && exported !== 'type' && exported !== 'default') {
        names.add(exported);
      }
    }
  }
}

function resolveFile(filePath: string): string | null {
  for (const candidate of [filePath, `${filePath}.d.ts`, `${filePath}/index.d.ts`]) {
    try { return fs.readFileSync(candidate, 'utf8'); } catch { /* try next */ }
  }
  return null;
}

export function resolveExports(pkgName: string, nodeModulesDir: string): Set<string> {
  const names = new Set<string>();
  try {
    const pkgJsonPath = path.join(nodeModulesDir, pkgName, 'package.json');
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as {
      types?: string;
      typings?: string;
      main?: string;
    };

    // When the package has no types entry but ships one .d.ts per export (e.g.
    // @carbon/icons-react), collect names from .d.ts filenames in the lib/ dir.
    if (!pkgJson.types && !pkgJson.typings) {
      const candidates = ['lib', 'es', 'dist', '.'];
      for (const dir of candidates) {
        const dirPath = path.join(nodeModulesDir, pkgName, dir);
        try {
          for (const f of fs.readdirSync(dirPath)) {
            if (f.endsWith('.d.ts') && f !== 'index.d.ts') {
              names.add(f.slice(0, -'.d.ts'.length));
            }
          }
          if (names.size > 0) break;
        } catch { /* dir not found, try next */ }
      }
      return names;
    }

    const typesEntry = pkgJson.types ?? pkgJson.typings ?? 'index.d.ts';
    const rootDtsPath = path.join(nodeModulesDir, pkgName, typesEntry);
    const rootDir = path.dirname(rootDtsPath);

    // BFS over export * chains — queue holds absolute paths already resolved to .d.ts
    const visited = new Set<string>();
    const queue: string[] = [rootDtsPath];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const dts = resolveFile(current);
      if (!dts) continue;

      extractNames(dts, names);

      // Follow `export * from '...'` and `export { X } from '...'`
      REEXPORT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = REEXPORT_RE.exec(dts)) !== null) {
        const specifier = m[1];
        if (!specifier.startsWith('.')) continue; // skip non-relative (already in names)
        const resolved = path.resolve(path.dirname(current), specifier);
        queue.push(resolved);
      }
    }
  } catch {
    // node_modules not present or .d.ts missing/malformed — caller handles warning
  }
  return names;
}

export function isComponentFile(content: string): boolean {
  if (/<[A-Z][a-zA-Z]*[\s/>]/.test(content)) return true;
  if (/export\s+(?:default\s+)?(?:function|const)\s+([A-Z][a-zA-Z]*)/.test(content)) return true;
  return false;
}

export interface DriftResult {
  file: string;
  driftCount: number;
  driftedSymbols: string[];
}

export function checkDrift(
  fileContent: string,
  dsExports: Set<string>,
  canonicalPkgs: string[],
  allowlist: string[],
  filename?: string,
): { driftCount: number; driftedSymbols: string[] } {
  const isTsx = filename?.endsWith('.tsx') ?? false;
  if (!isTsx && !isComponentFile(fileContent)) {
    return { driftCount: 0, driftedSymbols: [] };
  }

  let ast;
  try {
    ast = parse(fileContent, BABEL_OPTIONS);
  } catch {
    // @babel/parser couldn't parse this file even with errorRecovery
    return { driftCount: 0, driftedSymbols: [] };
  }

  const driftedSymbols: string[] = [];

  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const decl = node as ImportDeclaration;
    const source = decl.source.value;

    // Not drift: canonical package
    if (canonicalPkgs.some((pkg) => source === pkg)) continue;

    // Not drift: allowlisted path
    if (allowlist.some((allowed) => source.startsWith(allowed))) continue;

    // Not drift: third-party package (not relative, not a path alias starting with #)
    // Only check relative paths (./ ../) and internal path aliases (#...)
    const isLocalOrAlias =
      source.startsWith('./') ||
      source.startsWith('../') ||
      source.startsWith('#') ||
      source.startsWith('/');
    if (!isLocalOrAlias) continue;

    // Check if any imported specifier matches a DS export
    for (const specifier of decl.specifiers) {
      if (
        specifier.type === 'ImportSpecifier' ||
        specifier.type === 'ImportDefaultSpecifier'
      ) {
        const localName =
          specifier.type === 'ImportSpecifier'
            ? (specifier.imported.type === 'Identifier'
                ? specifier.imported.name
                : specifier.imported.value)
            : specifier.local.name;

        if (dsExports.size > 0 && dsExports.has(localName)) {
          driftedSymbols.push(`${localName} from '${source}'`);
        } else if (dsExports.size === 0) {
          // Fallback: no DS exports resolved — use path-only heuristic
          // Only flag PascalCase symbols (likely components)
          if (/^[A-Z]/.test(localName)) {
            driftedSymbols.push(`${localName} from '${source}'`);
          }
        }
      }
    }
  }

  return { driftCount: driftedSymbols.length, driftedSymbols };
}

/**
 * Count "correct" DS usage: import specifiers pulled from a canonical package whose
 * symbol is a known DS export. Paired with the drift count, this yields an adoption
 * ratio (canonical / (canonical + drift)). When DS exports could not be resolved,
 * counts any specifier imported from a canonical package (best effort).
 */
export function countCanonicalUsages(
  fileContent: string,
  dsExports: Set<string>,
  canonicalPkgs: string[],
): number {
  let ast;
  try {
    ast = parse(fileContent, BABEL_OPTIONS);
  } catch {
    return 0;
  }

  let count = 0;
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const decl = node as ImportDeclaration;
    if (!canonicalPkgs.some((pkg) => decl.source.value === pkg)) continue;

    for (const specifier of decl.specifiers) {
      if (specifier.type === 'ImportSpecifier' || specifier.type === 'ImportDefaultSpecifier') {
        const localName =
          specifier.type === 'ImportSpecifier'
            ? specifier.imported.type === 'Identifier'
              ? specifier.imported.name
              : specifier.imported.value
            : specifier.local.name;
        if (dsExports.size === 0 || dsExports.has(localName)) count++;
      }
    }
  }
  return count;
}

// ── Phase 2: inline drift ─────────────────────────────────────────────────────

// Carbon Design System v11 (White theme) — high-specificity hex tokens.
// Values common to any UI (#fff, #ccc, generic grays) are intentionally omitted
// to keep the false-positive rate low.
export const CARBON_TOKENS: Record<string, string> = {
  '#0f62fe': 'interactive / blue-60',
  '#0043ce': 'interactive-02 / blue-70',
  '#002d9c': 'interactive-03 / blue-80',
  '#161616': 'text-primary / gray-100',
  '#da1e28': 'support-error / red-60',
  '#198038': 'support-success / green-50',
  '#24a148': 'support-success-hover / green-40',
  '#f1c21b': 'support-warning / yellow-30',
  '#ff832b': 'support-caution / orange-40',
  '#ba4e00': 'support-caution-dark / orange-70',
  '#4589ff': 'interactive-hover / blue-40',
  '#007d79': 'teal-60',
  '#08bdba': 'teal-40',
  '#6929c4': 'purple-70',
};

// Material UI v5 default theme palette — high-specificity values only.
export const MUI_TOKENS: Record<string, string> = {
  '#1976d2': 'primary.main',
  '#1565c0': 'primary.dark',
  '#42a5f5': 'primary.light',
  '#d32f2f': 'error.main',
  '#c62828': 'error.dark',
  '#ef5350': 'error.light',
  '#2e7d32': 'success.main',
  '#388e3c': 'success.light',
  '#1b5e20': 'success.dark',
  '#ed6c02': 'warning.main',
  '#e65100': 'warning.dark',
  '#ff9800': 'warning.light',
  '#0288d1': 'info.main',
  '#01579b': 'info.dark',
  '#29b6f6': 'info.light',
};

const HEX_COLOR_RE = /#[0-9a-fA-F]{6}\b/g;
const CDS_CLASS_RE = /\bcds--[a-z][a-z0-9-]*/g;
const MUI_CLASS_RE = /\bMui[A-Z][a-zA-Z]+-[a-z][a-zA-Z0-9-]*/g;

export interface TokenFingerprint {
  componentName: string;
  tokens: string[];     // Carbon hex values found in the function body
  classNames: string[]; // cds-- class names found in the function body
}

// ── Phase 4: sub-component usage + name-contains ─────────────────────────────

/**
 * DS sub-components that only make sense inside their parent component.
 * Using one inside a locally-defined function body — without also using the
 * real parent DS element — is a strong signal the component reimplements
 * the parent from scratch.
 *
 * Key: JSX element name   →   Value: canonical DS parent name
 */
export const DS_SUBCOMPONENT_MAP: Record<string, string> = {
  // MUI — Card family
  CardMedia:                'MuiCard',
  CardContent:              'MuiCard',
  CardHeader:               'MuiCard',
  CardActions:              'MuiCard',
  // MUI — Dialog family
  DialogTitle:              'MuiDialog',
  DialogContent:            'MuiDialog',
  DialogActions:            'MuiDialog',
  DialogContentText:        'MuiDialog',
  // MUI — Accordion family
  AccordionSummary:         'MuiAccordion',
  AccordionDetails:         'MuiAccordion',
  // MUI — List family
  ListItemText:             'MuiList',
  ListItemIcon:             'MuiList',
  ListItemSecondaryAction:  'MuiList',
  ListSubheader:            'MuiList',
  // MUI — Stepper family
  StepLabel:                'MuiStepper',
  StepContent:              'MuiStepper',
  StepIcon:                 'MuiStepper',
  // MUI — Table family
  TableHead:                'MuiTable',
  TableBody:                'MuiTable',
  TableRow:                 'MuiTable',
  TableCell:                'MuiTable',
  TableFooter:              'MuiTable',
  TablePagination:          'MuiTable',
  // MUI — misc
  ImageListItem:            'MuiImageList',
  ImageListItemBar:         'MuiImageList',
  PaginationItem:           'MuiPagination',
  SpeedDialAction:          'MuiSpeedDial',
  BottomNavigationAction:   'MuiBottomNavigation',
  TreeItem:                 'MuiTreeView',
  TimelineItem:             'MuiTimeline',
  TimelineDot:              'MuiTimeline',
  TimelineContent:          'MuiTimeline',
  TimelineConnector:        'MuiTimeline',
  TimelineSeparator:        'MuiTimeline',
  // Carbon — Modal family
  ModalBody:                'Modal',
  ModalHeader:              'Modal',
  ModalFooter:              'Modal',
  // Carbon — DataTable family
  TableToolbar:             'DataTable',
  TableToolbarContent:      'DataTable',
  TableToolbarSearch:       'DataTable',
  TableBatchActions:        'DataTable',
  TableSelectAll:           'DataTable',
  TableSelectRow:           'DataTable',
  TableExpandRow:           'DataTable',
  TableExpandedRow:         'DataTable',
  TableExpandHeader:        'DataTable',
  TableContainer:           'DataTable',
  // Carbon — Header family
  HeaderName:               'Header',
  HeaderNavigation:         'Header',
  HeaderMenuItem:           'Header',
  HeaderGlobalBar:          'Header',
  // Carbon — SideNav family
  SideNavItems:             'SideNav',
  SideNavMenu:              'SideNav',
  SideNavMenuItem:          'SideNav',
  SideNavLink:              'SideNav',
  // Carbon — misc
  BreadcrumbItem:           'Breadcrumb',
  ProgressStep:             'ProgressIndicator',
  ContentSwitcherSwitch:    'ContentSwitcher',
  TabList:                  'Tabs',
  TabPanels:                'Tabs',
  TabPanel:                 'Tabs',
  NotificationActionButton: 'ActionableNotification',
};

/**
 * PascalCase word segments → canonical DS parent name.
 * Conservative: only words distinctive enough to reduce false-positive risk.
 * Generic words (Button, Input, Text, Icon, List…) are deliberately excluded.
 */
export const DS_NAME_SEGMENTS: Record<string, string> = {
  // MUI
  Card:         'MuiCard',
  Slider:       'MuiSlider',
  Rating:       'MuiRating',
  Chip:         'MuiChip',
  Badge:        'MuiBadge',
  Dialog:       'MuiDialog',
  Accordion:    'MuiAccordion',
  Drawer:       'MuiDrawer',
  Pagination:   'MuiPagination',
  Snackbar:     'MuiSnackbar',
  Skeleton:     'MuiSkeleton',
  Stepper:      'MuiStepper',
  Tooltip:      'MuiTooltip',
  Breadcrumbs:  'MuiBreadcrumbs',
  // Carbon
  Tag:          'Tag',
  Tile:         'Tile',
  Dropdown:     'Dropdown',
};

export interface SubComponentMatch {
  componentName: string;
  matchedDs: string;
  subComponentsUsed: string[];    // e.g. ['CardMedia']
  nameSegment: string | undefined; // PascalCase word that matched, e.g. 'Card'
  confidence: 'high' | 'medium';  // high = sub-component + name; medium = sub-component only
}

// ── Phase 3: prop-signature matching ─────────────────────────────────────────

// Key props for each Carbon component. Only include props that are
// distinctive — broad enough to catch forks, tight enough to avoid
// false positives on unrelated components that share a common prop name.
export const DS_PROP_SIGNATURES: Record<string, string[]> = {
  Button:              ['kind', 'size', 'disabled', 'renderIcon', 'iconDescription'],
  IconButton:          ['label', 'kind', 'size', 'onClick', 'disabled'],
  Tag:                 ['type', 'filter', 'onClose', 'size'],
  Tile:                ['light', 'href', 'clicked'],
  Modal:               ['open', 'onRequestClose', 'modalHeading', 'primaryButtonText', 'secondaryButtonText'],
  TextInput:           ['id', 'labelText', 'value', 'onChange', 'placeholder', 'invalid', 'invalidText'],
  NumberInput:         ['value', 'onChange', 'min', 'max', 'step', 'label', 'invalidText'],
  Select:              ['id', 'labelText', 'value', 'onChange', 'disabled'],
  Dropdown:            ['id', 'label', 'items', 'onChange', 'selectedItem'],
  Checkbox:            ['id', 'labelText', 'checked', 'onChange', 'disabled', 'indeterminate'],
  Toggle:              ['id', 'labelText', 'toggled', 'onToggle', 'disabled'],
  InlineNotification:  ['kind', 'title', 'subtitle', 'onCloseButtonClick', 'actions', 'lowContrast'],
  OverflowMenu:        ['flipped', 'renderIcon', 'iconDescription', 'selectorPrimaryFocus'],
  ProgressBar:         ['value', 'max', 'label', 'status'],
  DataTable:           ['rows', 'headers', 'render'],
  // Material UI
  MuiSlider:           ['value', 'onChange', 'min', 'max', 'step', 'marks', 'valueLabelDisplay', 'disabled'],
  MuiRating:           ['value', 'onChange', 'precision', 'max', 'size', 'readOnly', 'disabled'],
  MuiChip:             ['label', 'onDelete', 'color', 'size', 'variant', 'icon', 'disabled'],
  MuiBadge:            ['badgeContent', 'color', 'overlap', 'anchorOrigin', 'invisible', 'max'],
  MuiSelect:           ['value', 'onChange', 'label', 'multiple', 'renderValue', 'disabled'],
};

export interface PropMatch {
  componentName: string;     // local component (e.g. 'StepperInput')
  matchedDs: string;         // DS component it resembles (e.g. 'NumberInput')
  matchedProps: string[];    // overlapping prop names
  score: number;             // matched / dsSignature.length  (0–1)
}

export interface InlineDriftResult {
  localShadows: string[];
  tokenFingerprints: TokenFingerprint[];
  propMatches: PropMatch[];
  subComponentMatches: SubComponentMatch[];
}

function nodeRange(n: { start?: number | null; end?: number | null }): [number, number] | null {
  if (n.start == null || n.end == null) return null;
  return [n.start, n.end];
}

function scanBodyForTokens(bodyText: string): { tokens: string[]; classNames: string[] } {
  const tokens: string[] = [];
  const classNames: string[] = [];

  HEX_COLOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEX_COLOR_RE.exec(bodyText)) !== null) {
    const hex = m[0].toLowerCase();
    if ((CARBON_TOKENS[hex] || MUI_TOKENS[hex]) && !tokens.includes(hex)) tokens.push(hex);
  }

  CDS_CLASS_RE.lastIndex = 0;
  while ((m = CDS_CLASS_RE.exec(bodyText)) !== null) {
    if (!classNames.includes(m[0])) classNames.push(m[0]);
  }

  MUI_CLASS_RE.lastIndex = 0;
  while ((m = MUI_CLASS_RE.exec(bodyText)) !== null) {
    if (!classNames.includes(m[0])) classNames.push(m[0]);
  }

  return { tokens, classNames };
}

function extractPropNames(params: readonly unknown[]): string[] {
  if (params.length === 0) return [];
  const first = params[0] as { type: string; properties?: unknown[] };
  if (first.type !== 'ObjectPattern' || !first.properties) return [];
  const names: string[] = [];
  for (const prop of first.properties) {
    const p = prop as { type: string; key?: { type: string; name?: string } };
    if (p.type === 'ObjectProperty' && p.key?.type === 'Identifier' && p.key.name) {
      names.push(p.key.name);
    }
  }
  return names;
}

const PROP_MATCH_THRESHOLD = 0.6;
const PROP_MATCH_MIN_OVERLAP = 2;

function findPropMatch(localProps: string[]): PropMatch | null {
  if (localProps.length === 0) return null;
  const localSet = new Set(localProps);
  let best: PropMatch | null = null;
  for (const [dsName, dsProps] of Object.entries(DS_PROP_SIGNATURES)) {
    const matched = dsProps.filter(p => localSet.has(p));
    const score = matched.length / dsProps.length;
    if (
      score >= PROP_MATCH_THRESHOLD &&
      matched.length >= PROP_MATCH_MIN_OVERLAP &&
      (best === null || score > best.score)
    ) {
      best = { componentName: '', matchedDs: dsName, matchedProps: matched, score };
    }
  }
  return best;
}

// ── Phase 4 helpers ───────────────────────────────────────────────────────────

const JSX_ELEMENT_RE = /<([A-Z][a-zA-Z0-9]*)[\s/>]/g;

function extractJsxElements(bodyText: string): string[] {
  const names: string[] = [];
  JSX_ELEMENT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JSX_ELEMENT_RE.exec(bodyText)) !== null) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

/** Split 'SimpleProductCard' → ['Simple', 'Product', 'Card'] */
function splitPascal(name: string): string[] {
  return name.match(/[A-Z][a-z0-9]*/g) ?? [];
}

function findSubComponentMatch(
  componentName: string,
  bodyText: string,
): SubComponentMatch | null {
  const jsxElements = extractJsxElements(bodyText);
  const jsxSet = new Set(jsxElements);

  // Collect sub-component usages. If the real parent element is also present
  // in the body (e.g. <Card> wrapping <CardMedia>), that's legitimate composition
  // — skip it. Only flag when sub-components appear without their parent.
  const parentUsages = new Map<string, string[]>();
  for (const el of jsxElements) {
    const parent = DS_SUBCOMPONENT_MAP[el];
    if (!parent) continue;
    const parentElement = parent.startsWith('Mui') ? parent.slice(3) : parent;
    if (jsxSet.has(parentElement)) continue; // real parent present — not a reimplementation
    if (!parentUsages.has(parent)) parentUsages.set(parent, []);
    parentUsages.get(parent)!.push(el);
  }

  if (parentUsages.size === 0) return null;

  // Name-contains: check each PascalCase word segment against DS_NAME_SEGMENTS
  const words = splitPascal(componentName);
  const nameHit = words
    .map(w => ({ word: w, ds: DS_NAME_SEGMENTS[w] }))
    .find(({ ds }) => ds !== undefined);

  // Pick best match: prefer parent with both signals, then most sub-components
  let best: SubComponentMatch | null = null;
  for (const [parent, subComps] of parentUsages) {
    const nameSegment = nameHit?.ds === parent ? nameHit.word : undefined;
    const confidence: 'high' | 'medium' = nameSegment ? 'high' : 'medium';
    if (
      !best ||
      (confidence === 'high' && best.confidence !== 'high') ||
      (confidence === best.confidence && subComps.length > best.subComponentsUsed.length)
    ) {
      best = { componentName, matchedDs: parent, subComponentsUsed: subComps, nameSegment, confidence };
    }
  }

  return best;
}

export function checkInlineDrift(
  fileContent: string,
  dsExports: Set<string>,
  filename?: string,
): InlineDriftResult {
  const isTsx = filename?.endsWith('.tsx') ?? false;
  if (!isTsx && !isComponentFile(fileContent)) {
    return { localShadows: [], tokenFingerprints: [], propMatches: [], subComponentMatches: [] };
  }

  let ast;
  try {
    ast = parse(fileContent, BABEL_OPTIONS);
  } catch {
    return { localShadows: [], tokenFingerprints: [], propMatches: [], subComponentMatches: [] };
  }

  const localShadows: string[] = [];
  const tokenFingerprints: TokenFingerprint[] = [];
  const propMatches: PropMatch[] = [];
  const subComponentMatches: SubComponentMatch[] = [];

  for (const topNode of ast.program.body) {
    // Unwrap `export function Foo` / `export const Foo = ...`
    const node =
      topNode.type === 'ExportNamedDeclaration' && topNode.declaration
        ? topNode.declaration
        : topNode;

    let componentName: string | null = null;
    let bodyRange: [number, number] | null = null;
    let funcParams: readonly unknown[] = [];

    if (node.type === 'FunctionDeclaration' && node.id && /^[A-Z]/.test(node.id.name)) {
      componentName = node.id.name;
      bodyRange = nodeRange(node.body);
      funcParams = node.params;
    } else if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        if (decl.id.type !== 'Identifier') continue;
        const name = (decl.id as Identifier).name;
        if (!/^[A-Z]/.test(name) || !decl.init) continue;
        const init = decl.init;
        if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
          componentName = name;
          bodyRange = nodeRange(init.body);
          funcParams = init.params;
        }
      }
    }

    if (!componentName) continue;

    // Signal 1: name shadows a DS export
    if (dsExports.size > 0 && dsExports.has(componentName)) {
      localShadows.push(componentName);
    }

    // Signal 2: function body contains Carbon token values or cds-- class names
    if (bodyRange) {
      const bodyText = fileContent.slice(bodyRange[0], bodyRange[1]);
      const { tokens, classNames } = scanBodyForTokens(bodyText);
      if (tokens.length > 0 || classNames.length > 0) {
        tokenFingerprints.push({ componentName, tokens, classNames });
      }
    }

    // Signal 3: prop signature matches a DS component's known API
    const localProps = extractPropNames(funcParams);
    const match = findPropMatch(localProps);
    if (match) {
      propMatches.push({ ...match, componentName });
    }

    // Signal 4: sub-component usage (without real parent) + name-contains
    if (bodyRange) {
      const bodyText = fileContent.slice(bodyRange[0], bodyRange[1]);
      const subMatch = findSubComponentMatch(componentName, bodyText);
      if (subMatch) {
        subComponentMatches.push(subMatch);
      }
    }
  }

  return { localShadows, tokenFingerprints, propMatches, subComponentMatches };
}

// ── Combined result ───────────────────────────────────────────────────────────

export interface FullDriftResult {
  importDrift: { count: number; symbols: string[] };
  inlineDrift: InlineDriftResult;
  totalCount: number;
}

export function checkDriftFull(
  fileContent: string,
  dsExports: Set<string>,
  canonicalPkgs: string[],
  allowlist: string[],
  filename?: string,
): FullDriftResult {
  const { driftCount, driftedSymbols } = checkDrift(
    fileContent, dsExports, canonicalPkgs, allowlist, filename,
  );
  const inlineDrift = checkInlineDrift(fileContent, dsExports, filename);
  const inlineCount =
    inlineDrift.localShadows.length +
    inlineDrift.tokenFingerprints.length +
    inlineDrift.propMatches.length +
    inlineDrift.subComponentMatches.length;
  return {
    importDrift: { count: driftCount, symbols: driftedSymbols },
    inlineDrift,
    totalCount: driftCount + inlineCount,
  };
}
