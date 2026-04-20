import fs from 'node:fs';
import path from 'node:path';
import type { ProjectAnalysis } from './walker-types';
import { flattenKeys } from './bundle-generator';
import type { DictionaryConfig } from '../core/types';
import {
  keyMatchesPattern,
  normalizeDictionaries,
  resolveDictionaryOwnership,
} from './dictionary-ownership';

/**
 * Read all namespace JSON files for the default locale and return a map of
 * namespace → flattened dot-path key arrays.
 */
export function flattenLocaleKeys(
  localesDir: string,
  defaultLocale: string,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const localeDir = path.join(localesDir, defaultLocale);

  if (!fs.existsSync(localeDir)) return result;

  const entries = fs.readdirSync(localeDir);
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const namespace = entry.slice(0, -5);
    const filePath = path.join(localeDir, entry);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as object;
      result.set(namespace, flattenKeys(data));
    } catch {
      // skip malformed files
    }
  }

  return result;
}

/**
 * Generate the manifest report: mapping of routeId → { scopes, keys, files }.
 */
export function generateManifest(
  analysis: ProjectAnalysis,
): Record<string, object> {
  const manifest: Record<string, object> = {};

  for (const route of analysis.routes) {
    manifest[route.routeId] = {
      scopes: route.scopes,
      keys: route.keys.map((k) => k.key),
      files: route.files,
    };
  }

  return manifest;
}

/**
 * A single missing-key entry.
 */
export interface MissingKeyEntry {
  key: string;
  usedIn: string[];
  line: number;
}

/**
 * Generate the missing-keys report: keys used in code that don't exist in
 * translation files.
 */
export function generateMissing(
  analysis: ProjectAnalysis,
  availableKeys: Map<string, string[]>,
): { summary?: { total: number; hint: string }; keys: MissingKeyEntry[] } {
  const missing: MissingKeyEntry[] = [];

  for (const key of analysis.allKeys) {
    // Skip dynamic keys — they can't be checked statically.
    if (key.dynamic) continue;

    const dotIndex = key.key.indexOf('.');
    if (dotIndex === -1) continue;

    const namespace = key.key.substring(0, dotIndex);
    const subKey = key.key.substring(dotIndex + 1);

    const namespacePaths = availableKeys.get(namespace);
    if (!namespacePaths || !namespacePaths.includes(subKey)) {
      // Collect all files where this key appears across routes.
      const usedIn: string[] = [];
      for (const route of analysis.routes) {
        for (const rk of route.keys) {
          if (rk.key === key.key && rk.line === key.line) {
            for (const file of route.files) {
              if (!usedIn.includes(file)) {
                usedIn.push(file);
              }
            }
          }
        }
      }

      missing.push({ key: key.key, usedIn, line: key.line });
    }
  }

  if (missing.length > 50) {
    return {
      summary: {
        total: missing.length,
        hint: 'If most keys are missing, verify localesDir structure: {locale}/{namespace}.json',
      },
      keys: missing,
    };
  }

  return { keys: missing };
}

/**
 * A single unused-key entry.
 */
export interface UnusedKeyEntry {
  key: string;
  namespace: string;
}

/**
 * Generate the unused-keys report: keys in translation files that no route
 * uses.
 */
export function generateUnused(
  analysis: ProjectAnalysis,
  availableKeys: Map<string, string[]>,
): { keys: UnusedKeyEntry[] } {
  const unused: UnusedKeyEntry[] = [];

  // Build a set of all fully-qualified keys used across all routes.
  const usedKeys = new Set<string>(analysis.allKeys.map((k) => k.key));

  for (const [namespace, keyPaths] of availableKeys) {
    for (const keyPath of keyPaths) {
      const fullKey = `${namespace}.${keyPath}`;
      if (!usedKeys.has(fullKey)) {
        unused.push({ key: fullKey, namespace });
      }
    }
  }

  return { keys: unused };
}

/**
 * Per-route statistics entry.
 */
export interface RouteStats {
  routeId: string;
  usedKeys: number;
  availableKeys: number;
  prunedKeys: number;
}

/**
 * A key that is used by more than one route and whose namespace is not in a
 * dictionary, making it a candidate for extraction.
 */
