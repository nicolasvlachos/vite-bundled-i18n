import type { DictionaryConfig } from '../core/types';
import type { ExtractedKey } from './types';
import type { ProjectAnalysis, RouteAnalysis } from './walker-types';
import { resolveDictionaryOwnership } from './dictionary-ownership';
import { inferScopeNamespace } from './scope-bundles';

export interface ApplyDynamicKeysOptions {
  /** The declared dynamic keys from `bundling.dynamicKeys`. */
  dynamicKeys: readonly string[];
  /** Dictionary config — used to skip keys already claimed by a dictionary. */
  dictionaries?: Record<string, DictionaryConfig>;
  /**
   * Whether `bundling.crossNamespacePacking` is on. When `true`, a dynamic
   * key is also injected into any route that references another key in
   * the same namespace (so the route's extras list picks it up).
   */
  crossNamespacePacking?: boolean;
}

export interface ApplyDynamicKeysReport {
  /**
   * Dynamic keys whose namespace isn't covered by any route and isn't
   * claimed by a dictionary. These keys ship nowhere — almost always a
   * misconfiguration. The plugin emits a warning per orphan.
   */
  orphans: string[];
}

/**
 * Inject declared dynamic keys into the matching routes' extracted sets.
 *
 * For each dynamic key `k` with namespace `ns = k.split('.')[0]`:
 *
 * 1. If any configured dictionary claims `k` → skip (dictionary already
 *    guarantees global availability; inlining would duplicate it).
 * 2. For each route whose scope's primary namespace matches `ns`
 *    (`inferScopeNamespace(scope) === ns`), add `k` to `route.keys`.
 * 3. When cross-namespace packing is enabled, also add `k` to any route
 *    that already references another key in `ns` (so the route's extras
 *    bucket picks it up via the normal extractor pipeline).
 * 4. If `k` went into zero routes AND isn't dictionary-owned, report it
 *    as an orphan.
 *
 * Mutates the supplied `analysis` in place. Returns a report for the
 * caller to surface orphans via its logger.
 */
export function applyDynamicKeys(
  analysis: ProjectAnalysis,
  options: ApplyDynamicKeysOptions,
): ApplyDynamicKeysReport {
  if (options.dynamicKeys.length === 0) {
    return { orphans: [] };
  }

  // Pre-compute dictionary ownership against the full available-key space:
  // we need to know if `k` would be claimed even when no static `t(k)` call
  // exists. Use every route's extracted keys plus the dynamic keys themselves.
  const availableKeys = new Set<string>();
  for (const route of analysis.routes) {
    for (const key of route.keys) {
      if (!key.dynamic) availableKeys.add(key.key);
    }
  }
  for (const k of options.dynamicKeys) availableKeys.add(k);

  const ownership = resolveDictionaryOwnership(availableKeys, options.dictionaries);

  // Build a per-namespace index of routes for the two inclusion rules.
  // A route enters `scopedInNamespace` when its scope's primary namespace
  // equals the dynamic key's namespace; `hasKeyInNamespace` when cross-ns
  // packing is on and the route references any other key in that namespace.
  const byPrimaryNamespace = new Map<string, RouteAnalysis[]>();
  const byReferencedNamespace = new Map<string, RouteAnalysis[]>();

  for (const route of analysis.routes) {
    const primaryNamespaces = new Set<string>();
    for (const scope of route.scopes) {
      primaryNamespaces.add(inferScopeNamespace(scope));
    }
    for (const ns of primaryNamespaces) {
      let list = byPrimaryNamespace.get(ns);
      if (!list) { list = []; byPrimaryNamespace.set(ns, list); }
      list.push(route);
    }

    if (options.crossNamespacePacking) {
      const referenced = new Set<string>();
      for (const key of route.keys) {
        const dot = key.key.indexOf('.');
        if (dot === -1) continue;
        referenced.add(key.key.slice(0, dot));
      }
      for (const ns of referenced) {
        if (primaryNamespaces.has(ns)) continue; // already covered
        let list = byReferencedNamespace.get(ns);
        if (!list) { list = []; byReferencedNamespace.set(ns, list); }
        list.push(route);
      }
    }
  }

  const orphans: string[] = [];
  for (const key of options.dynamicKeys) {
    const dot = key.indexOf('.');
    if (dot === -1) {
      // A bare key without a namespace can't belong to a scope; treat as orphan.
      if (!ownership.keyOwner.has(key)) orphans.push(key);
      continue;
    }
    const ns = key.slice(0, dot);

    // Rule 1: skip if dictionary-owned.
    if (ownership.keyOwner.has(key)) continue;

    const targets = new Set<RouteAnalysis>();
    for (const route of byPrimaryNamespace.get(ns) ?? []) targets.add(route);
    if (options.crossNamespacePacking) {
      for (const route of byReferencedNamespace.get(ns) ?? []) targets.add(route);
    }

    if (targets.size === 0) {
      orphans.push(key);
      continue;
    }

    const injected: ExtractedKey = {
      key,
      dynamic: false, // already resolved to a concrete key string
      line: 0,
      column: 0,
    };

    for (const route of targets) {
      if (route.keys.some((k) => !k.dynamic && k.key === key)) continue;
      route.keys.push(injected);
    }
  }

  // Refresh allKeys so downstream readers (reports, type-gen) see the
  // injected keys too.
  const allKeysMap = new Map<string, ExtractedKey>();
  for (const route of analysis.routes) {
    for (const key of route.keys) {
      if (!allKeysMap.has(key.key)) allKeysMap.set(key.key, key);
    }
  }
  analysis.allKeys = [...allKeysMap.values()];

  return { orphans };
}
