import * as fs from 'fs';
import * as path from 'path';
import { parse, type ParserOptions } from '@babel/parser';
import type { ImportDeclaration, Identifier } from '@babel/types';
import {
  type DetectionProfile,
  CARBON_PROFILE,
  MUI_PROFILE,
  buildDetectionProfile,
  allBuiltinProfiles,
} from './profiles';

const BABEL_OPTIONS: ParserOptions = {
  plugins: ['typescript', 'jsx'],
  sourceType: 'module',
  errorRecovery: true,
};

type Ast = ReturnType<typeof parse>;

/** Parse once; null when @babel/parser can't parse even with errorRecovery. */
function parseSource(fileContent: string): Ast | null {
  try {
    return parse(fileContent, BABEL_OPTIONS);
  } catch {
    return null;
  }
}

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

export interface ImportDriftCheck {
  driftCount: number;
  driftedSymbols: string[];
  /** 1-based source line per drifted symbol, keyed by the entry in `driftedSymbols`. */
  lines: Record<string, number>;
}

export function checkDrift(
  fileContent: string,
  dsExports: Set<string>,
  canonicalPkgs: string[],
  allowlist: string[],
  filename?: string,
): ImportDriftCheck {
  const isTsx = filename?.endsWith('.tsx') ?? false;
  if (!isTsx && !isComponentFile(fileContent)) {
    return { driftCount: 0, driftedSymbols: [], lines: {} };
  }
  const ast = parseSource(fileContent);
  if (!ast) return { driftCount: 0, driftedSymbols: [], lines: {} };
  return checkDriftAst(ast, dsExports, canonicalPkgs, allowlist);
}

function checkDriftAst(
  ast: Ast,
  dsExports: Set<string>,
  canonicalPkgs: string[],
  allowlist: string[],
): ImportDriftCheck {
  const driftedSymbols: string[] = [];
  const lines: Record<string, number> = {};

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

        // Prefer the specifier's own line (multi-line import blocks), falling back
        // to the declaration's.
        const line = specifier.loc?.start.line ?? decl.loc?.start.line;
        if (dsExports.size > 0 && dsExports.has(localName)) {
          driftedSymbols.push(`${localName} from '${source}'`);
          if (line !== undefined) lines[`${localName} from '${source}'`] = line;
        } else if (dsExports.size === 0) {
          // Fallback: no DS exports resolved — use path-only heuristic
          // Only flag PascalCase symbols (likely components)
          if (/^[A-Z]/.test(localName)) {
            driftedSymbols.push(`${localName} from '${source}'`);
            if (line !== undefined) lines[`${localName} from '${source}'`] = line;
          }
        }
      }
    }
  }

  return { driftCount: driftedSymbols.length, driftedSymbols, lines };
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
  const ast = parseSource(fileContent);
  if (!ast) return 0;
  return countCanonicalUsagesAst(ast, dsExports, canonicalPkgs);
}

function countCanonicalUsagesAst(ast: Ast, dsExports: Set<string>, canonicalPkgs: string[]): number {
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
      } else if (specifier.type === 'ImportNamespaceSpecifier') {
        // `import * as DS from '@acme/ds'` is canonical usage of the package.
        count++;
      }
    }
  }
  return count;
}

// ── Phase 2: inline drift ─────────────────────────────────────────────────────

// The DS-specific data (tokens, class patterns, prop signatures, sub-component maps)
// lives in ./profiles. These merged views are kept for compatibility with existing
// importers; new code should build a DetectionProfile instead.
export const CARBON_TOKENS: Record<string, string> = CARBON_PROFILE.tokens;
export const MUI_TOKENS: Record<string, string> = MUI_PROFILE.tokens;

const HEX_COLOR_RE = /#[0-9a-fA-F]{6}\b/g;

export interface TokenFingerprint {
  componentName: string;
  tokens: string[];     // Carbon hex values found in the function body
  classNames: string[]; // cds-- class names found in the function body
}

// ── Phase 4: sub-component usage + name-contains ─────────────────────────────

/**
 * Merged compatibility views over the built-in profiles (see ./profiles for the
 * per-DS data and the semantics of each map).
 */
export const DS_SUBCOMPONENT_MAP: Record<string, string> = {
  ...CARBON_PROFILE.subComponentMap,
  ...MUI_PROFILE.subComponentMap,
};

export const DS_NAME_SEGMENTS: Record<string, string> = {
  ...CARBON_PROFILE.nameSegments,
  ...MUI_PROFILE.nameSegments,
};

export interface SubComponentMatch {
  componentName: string;
  matchedDs: string;
  subComponentsUsed: string[];    // e.g. ['CardMedia']
  nameSegment: string | undefined; // PascalCase word that matched, e.g. 'Card'
  confidence: 'high' | 'medium';  // high = sub-component + name; medium = sub-component only
}

