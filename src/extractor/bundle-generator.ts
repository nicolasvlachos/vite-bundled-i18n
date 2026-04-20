import fs from 'node:fs';
import path from 'node:path';
import type { ProjectAnalysis } from './walker-types';
import type { DictionaryConfig } from '../core/types';
import { resolveDictionaryOwnership } from './dictionary-ownership';
import { buildScopePlans } from './scope-bundles';

/**
 * Options for the bundle generator.
 */
export interface BundleGeneratorOptions {
  /** Path to locales directory (absolute). */
  localesDir: string;
  /** Locales to generate bundles for. */
  locales: string[];
  /** Output directory for generated bundles (absolute). */
  outDir: string;
  /** Optional named dictionary configurations. */
  dictionaries?: Record<string, DictionaryConfig>;
}

/**
 * Metadata about a generated bundle file.
 */
export interface GeneratedBundle {
  /** The route ID or dictionary name this bundle is for. */
  name: string;
  /** The locale this bundle is for. */
  locale: string;
  /** The output file path. */
  filePath: string;
  /** Number of keys in this bundle. */
  keyCount: number;
  /** Number of keys pruned (available but not used). */
  prunedCount: number;
}

/**
 * Flatten a nested object into dot-separated key paths.
 */
export function flattenKeys(data: object, prefix?: string): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v as object, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

/**
 * Set a value at a dot-separated path in a nested object, creating
 * intermediate objects as needed.
 */
