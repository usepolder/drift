/**
 * Auto-derive custom-detection data (the `.polder.profile.yml` content) from a
 * design system's own source: prop signatures from component prop types, tokens from
 * named color constants, sub-component maps from compound naming, class prefixes
 * from repeated BEM-style literals.
 *
 * The whole design bends toward PRECISION: a generated entry can create findings on
 * every PR in the repo, so anything generic gets filtered out and the output is a
 * reviewable file, never invisible runtime magic. Better to emit nothing than noise.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parse, type ParserOptions } from '@babel/parser';
import type { CustomDetection } from './profiles';

const BABEL_OPTIONS: ParserOptions = {
  plugins: ['typescript', 'jsx'],
  sourceType: 'module',
  errorRecovery: true,
};

// ── Anti-noise vocabularies ───────────────────────────────────────────────────

// Never included in a signature: present on virtually every React component.
const UBIQUITOUS_PROPS = new Set([
  'children', 'className', 'style', 'key', 'ref', 'as', 'sx', 'css', 'id',
  'role', 'tabIndex', 'dangerouslySetInnerHTML', 'testId', 'dataTestId',
]);

// Allowed in a signature but too common to count as distinctive on their own.
const COMMON_PROPS = new Set([
  'onClick', 'onChange', 'onClose', 'onOpen', 'onFocus', 'onBlur', 'onSubmit',
  'value', 'defaultValue', 'checked', 'disabled', 'readOnly', 'required', 'loading',
  'size', 'name', 'type', 'title', 'label', 'placeholder', 'href', 'target',
  'src', 'alt', 'open', 'variant', 'color', 'width', 'height', 'active', 'selected',
]);

// Component-name words too generic to key the name-segment confidence boost on
// (a local `ButtonGroup` must not be suspect on its name alone).
const GENERIC_NAME_WORDS = new Set([
  'Button', 'Input', 'Text', 'Icon', 'List', 'Link', 'Box', 'Grid', 'Stack',
  'Container', 'Item', 'View', 'Row', 'Col', 'Column', 'Label', 'Form', 'Field',
  'Group', 'Header', 'Footer', 'Page', 'App', 'Nav', 'Menu', 'Image', 'Wrapper',
  'Section', 'Content', 'Title', 'Layout', 'Base', 'Root',
]);

// Suffixes that mark a "part of a parent" component (CardHeader, DialogActions…).
// A name-prefix pair only becomes a sub-component mapping when the remainder is one
// of these — so ButtonGroup is NOT treated as a part of Button.
const PART_SUFFIXES = new Set([
  'Header', 'Footer', 'Body', 'Content', 'Title', 'Subtitle', 'Actions', 'Action',
  'Media', 'Summary', 'Details', 'Description', 'Text', 'Icon', 'Item', 'Items',
  'Cell', 'Panel', 'Panels', 'Trigger', 'Indicator', 'Thumb', 'Track', 'Overlay',
  'Portal', 'Anchor', 'Separator', 'Divider', 'Dot', 'Connector', 'Toolbar', 'Caption',
]);

const SIGNATURE_MAX_PROPS = 8;
const SIGNATURE_MIN_DISTINCTIVE = 2;
const SIGNATURE_MIN_TOTAL = 3;
const CLASS_PREFIX_MIN_OCCURRENCES = 3;
const MAX_TOKENS = 64;
const MAX_FILES = 3000;

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage',
  '__tests__', '__mocks__', '__snapshots__', 'storybook-static',
]);
const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx)$/;
const NON_COMPONENT_FILE_RE = /\.(test|spec|stories)\.|\.stories\./;

// ── File collection ───────────────────────────────────────────────────────────

export function collectSourceFiles(pkgDir: string): string[] {
  const files: string[] = [];
  const stack = [pkgDir];
  while (stack.length > 0 && files.length < MAX_FILES) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push(p);
      } else if (e.isFile() && SOURCE_FILE_RE.test(e.name) && !NON_COMPONENT_FILE_RE.test(e.name)) {
        files.push(p);
      }
    }
  }
  return files.sort();
}

// ── Per-file extraction ───────────────────────────────────────────────────────

interface FileFacts {
  /** Type/interface name → member (prop) names, e.g. ButtonProps → [kind, size]. */
  typeMembers: Map<string, string[]>;
  /** Component name → { destructured props, declared props-type name }. */
  components: Map<string, { destructured: string[]; propsTypeName?: string }>;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- walking loosely-typed Babel nodes */
type Node = any;

function typeLiteralMembers(typeNode: Node): string[] {
  if (!typeNode || typeNode.type !== 'TSTypeLiteral') return [];
  const names: string[] = [];
  for (const m of typeNode.members ?? []) {
    if ((m.type === 'TSPropertySignature' || m.type === 'TSMethodSignature') && m.key?.type === 'Identifier') {
      names.push(m.key.name);
    }
  }
  return names;
}

