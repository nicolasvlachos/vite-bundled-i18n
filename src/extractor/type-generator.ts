import fs from 'node:fs';
import path from 'node:path';

const PLACEHOLDER_PATTERN = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * Recursively flattens a nested object to dot-separated leaf key paths.
 *
 * @example
 * flattenToKeyPaths({ show: { title: 'X' }, ok: 'Z' })
 * // → ['show.title', 'ok']
 */
export function flattenToKeyPaths(data: object | null | undefined, prefix?: string): string[] {
  if (data == null) return [];
  const result: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    const fullKey = prefix !== undefined ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result.push(...flattenToKeyPaths(value as object, fullKey));
    } else {
      result.push(fullKey);
    }
  }

  return result;
}

/**
 * Recursively flattens a nested object to a map of dot-separated leaf key paths
 * to their string values.
 */
export function flattenToLeafValues(
  data: object | null | undefined,
  prefix?: string,
): Map<string, string> {
  const result = new Map<string, string>();
  if (data == null) return result;

  for (const [key, value] of Object.entries(data)) {
    const fullKey = prefix !== undefined ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      result.set(fullKey, value);
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [nestedKey, nestedValue] of flattenToLeafValues(value as object, fullKey)) {
        result.set(nestedKey, nestedValue);
      }
    }
  }

  return result;
}

/**
 * Extracts placeholder names from a translation string.
 */
export function extractPlaceholders(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    if (match[1]) {
      names.add(match[1]);
    }
  }
  return [...names];
}

/**
 * Builds nested TypeScript interface content from flat dot-separated keys.
 * Each leaf becomes `true`, each branch becomes a nested object.
 */
function buildNestedInterface(keys: string[]): string {
  // Build tree structure
  type TreeNode = { [segment: string]: TreeNode | true };
  const tree: TreeNode = {};

  for (const key of keys) {
    const parts = key.split('.');
    let current: TreeNode = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        current[part] = true;
      } else {
        if (current[part] === true || current[part] === undefined) {
          current[part] = {};
        }
        current = current[part] as TreeNode;
      }
    }
  }

  // Serialize to TypeScript
  function serialize(node: TreeNode | true, indent: number): string {
    if (node === true) return 'true';
    const pad = '  '.repeat(indent);
    const entries = Object.entries(node).sort(([a], [b]) => a.localeCompare(b));
    const lines = entries.map(([key, value]) => {
      const serialized = serialize(value, indent + 1);
      if (serialized === 'true') {
        return `${pad}'${key}': true;`;
      }
      return `${pad}'${key}': {\n${serialized}\n${pad}};`;
    });
    return lines.join('\n');
  }

  return serialize(tree, 2);
}

/**
 * Reads all `.json` files in `{localesDir}/{defaultLocale}/`, flattens each to
 * key paths, and returns a TypeScript declaration string that:
 *
 * 1. Augments the `vite-bundled-i18n` module to populate `I18nKeyMap` — this
 *    wires autocomplete directly into `t()`, `useI18n().t`, and `hasKey()`.
 * 2. Exports `TranslationKey`, `Namespace`, and `NamespaceKeyPaths<T>` for
 *    direct use in application code.
 *
 * When this file is present in the project, `t('shar...')` autocompletes to
 * `t('shared.ok')`. Without it, `t()` accepts any string.
 */