export interface DictionaryCandidate {
  key: string;
  namespace: string;
  usedByRoutes: string[];
  routeCount: number;
}

/**
 * Per-namespace usage summary.
 */
export interface NamespaceUsageEntry {
  namespace: string;
  routeCount: number;
  totalRoutes: number;
  percentage: number;
  inDictionary: boolean;
}

/**
 * Full overlap analysis result.
 */
export interface OverlapAnalysis {
  candidates: DictionaryCandidate[];
  namespaceUsage: NamespaceUsageEntry[];
}

export interface DictionaryOwnershipRuleReport {
  name: string;
  priority: number;
  include: string[];
  ownedKeys: string[];
}

export interface DictionaryCollisionReport {
  key: string;
  owner: string;
  matchedDictionaries: string[];
}

export interface DictionaryOwnershipReport {
  rules: DictionaryOwnershipRuleReport[];
  collisions: DictionaryCollisionReport[];
  unownedKeys: string[];
}

/**
 * Analyse key and namespace overlap across routes. Keys used by more than one
 * route whose namespace is NOT already a dictionary namespace are returned as
 * candidates.  The namespace-level summary describes what fraction of routes
 * use each namespace.
 */
export function generateOverlapAnalysis(
  analysis: ProjectAnalysis,
  dictionaryNamespaces?: Set<string>,
): OverlapAnalysis {
  const dictNs = dictionaryNamespaces ?? new Set<string>();
  const totalRoutes = analysis.routes.length;

  // 1. Map each fully-qualified key → set of routeIds that use it.
  const keyToRoutes = new Map<string, Set<string>>();
  for (const route of analysis.routes) {
    for (const k of route.keys) {
      if (k.dynamic) continue;
      if (!keyToRoutes.has(k.key)) {
        keyToRoutes.set(k.key, new Set());
      }
      keyToRoutes.get(k.key)!.add(route.routeId);
    }
  }

  // 2. Build candidates: keys used by >1 route whose namespace is not a
  //    dictionary namespace.
  const candidates: DictionaryCandidate[] = [];
  for (const [key, routes] of keyToRoutes) {
    if (routes.size <= 1) continue;
    const dotIndex = key.indexOf('.');
    if (dotIndex === -1) continue;
    const namespace = key.substring(0, dotIndex);
    if (dictNs.has(namespace)) continue;
    const usedByRoutes = Array.from(routes);
    candidates.push({ key, namespace, usedByRoutes, routeCount: usedByRoutes.length });
  }

  // Sort for stable output: descending routeCount then alphabetical key.
  candidates.sort((a, b) => b.routeCount - a.routeCount || a.key.localeCompare(b.key));

  // 3. Namespace-level analysis: for each namespace, count distinct routes.
  const namespaceToRoutes = new Map<string, Set<string>>();
  for (const route of analysis.routes) {
    for (const k of route.keys) {
      if (k.dynamic) continue;
      const dotIndex = k.key.indexOf('.');
      if (dotIndex === -1) continue;
      const namespace = k.key.substring(0, dotIndex);
      if (!namespaceToRoutes.has(namespace)) {
        namespaceToRoutes.set(namespace, new Set());
      }
      namespaceToRoutes.get(namespace)!.add(route.routeId);
    }
  }

  const namespaceUsage: NamespaceUsageEntry[] = [];
  for (const [namespace, routes] of namespaceToRoutes) {
    const routeCount = routes.size;
    const percentage =
      totalRoutes === 0 ? 0 : Math.round((routeCount / totalRoutes) * 100);
    namespaceUsage.push({
      namespace,
      routeCount,
      totalRoutes,
      percentage,
      inDictionary: dictNs.has(namespace),
    });
  }

  // Sort descending by routeCount then alphabetically.
  namespaceUsage.sort(
    (a, b) => b.routeCount - a.routeCount || a.namespace.localeCompare(b.namespace),
  );

  return { candidates, namespaceUsage };
}

/**
 * Generate the stats report: summary counts.
 */