function interfaceMembers(node: Node): string[] {
  const names: string[] = [];
  for (const m of node.body?.body ?? []) {
    if ((m.type === 'TSPropertySignature' || m.type === 'TSMethodSignature') && m.key?.type === 'Identifier') {
      names.push(m.key.name);
    }
  }
  return names;
}

function paramFacts(params: Node[]): { destructured: string[]; propsTypeName?: string } {
  const out: { destructured: string[]; propsTypeName?: string } = { destructured: [] };
  const first = params?.[0];
  if (!first) return out;
  if (first.type === 'ObjectPattern') {
    for (const prop of first.properties ?? []) {
      if (prop.type === 'ObjectProperty' && prop.key?.type === 'Identifier') {
        out.destructured.push(prop.key.name);
      }
    }
  }
  const ann = first.typeAnnotation?.typeAnnotation;
  if (ann?.type === 'TSTypeReference' && ann.typeName?.type === 'Identifier') {
    out.propsTypeName = ann.typeName.name;
  }
  return out;
}

/** Declared props type from a `const X: React.FC<XProps>` style annotation. */
function fcPropsTypeName(declarator: Node): string | undefined {
  const ann = declarator.id?.typeAnnotation?.typeAnnotation;
  if (ann?.type !== 'TSTypeReference') return undefined;
  const name =
    ann.typeName?.type === 'Identifier'
      ? ann.typeName.name
      : ann.typeName?.type === 'TSQualifiedName'
        ? ann.typeName.right?.name
        : undefined;
  if (name !== 'FC' && name !== 'FunctionComponent' && name !== 'VFC') return undefined;
  const arg = ann.typeParameters?.params?.[0];
  if (arg?.type === 'TSTypeReference' && arg.typeName?.type === 'Identifier') return arg.typeName.name;
  return undefined;
}

export function extractFileFacts(content: string): FileFacts {
  const facts: FileFacts = { typeMembers: new Map(), components: new Map() };
  let ast;
  try {
    ast = parse(content, BABEL_OPTIONS);
  } catch {
    return facts;
  }

  for (const top of ast.program.body as Node[]) {
    const node = (top.type === 'ExportNamedDeclaration' || top.type === 'ExportDefaultDeclaration') && top.declaration
      ? top.declaration
      : top;

    if (node.type === 'TSInterfaceDeclaration' && node.id?.name) {
      facts.typeMembers.set(node.id.name, interfaceMembers(node));
    } else if (node.type === 'TSTypeAliasDeclaration' && node.id?.name) {
      const members = typeLiteralMembers(node.typeAnnotation);
      if (members.length > 0) facts.typeMembers.set(node.id.name, members);
    } else if (node.type === 'FunctionDeclaration' && node.id && /^[A-Z]/.test(node.id.name)) {
      facts.components.set(node.id.name, paramFacts(node.params));
    } else if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations as Node[]) {
        if (decl.id?.type !== 'Identifier' || !/^[A-Z]/.test(decl.id.name) || !decl.init) continue;
        if (decl.init.type === 'ArrowFunctionExpression' || decl.init.type === 'FunctionExpression') {
          const p = paramFacts(decl.init.params);
          p.propsTypeName = p.propsTypeName ?? fcPropsTypeName(decl);
          facts.components.set(decl.id.name, p);
        }
      }
    }
  }
  return facts;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Named hex assignments: `coral: '#ff3366'`, `export const brandRed = "#da1e28"`,
// and CSS custom properties in template CSS: `--brand-coral: #ff3366`.
const NAMED_HEX_RE = /([A-Za-z_$][A-Za-z0-9_$]*)\s*[:=]\s*['"]#([0-9a-fA-F]{6})['"]/g;
const CSS_VAR_HEX_RE = /(--[a-z][a-z0-9-]*)\s*:\s*#([0-9a-fA-F]{6})\b/g;
// BEM-ish DS class prefixes: the `acme` of `acme--button` in a string literal.
const CLASS_PREFIX_RE = /['"`]([a-z][a-z0-9]*(?:-[a-z0-9]+)*)--[a-z]/g;

function isLowSpecificityHex(hex: string): boolean {
  // Pure grays (incl. #ffffff/#000000) show up in any codebase — never tokens.
  const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)];
  return r === g && g === b;
}

// ── Assembly ──────────────────────────────────────────────────────────────────

export interface GeneratedProfile {
  data: CustomDetection;
  stats: {
    filesScanned: number;
    componentsSeen: number;
    signatures: number;
    tokens: number;
    subComponents: number;
    nameSegments: number;
    classPrefixes: number;
  };
}

function buildSignature(props: string[]): string[] | null {
  const seen = new Set<string>();
  const distinctive: string[] = [];
  const common: string[] = [];
  for (const p of props) {
    if (seen.has(p) || UBIQUITOUS_PROPS.has(p)) continue;
    seen.add(p);
    (COMMON_PROPS.has(p) ? common : distinctive).push(p);
  }
  if (distinctive.length < SIGNATURE_MIN_DISTINCTIVE) return null;
  const signature = [...distinctive, ...common].slice(0, SIGNATURE_MAX_PROPS);
  return signature.length >= SIGNATURE_MIN_TOTAL ? signature : null;
}

