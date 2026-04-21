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
export function flattenToKeyPaths(data: object, prefix?: string): string[] {
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
  data: object,
  prefix?: string,
): Map<string, string> {
  const result = new Map<string, string>();

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
export function generateTypes(localesDir: string, defaultLocale: string, scopes?: string[]): string {
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

  const namespaces = [...namespaceMap.keys()];

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
        const shape = `{ ${placeholders.map((name) => `${name}: Primitive`).join('; ')} }`;
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

  // ---- I18nScopeMap augmentation ----
  let scopeMapEntries: string;
  if (!scopes || scopes.length === 0) {
    scopeMapEntries = '    // No scopes found';
  } else {
    scopeMapEntries = scopes
      .sort()
      .map((s) => `    '${s}': true;`)
      .join('\n');
  }

  const augmentation = [
    `declare module 'vite-bundled-i18n' {`,
    nestedKeysBlock,
    ``,
    `  interface I18nParamsMap {`,
    paramsMapEntries,
    `  }`,
    ``,
    `  interface I18nScopeMap {`,
    scopeMapEntries,
    `  }`,
    `}`,
  ].join('\n');

  // ---- Namespace ------------------------------------------------------------
  let namespaceType: string;
  if (namespaces.length === 0) {
    namespaceType = 'export type Namespace = never;';
  } else {
    namespaceType = `export type Namespace = ${namespaces.map((n) => `'${n}'`).join(' | ')};`;
  }

  // ---- NamespaceKeyPaths<T> -------------------------------------------------
  let namespaceKeyPathsType: string;
  if (namespaces.length === 0) {
    namespaceKeyPathsType =
      'export type NamespaceKeyPaths<T extends Namespace> = never;';
  } else {
    const conditions = namespaces
      .map((ns) => {
        const paths = namespaceMap.get(ns)!;
        const union =
          paths.length === 0
            ? 'never'
            : paths.map((p) => `'${p}'`).join(' | ');
        return `  T extends '${ns}' ? ${union} :`;
      })
      .join('\n');
    namespaceKeyPathsType =
      `export type NamespaceKeyPaths<T extends Namespace> =\n${conditions}\n  never;`;
  }

  return [
    '// Auto-generated by vite-bundled-i18n — do not edit.',
    '// Regenerated on: npm run dev (auto), npm run build, npm run i18n -- generate',
    '//',
    '// This file augments the vite-bundled-i18n package types with your project\'s',
    '// translation keys, placeholder params, and valid scopes. It enables:',
    '//   - Progressive autocomplete: t(\'feedback.\' → pages, actions, ...)',
    '//   - Placeholder validation: t(\'cart.total\', { amount }) is type-checked',
    '//   - Scope validation: useI18n(\'feedbak.index\') → compile error (typo)',
    '//',
    '// If your tsconfig doesn\'t include this file\'s directory, add it:',
    '//   "include": ["src", ".i18n"]',
    '',
    augmentation,
    '',
    '/** Union of all namespace names. */',
    namespaceType,
    '',
    '/** Key paths within a specific namespace (without the namespace prefix). */',
    namespaceKeyPathsType,
    '',
  ].join('\n');
}

/**
 * Calls {@link generateTypes} and writes the result to `outPath`.
 */
export function writeTypes(
  localesDir: string,
  defaultLocale: string,
  outPath: string,
  scopes?: string[],
): void {
  const content = generateTypes(localesDir, defaultLocale, scopes);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content, 'utf-8');
}