export function generateStats(
  analysis: ProjectAnalysis,
  availableKeys: Map<string, string[]>,
): object {
  const totalKeysInFiles = Array.from(availableKeys.values()).reduce(
    (sum, paths) => sum + paths.length,
    0,
  );

  const missingResult = generateMissing(analysis, availableKeys);
  const unusedResult = generateUnused(analysis, availableKeys);

  const perRoute: RouteStats[] = analysis.routes.map((route) => ({
    routeId: route.routeId,
    usedKeys: route.keys.filter((k) => !k.dynamic).length,
    availableKeys: totalKeysInFiles,
    prunedKeys: totalKeysInFiles - route.keys.filter((k) => !k.dynamic).length,
  }));

  const overlapResult = generateOverlapAnalysis(analysis);
  const sharedKeysCount = new Set(
    overlapResult.candidates.map((c) => c.key),
  ).size;
  const dictionaryCandidates = Array.from(
    new Set(overlapResult.candidates.map((c) => c.namespace)),
  );

  return {
    totalKeysInCode: analysis.allKeys.length,
    totalKeysInFiles,
    usedKeys: analysis.allKeys.length,
    missingKeys: missingResult.keys.length,
    unusedKeys: unusedResult.keys.length,
    routes: analysis.routes.length,
    namespaces: analysis.availableNamespaces.length,
    sharedNamespaces: analysis.sharedNamespaces,
    sharedKeysCount,
    dictionaryCandidates,
    perRoute,
  };
}

export function generateDictionaryOwnershipReport(
  availableKeys: Map<string, string[]>,
  dictionaries?: Record<string, DictionaryConfig>,
): DictionaryOwnershipReport {
  const rules = normalizeDictionaries(dictionaries);
  const allKeys = [...availableKeys.entries()].flatMap(([namespace, keys]) =>
    keys.map((key) => `${namespace}.${key}`),
  );
  const ownership = resolveDictionaryOwnership(allKeys, dictionaries);

  const collisions: DictionaryCollisionReport[] = [];
  for (const key of allKeys) {
    const matched = rules
      .filter((rule) => rule.include.some((pattern) => keyMatchesPattern(key, pattern)))
      .map((rule) => rule.name);
    if (matched.length > 1) {
      collisions.push({
        key,
        owner: ownership.keyOwner.get(key) ?? matched[0],
        matchedDictionaries: matched,
      });
    }
  }

  return {
    rules: rules.map((rule) => ({
      name: rule.name,
      priority: rule.priority,
      include: rule.include,
      ownedKeys: [...(ownership.dictionaryKeys.get(rule.name) ?? new Set())].sort(),
    })),
    collisions: collisions.sort((a, b) => a.key.localeCompare(b.key)),
    unownedKeys: allKeys.filter((key) => !ownership.keyOwner.has(key)).sort(),
  };
}

/**
 * Orchestrate report generation: flatten locale keys, generate all four
 * reports, and write them as JSON files to outDir.
 */
export function generateReports(
  analysis: ProjectAnalysis,
  localesDir: string,
  defaultLocale: string,
  outDir: string,
  dictionaries?: Record<string, DictionaryConfig>,
): void {
  const availableKeys = flattenLocaleKeys(localesDir, defaultLocale);

  const manifest = generateManifest(analysis);
  const missing = generateMissing(analysis, availableKeys);
  const unused = generateUnused(analysis, availableKeys);
  const stats = generateStats(analysis, availableKeys);
  const overlap = generateOverlapAnalysis(analysis);
  const ownership = generateDictionaryOwnershipReport(availableKeys, dictionaries);

  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  fs.writeFileSync(
    path.join(outDir, 'missing.json'),
    JSON.stringify(missing, null, 2),
  );
  fs.writeFileSync(
    path.join(outDir, 'unused.json'),
    JSON.stringify(unused, null, 2),
  );
  fs.writeFileSync(
    path.join(outDir, 'stats.json'),
    JSON.stringify(stats, null, 2),
  );
  fs.writeFileSync(
    path.join(outDir, 'overlap.json'),
    JSON.stringify(overlap, null, 2),
  );
  fs.writeFileSync(
    path.join(outDir, 'ownership.json'),
    JSON.stringify(ownership, null, 2),
  );
}