export function generateTypes(
  localesDir: string,
  defaultLocale: string,
  scopes?: string[],
  pageScopeMap?: Record<string, readonly string[]>,
): string {
  const localeDir = path.join(localesDir, defaultLocale);

  let entries: string[];
  try {
    entries = fs.readdirSync(localeDir);
  } catch {
    entries = [];
  }

  const jsonFiles = entries.filter((f) => f.endsWith('.json')).sort();

  /** Map from namespace name → flat key paths (without namespace prefix) */
  const namespaceMap = new Map<string, string[]>();
  /** Map from fully qualified key → placeholder names */
  const paramsMap = new Map<string, string[]>();

  for (const file of jsonFiles) {
    const namespace = file.slice(0, -'.json'.length);
    const raw = fs.readFileSync(path.join(localeDir, file), 'utf-8');
    const data: unknown = JSON.parse(raw);
    const keyPaths =
      data !== null && typeof data === 'object' && !Array.isArray(data)
        ? flattenToKeyPaths(data as object)
        : [];
    namespaceMap.set(namespace, keyPaths);

    const leafValues =
      data !== null && typeof data === 'object' && !Array.isArray(data)
        ? flattenToLeafValues(data as object)
        : new Map<string, string>();
    for (const [keyPath, value] of leafValues) {
      paramsMap.set(`${namespace}.${keyPath}`, extractPlaceholders(value));
    }
  }

  // Collect all fully qualified keys
  const allQualifiedKeys: string[] = [];
  for (const [ns, paths] of namespaceMap) {
    for (const p of paths) {
      allQualifiedKeys.push(`${ns}.${p}`);
    }
  }

  // ---- I18nParamsMap (only keys with placeholders — skip empty {}) -----------
  let paramsMapEntries: string;
  const keysWithParams = allQualifiedKeys.filter(k => (paramsMap.get(k) ?? []).length > 0);
  if (keysWithParams.length === 0) {
    paramsMapEntries = '    // No parameterized keys found';
  } else {
    paramsMapEntries = keysWithParams
      .map((k) => {
        const placeholders = paramsMap.get(k)!;
        const shape = `{ ${placeholders.map((name) => `${name}: TranslationValue`).join('; ')} }`;
        return `    '${k}': ${shape};`;
      })
      .join('\n');
  }

  // ---- I18nNestedKeys (progressive autocomplete) ----------------------------
  let nestedKeysBlock: string;
  if (allQualifiedKeys.length === 0) {
    nestedKeysBlock = '  interface I18nNestedKeys {}';
  } else {
    const nestedBody = buildNestedInterface(allQualifiedKeys);
    nestedKeysBlock = `  interface I18nNestedKeys {\n${nestedBody}\n  }`;
  }

  // ---- I18nScopeMap ----
  let scopeMapEntries: string;
  if (!scopes || scopes.length === 0) {
    scopeMapEntries = '    // No scopes found';
  } else {
    scopeMapEntries = scopes
      .sort()
      .map((s) => `    '${s}': true;`)
      .join('\n');
  }

  // ---- I18nPageIdentifier + PAGE_SCOPE_MAP ----
  // Framework-agnostic "page id → scopes" data. Consumers read this at
  // runtime (typed) inside their router's async resolve hook and call
  // i18n.loadScope(...) in parallel with component resolution.
  let pageIdentifierDecl: string;
  let pageScopeMapDecl: string;
  const pageIds = pageScopeMap ? Object.keys(pageScopeMap).sort() : [];
  if (pageIds.length === 0) {
    pageIdentifierDecl = 'export type I18nPageIdentifier = string;';
    pageScopeMapDecl =
      'export const PAGE_SCOPE_MAP: Readonly<Record<string, readonly string[]>> = {};';
  } else {
    pageIdentifierDecl = `export type I18nPageIdentifier = ${pageIds
      .map((id) => `'${escapeSingleQuotes(id)}'`)
      .join(' | ')};`;

    const entries = pageIds
      .map((id) => {
        const scopesForPage = pageScopeMap![id];
        const values = scopesForPage
          .map((s) => `'${escapeSingleQuotes(s)}'`)
          .join(', ');
        return `  '${escapeSingleQuotes(id)}': [${values}],`;
      })
      .join('\n');
    pageScopeMapDecl = [
      'export const PAGE_SCOPE_MAP: {',
      '  readonly [K in I18nPageIdentifier]: readonly (keyof I18nScopeMap & string)[];',
      '} = {',
      entries,
      '} as const;',
    ].join('\n');
  }

  // Direct exports — the generated file is imported by src/core/types.ts.
  // No module augmentation. This works for both npm consumers and local dev.
  return [
    '// Auto-generated by vite-bundled-i18n — do not edit.',
    '// Regenerated on: npm run dev (auto), npm run build, npm run i18n -- generate',
    '//',
    '// Add ".i18n" to your tsconfig include: { "include": ["src", ".i18n"] }',
    '',
    'type TranslationValue = string | number | boolean | bigint | null | undefined;',
    '',
    '// Direct exports — used by the package to populate types',
    `export ${nestedKeysBlock.replace('  interface ', 'interface ')}`,
    '',
    `export interface I18nParamsMap {`,
    paramsMapEntries,
    `}`,
    '',
    `export interface I18nScopeMap {`,
    scopeMapEntries,
    `}`,
    '',
    pageIdentifierDecl,
    '',
    pageScopeMapDecl,
    '',
  ].join('\n');
}