// ── Phase 3: prop-signature matching ─────────────────────────────────────────

/** Merged compatibility view over the built-in profiles' prop signatures. */
export const DS_PROP_SIGNATURES: Record<string, string[]> = {
  ...CARBON_PROFILE.propSignatures,
  ...MUI_PROFILE.propSignatures,
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
  /**
   * 1-based definition line per top-level component seen in the file. Every inline
   * signal keys on the local component name, so one map locates all four.
   */
  componentLines: Record<string, number>;
}

function nodeRange(n: { start?: number | null; end?: number | null }): [number, number] | null {
  if (n.start == null || n.end == null) return null;
  return [n.start, n.end];
}

function scanBodyForTokens(
  bodyText: string,
  profile: DetectionProfile,
): { tokens: string[]; classNames: string[] } {
  const tokens: string[] = [];
  const classNames: string[] = [];

  HEX_COLOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEX_COLOR_RE.exec(bodyText)) !== null) {
    const hex = m[0].toLowerCase();
    if (profile.tokens[hex] && !tokens.includes(hex)) tokens.push(hex);
  }

  for (const classRe of profile.classPatterns) {
    classRe.lastIndex = 0; // shared /g regexes — reset between scans
    while ((m = classRe.exec(bodyText)) !== null) {
      if (!classNames.includes(m[0])) classNames.push(m[0]);
    }
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

function findPropMatch(localProps: string[], propSignatures: Record<string, string[]>): PropMatch | null {
  if (localProps.length === 0) return null;
  const localSet = new Set(localProps);
  let best: PropMatch | null = null;
  for (const [dsName, dsProps] of Object.entries(propSignatures)) {
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
  profile: DetectionProfile,
): SubComponentMatch | null {
  const jsxElements = extractJsxElements(bodyText);
  const jsxSet = new Set(jsxElements);

  // Collect sub-component usages. If the real parent element is also present
  // in the body (e.g. <Card> wrapping <CardMedia>), that's legitimate composition
  // — skip it. Only flag when sub-components appear without their parent.
  const parentUsages = new Map<string, string[]>();
  for (const el of jsxElements) {
    const parent = profile.subComponentMap[el];
    if (!parent) continue;
    const parentElement = parent.startsWith('Mui') ? parent.slice(3) : parent;
    if (jsxSet.has(parentElement)) continue; // real parent present — not a reimplementation
    if (!parentUsages.has(parent)) parentUsages.set(parent, []);
    parentUsages.get(parent)!.push(el);
  }

  if (parentUsages.size === 0) return null;

  // Name-contains: check each PascalCase word segment against the profile's segments
  const words = splitPascal(componentName);
  const nameHit = words
    .map(w => ({ word: w, ds: profile.nameSegments[w] }))
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
  profile?: DetectionProfile,
): InlineDriftResult {
  // Without a profile we can't know which DS the repo uses, so fall back to every
  // built-in. Callers that know the config should pass a profile (checkDriftFull does).
  const p = profile ?? allBuiltinProfiles();
  const isTsx = filename?.endsWith('.tsx') ?? false;
  if (!isTsx && !isComponentFile(fileContent)) {
    return emptyInlineDrift();
  }
  const ast = parseSource(fileContent);
  if (!ast) return emptyInlineDrift();
  return checkInlineDriftAst(ast, fileContent, dsExports, p);
}

function emptyInlineDrift(): InlineDriftResult {
  return { localShadows: [], tokenFingerprints: [], propMatches: [], subComponentMatches: [], componentLines: {} };
}

function checkInlineDriftAst(
  ast: Ast,
  fileContent: string,
  dsExports: Set<string>,
  p: DetectionProfile,
): InlineDriftResult {
  const localShadows: string[] = [];
  const tokenFingerprints: TokenFingerprint[] = [];
  const propMatches: PropMatch[] = [];
  const subComponentMatches: SubComponentMatch[] = [];
  const componentLines: Record<string, number> = {};

  for (const topNode of ast.program.body) {
    // Unwrap `export function Foo` / `export const Foo = ...`
    const node =
      topNode.type === 'ExportNamedDeclaration' && topNode.declaration
        ? topNode.declaration
        : topNode;

    let componentName: string | null = null;
    let bodyRange: [number, number] | null = null;
    let funcParams: readonly unknown[] = [];
    let definitionLine: number | undefined;

    if (node.type === 'FunctionDeclaration' && node.id && /^[A-Z]/.test(node.id.name)) {
      componentName = node.id.name;
      bodyRange = nodeRange(node.body);
      funcParams = node.params;
      definitionLine = node.loc?.start.line;
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
          definitionLine = decl.loc?.start.line;
        }
      }
    }

    if (!componentName) continue;
    if (definitionLine !== undefined) componentLines[componentName] = definitionLine;

    // Signal 1: name shadows a DS export
    if (dsExports.size > 0 && dsExports.has(componentName)) {
      localShadows.push(componentName);
    }

    // Signal 2: function body contains DS token values or DS class names
    if (bodyRange) {
      const bodyText = fileContent.slice(bodyRange[0], bodyRange[1]);
      const { tokens, classNames } = scanBodyForTokens(bodyText, p);
      if (tokens.length > 0 || classNames.length > 0) {
        tokenFingerprints.push({ componentName, tokens, classNames });
      }
    }

    // Signal 3: prop signature matches a DS component's known API
    const localProps = extractPropNames(funcParams);
    const match = findPropMatch(localProps, p.propSignatures);
    if (match) {
      propMatches.push({ ...match, componentName });
    }

    // Signal 4: sub-component usage (without real parent) + name-contains
    if (bodyRange) {
      const bodyText = fileContent.slice(bodyRange[0], bodyRange[1]);
      const subMatch = findSubComponentMatch(componentName, bodyText, p);
      if (subMatch) {
        subComponentMatches.push(subMatch);
      }
    }
  }

  return { localShadows, tokenFingerprints, propMatches, subComponentMatches, componentLines };
}

