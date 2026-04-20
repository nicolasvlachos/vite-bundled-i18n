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
export function generateTypes(localesDir: string, defaultLocale: string): string {
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

  // ---- I18nKeyMap augmentation (wires into t() autocomplete) ----------------
  let keyMapEntries: string;
  if (allQualifiedKeys.length === 0) {
    keyMapEntries = '    // No keys found';
  } else {
    keyMapEntries = allQualifiedKeys
      .map((k) => `    '${k}': true;`)
      .join('\n');
  }

  let paramsMapEntries: string;
  if (allQualifiedKeys.length === 0) {
    paramsMapEntries = '    // No params found';
  } else {
    paramsMapEntries = allQualifiedKeys
      .map((k) => {
        const placeholders = paramsMap.get(k) ?? [];
        const shape =
          placeholders.length === 0
            ? '{}'
            : `{ ${placeholders.map((name) => `${name}: Primitive`).join('; ')} }`;
        return `    '${k}': ${shape};`;
      })
      .join('\n');
  }

  const augmentation = [
    `declare module 'vite-bundled-i18n' {`,
    `  interface I18nKeyMap {`,
    keyMapEntries,
    `  }`,
    ``,
    `  interface I18nParamsMap {`,
    paramsMapEntries,
    `  }`,
    `}`,
  ].join('\n');

  // ---- TranslationKey -------------------------------------------------------
  let translationKeyType: string;
  if (allQualifiedKeys.length === 0) {
    translationKeyType = 'export type TranslationKey = never;';
  } else {
    const lines = allQualifiedKeys.map((k) => `  | '${k}'`).join('\n');
    translationKeyType = `export type TranslationKey =\n${lines};`;
  }

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
    '// Auto-generated by vite-bundled-i18n. Do not edit.',
    '// Run `npm run i18n -- generate` to regenerate.',
    '',
    '// Module augmentation — wires autocomplete into t(), useI18n().t, hasKey()',
    augmentation,
    '',
    '/** Union of all valid translation key paths. */',
    translationKeyType,
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
): void {
  const content = generateTypes(localesDir, defaultLocale);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content, 'utf-8');
}