function escapeSingleQuotes(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Calls {@link generateTypes} and writes the result to `outPath`.
 */
export function writeTypes(
  localesDir: string,
  defaultLocale: string,
  outPath: string,
  scopes?: string[],
  pageScopeMap?: Record<string, readonly string[]>,
): void {
  const content = generateTypes(localesDir, defaultLocale, scopes, pageScopeMap);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content, 'utf-8');
}

/**
 * Emit a runtime-only `.js` sibling of the generated `.ts` types file.
 *
 * The types file (`.i18n/i18n-generated.ts`) is the canonical source for
 * TSC and IDE autocomplete — its `PAGE_SCOPE_MAP` const has both real
 * runtime values and a typed shape. But Vite doesn't resolve tsconfig-path
 * aliases by default, so a plain `import { PAGE_SCOPE_MAP } from
 * 'vite-bundled-i18n/generated'` needs a concrete `.js` target.
 *
 * The plugin writes this file alongside the types file and registers a
 * programmatic `resolve.alias` pointing `vite-bundled-i18n/generated` at
 * it. The published `dist/core/i18n-generated-shim.js` serves non-Vite
 * consumers as an empty-default fallback.
 */
export function generateRuntimeConst(
  pageScopeMap?: Record<string, readonly string[]>,
): string {
  const ids = pageScopeMap ? Object.keys(pageScopeMap).sort() : [];
  const lines: string[] = [
    '// Auto-generated by vite-bundled-i18n — do not edit.',
    '// Runtime companion to i18n-generated.ts (types). Aliased by the',
    '// plugin at `vite-bundled-i18n/generated`.',
    '',
  ];

  if (ids.length === 0) {
    lines.push('export const PAGE_SCOPE_MAP = Object.freeze({});');
  } else {
    lines.push('export const PAGE_SCOPE_MAP = Object.freeze({');
    for (const id of ids) {
      const scopesForPage = pageScopeMap![id];
      const values = scopesForPage
        .map((s) => `'${escapeSingleQuotes(s)}'`)
        .join(', ');
      lines.push(`  '${escapeSingleQuotes(id)}': Object.freeze([${values}]),`);
    }
    lines.push('});');
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Write the runtime `.js` companion at the given path. Creates parent
 * directories as needed. Empty map → placeholder that resolves but exposes
 * no page entries (matches the package-shipped shim shape).
 */
export function writeRuntimeConst(
  outPath: string,
  pageScopeMap?: Record<string, readonly string[]>,
): void {
  const content = generateRuntimeConst(pageScopeMap);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content, 'utf-8');
}

/**
 * Derive the runtime `.js` path from the types `.ts` path — same basename,
 * same directory, different extension. Used so the plugin and CLI always
 * keep the two in sync without extra config.
 */
export function runtimePathFromTypesPath(typesOutPath: string): string {
  const dir = path.dirname(typesOutPath);
  const base = path.basename(typesOutPath);
  const withoutExt = base.replace(/\.(ts|tsx|d\.ts)$/, '');
  return path.join(dir, `${withoutExt}.js`);
}