// ── Combined result ───────────────────────────────────────────────────────────

export interface FullDriftResult {
  importDrift: {
    count: number;
    symbols: string[];
    /** 1-based source line per entry in `symbols`. */
    lines: Record<string, number>;
  };
  inlineDrift: InlineDriftResult;
  totalCount: number;
}

const EMPTY_DRIFT_FULL = (): FullDriftResult => ({
  importDrift: { count: 0, symbols: [], lines: {} },
  inlineDrift: emptyInlineDrift(),
  totalCount: 0,
});

function combineDrift(importDrift: ImportDriftCheck, inlineDrift: InlineDriftResult): FullDriftResult {
  const inlineCount =
    inlineDrift.localShadows.length +
    inlineDrift.tokenFingerprints.length +
    inlineDrift.propMatches.length +
    inlineDrift.subComponentMatches.length;
  return {
    importDrift: {
      count: importDrift.driftCount,
      symbols: importDrift.driftedSymbols,
      lines: importDrift.lines,
    },
    inlineDrift,
    totalCount: importDrift.driftCount + inlineCount,
  };
}

export function checkDriftFull(
  fileContent: string,
  dsExports: Set<string>,
  canonicalPkgs: string[],
  allowlist: string[],
  filename?: string,
  profile?: DetectionProfile,
): FullDriftResult {
  // Parsing dominates the cost of a scan, so the file is parsed exactly once and the
  // same AST feeds both the import walk and the inline walk.
  const isTsx = filename?.endsWith('.tsx') ?? false;
  if (!isTsx && !isComponentFile(fileContent)) return EMPTY_DRIFT_FULL();
  const ast = parseSource(fileContent);
  if (!ast) return EMPTY_DRIFT_FULL();
  // Inline detection is DS-specific: only the profiles for the configured packages
  // apply (plus custom config data when the caller built the profile from config).
  const p = profile ?? buildDetectionProfile(canonicalPkgs);
  return combineDrift(
    checkDriftAst(ast, dsExports, canonicalPkgs, allowlist),
    checkInlineDriftAst(ast, fileContent, dsExports, p),
  );
}

export interface FileAnalysis {
  drift: FullDriftResult;
  /** Canonical DS usages in the file (see countCanonicalUsages). */
  canonicalUsages: number;
}

/**
 * Drift + canonical-usage count off a single parse. This is the entry point for the
 * CI comment path, which needs both per file (head and base versions) — calling
 * checkDriftFull and countCanonicalUsages separately would parse everything twice.
 */
export function analyzeFile(
  fileContent: string,
  dsExports: Set<string>,
  canonicalPkgs: string[],
  allowlist: string[],
  filename?: string,
  profile?: DetectionProfile,
): FileAnalysis {
  // No component prefilter before parsing: canonical usage counts in ANY source file
  // (a util importing from the DS package is adoption too), matching
  // countCanonicalUsages. The drift checks below keep their own prefilter.
  const ast = parseSource(fileContent);
  if (!ast) return { drift: EMPTY_DRIFT_FULL(), canonicalUsages: 0 };

  const canonicalUsages = countCanonicalUsagesAst(ast, dsExports, canonicalPkgs);
  const isTsx = filename?.endsWith('.tsx') ?? false;
  if (!isTsx && !isComponentFile(fileContent)) {
    return { drift: EMPTY_DRIFT_FULL(), canonicalUsages };
  }
  const p = profile ?? buildDetectionProfile(canonicalPkgs);
  const drift = combineDrift(
    checkDriftAst(ast, dsExports, canonicalPkgs, allowlist),
    checkInlineDriftAst(ast, fileContent, dsExports, p),
  );
  return { drift, canonicalUsages };
}