function setNestedValue(obj: Record<string, unknown>, keyPath: string, value: unknown): void {
  const parts = keyPath.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Get a value at a dot-separated path in a nested object.
 * Returns undefined if the path does not exist.
 */
function getNestedValue(obj: Record<string, unknown>, keyPath: string): unknown {
  const parts = keyPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Prune a namespace JSON object to only include the specified key paths.
 *
 * For keys that point to a subtree (object), the entire subtree is included.
 * This supports dynamic keys with a static prefix — the full subtree under
 * the prefix is preserved.
 */
export function pruneNamespace(
  fullData: object,
  usedKeyPaths: string[],
): object {
  const result: Record<string, unknown> = {};
  for (const keyPath of usedKeyPaths) {
    const value = getNestedValue(fullData as Record<string, unknown>, keyPath);
    if (value !== undefined) {
      setNestedValue(result, keyPath, value);
    }
  }
  return result;
}

/**
 * Read a namespace JSON file for a given locale.
 */
function readNamespaceFile(
  localesDir: string,
  locale: string,
  namespace: string,
): Record<string, unknown> | null {
  const filePath = path.join(localesDir, locale, `${namespace}.json`);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as Record<string, unknown>;
}

/**
 * Generate tree-shaken per-route translation bundles from project analysis.
 */
export function generateBundles(
  analysis: ProjectAnalysis,
  options: BundleGeneratorOptions,
): GeneratedBundle[] {
  const { localesDir, locales, outDir, dictionaries } = options;
  const bundles: GeneratedBundle[] = [];

  const availableKeys = new Set<string>();
  for (const route of analysis.routes) {
    for (const key of route.keys) {
      if (!key.dynamic) {
        availableKeys.add(key.key);
      }
    }
  }
  const ownership = resolveDictionaryOwnership(availableKeys, dictionaries);
  const hasNamedDictionaries = ownership.rules.length > 0;
  const sharedNsSet = hasNamedDictionaries ? new Set<string>() : new Set(analysis.sharedNamespaces);

  // Generate per-scope bundles keyed by scope string, matching runtime URLs.
  for (const plan of buildScopePlans(analysis, availableKeys)) {
    for (const locale of locales) {
      const bundleData: Record<string, unknown> = {};
      let totalKeyCount = 0;
      let totalPrunedCount = 0;
      const scopeKeys = [...plan.keys].filter((key) => {
        if (ownership.keyOwner.has(key)) return false;
        return !(!hasNamedDictionaries && sharedNsSet.has(plan.namespace));
      });
      const subKeys = scopeKeys
        .filter((key) => key.startsWith(`${plan.namespace}.`))
        .map((key) => key.slice(plan.namespace.length + 1));
      const fullData = readNamespaceFile(localesDir, locale, plan.namespace);
      if (fullData && subKeys.length > 0) {
        const pruned = pruneNamespace(fullData, [...new Set(subKeys)]);
        bundleData[plan.namespace] = pruned;

        const availableCount = flattenKeys(fullData).length;
        const keptCount = flattenKeys(pruned).length;
        totalKeyCount += keptCount;
        totalPrunedCount += availableCount - keptCount;
      }

      const filePath = path.join(outDir, locale, `${plan.scope}.json`);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(bundleData, null, 2));

      bundles.push({
        name: plan.scope,
        locale,
        filePath,
        keyCount: totalKeyCount,
        prunedCount: totalPrunedCount,
      });
    }
  }

  if (hasNamedDictionaries) {
    for (const rule of ownership.rules) {
      const ownedKeys = ownership.dictionaryKeys.get(rule.name) ?? new Set<string>();
      const keysByNamespace = new Map<string, string[]>();

      for (const key of ownedKeys) {
        const dotIndex = key.indexOf('.');
        if (dotIndex === -1) continue;
        const ns = key.slice(0, dotIndex);
        const subKey = key.slice(dotIndex + 1);
        if (!keysByNamespace.has(ns)) {
          keysByNamespace.set(ns, []);
        }
        keysByNamespace.get(ns)!.push(subKey);
      }

      for (const locale of locales) {
        const bundleData: Record<string, unknown> = {};
        let totalKeyCount = 0;
        let totalPrunedCount = 0;

        for (const [ns, subKeys] of keysByNamespace) {
          const fullData = readNamespaceFile(localesDir, locale, ns);
          if (!fullData) continue;

          const uniqueSubKeys = [...new Set(subKeys)];
          const pruned = pruneNamespace(fullData, uniqueSubKeys);
          bundleData[ns] = pruned;

          const availableCount = flattenKeys(fullData).length;
          const keptCount = flattenKeys(pruned).length;
          totalKeyCount += keptCount;
          totalPrunedCount += availableCount - keptCount;
        }

        const filePath = path.join(outDir, locale, '_dict', `${rule.name}.json`);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(bundleData, null, 2));

        bundles.push({
          name: `_dict/${rule.name}`,
          locale,
          filePath,
          keyCount: totalKeyCount,
          prunedCount: totalPrunedCount,
        });
      }
    }

    return bundles;
  }

  // Legacy shared-namespace dictionary bundles
  for (const sharedNs of analysis.sharedNamespaces) {
    // Collect ALL keys used across ALL routes for this namespace
    const allSubKeys = new Set<string>();
    for (const route of analysis.routes) {
      for (const key of route.keys) {
        const dotIndex = key.key.indexOf('.');
        if (dotIndex === -1) continue;
        const ns = key.key.substring(0, dotIndex);
        if (ns === sharedNs) {
          const subKey = key.dynamic && key.staticPrefix
            ? key.staticPrefix.substring(dotIndex + 1)
            : key.key.substring(dotIndex + 1);
          allSubKeys.add(subKey);
        }
      }
    }

    for (const locale of locales) {
      const fullData = readNamespaceFile(localesDir, locale, sharedNs);
      if (!fullData) continue;

      const uniqueSubKeys = [...allSubKeys];
      const pruned = pruneNamespace(fullData, uniqueSubKeys);

      const filePath = path.join(outDir, locale, '_dict', `${sharedNs}.json`);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(pruned, null, 2));

      const availableCount = flattenKeys(fullData).length;
      const keptCount = flattenKeys(pruned).length;

      bundles.push({
        name: `_dict/${sharedNs}`,
        locale,
        filePath,
        keyCount: keptCount,
        prunedCount: availableCount - keptCount,
      });
    }
  }

  return bundles;
}