function splitPascal(name: string): string[] {
  return name.match(/[A-Z][a-z0-9]*/g) ?? [];
}

/**
 * Derive detection data for one design system. `dsExports` is the package's resolved
 * export surface (resolveDsSurface) — only exported components produce entries.
 */
export function generateDetectionData(pkgDir: string, dsExports: Set<string>): GeneratedProfile {
  const files = collectSourceFiles(pkgDir);

  const typeMembers = new Map<string, string[]>();
  const components = new Map<string, { destructured: string[]; propsTypeName?: string }>();
  const tokens: Record<string, string> = {};
  const prefixCounts = new Map<string, number>();

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    const facts = extractFileFacts(content);
    for (const [k, v] of facts.typeMembers) if (!typeMembers.has(k)) typeMembers.set(k, v);
    for (const [k, v] of facts.components) if (!components.has(k)) components.set(k, v);

    let m: RegExpExecArray | null;
    NAMED_HEX_RE.lastIndex = 0;
    while ((m = NAMED_HEX_RE.exec(content)) !== null) {
      const hex = `#${m[2].toLowerCase()}`;
      if (!isLowSpecificityHex(hex) && tokens[hex] === undefined) tokens[hex] = m[1];
    }
    CSS_VAR_HEX_RE.lastIndex = 0;
    while ((m = CSS_VAR_HEX_RE.exec(content)) !== null) {
      const hex = `#${m[2].toLowerCase()}`;
      if (!isLowSpecificityHex(hex) && tokens[hex] === undefined) tokens[hex] = m[1];
    }
    CLASS_PREFIX_RE.lastIndex = 0;
    while ((m = CLASS_PREFIX_RE.exec(content)) !== null) {
      prefixCounts.set(m[1], (prefixCounts.get(m[1]) ?? 0) + 1);
    }
  }

  // Prop signatures: exported components only, distinctiveness-gated.
  const propSignatures: Record<string, string[]> = {};
  const exported = [...dsExports].filter((n) => /^[A-Z]/.test(n)).sort();
  for (const name of exported) {
    const comp = components.get(name);
    const fromConvention = typeMembers.get(`${name}Props`) ?? [];
    const fromDeclared = comp?.propsTypeName ? (typeMembers.get(comp.propsTypeName) ?? []) : [];
    const merged = [...fromConvention, ...fromDeclared, ...(comp?.destructured ?? [])];
    if (merged.length === 0) continue;
    const signature = buildSignature(merged);
    if (signature) propSignatures[name] = signature;
  }

  // Sub-components: exported X whose longest exported proper prefix P leaves a
  // remainder in the part-suffix vocabulary → X belongs to P.
  const subComponents: Record<string, string> = {};
  const exportedSet = new Set(exported);
  for (const name of exported) {
    let parent: string | null = null;
    for (let cut = name.length - 1; cut >= 2; cut--) {
      const prefix = name.slice(0, cut);
      if (exportedSet.has(prefix) && PART_SUFFIXES.has(name.slice(cut))) {
        parent = prefix;
        break; // longest prefix wins
      }
    }
    if (parent) subComponents[name] = parent;
  }

  // Name segments: for each parent that owns sub-components, key on its last
  // PascalCase word (AcmeCard → "Card"), matching how the engine splits local
  // component names. Generic words never become segments — a local `ButtonGroup`
  // must not be suspect on its name alone.
  const nameSegments: Record<string, string> = {};
  for (const parent of new Set(Object.values(subComponents))) {
    const words = splitPascal(parent);
    const segment = words[words.length - 1];
    if (segment && !GENERIC_NAME_WORDS.has(segment)) nameSegments[segment] = parent;
  }

  const classPrefixes = [...prefixCounts.entries()]
    .filter(([, count]) => count >= CLASS_PREFIX_MIN_OCCURRENCES)
    .map(([prefix]) => `${prefix}--`)
    .sort();

  const cappedTokens: Record<string, string> = {};
  for (const [hex, label] of Object.entries(tokens).slice(0, MAX_TOKENS)) cappedTokens[hex] = label;

  const data: CustomDetection = {};
  if (Object.keys(cappedTokens).length > 0) data.tokens = cappedTokens;
  if (classPrefixes.length > 0) data.classPrefixes = classPrefixes;
  if (Object.keys(propSignatures).length > 0) data.propSignatures = propSignatures;
  if (Object.keys(subComponents).length > 0) data.subComponents = subComponents;
  if (Object.keys(nameSegments).length > 0) data.nameSegments = nameSegments;

  return {
    data,
    stats: {
      filesScanned: files.length,
      componentsSeen: components.size,
      signatures: Object.keys(propSignatures).length,
      tokens: Object.keys(cappedTokens).length,
      subComponents: Object.keys(subComponents).length,
      nameSegments: Object.keys(nameSegments).length,
      classPrefixes: classPrefixes.length,
    },
  };
}
