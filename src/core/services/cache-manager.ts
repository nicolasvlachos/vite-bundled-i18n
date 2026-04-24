import type {
  CacheStats,
  DictionaryConfig,
  NestedTranslations,
  RuntimeCacheConfig,
} from '../types';
import { createStore, type ResourceStore } from '../store';
import { inferNamespace } from '../resolver';

// ---------------------------------------------------------------------------
// Types / interfaces
// ---------------------------------------------------------------------------

/** Subset of the full i18n config needed by the cache manager. */
export interface CacheManagerConfig {
  /** Dictionary definitions used for load-marker bookkeeping. */
  dictionaries?: Record<string, DictionaryConfig>;
  /** Cache / eviction settings. */
  cache?: { runtime?: 'memory' | 'none' | RuntimeCacheConfig };
}

/** Resolved runtime-cache settings used internally. */
interface ResolvedRuntimeCache {
  strategy: 'memory' | 'none';
  eviction: 'none' | 'lru';
  maxLocales?: number;
  maxNamespaces?: number;
  maxBytes?: number;
  pinDictionaries: boolean;
}

/**
 * Manages the in-memory translation cache, including load-state tracking,
 * LRU eviction, residency queries, and resource-change event dispatch.
 *
 * Wraps a {@link ResourceStore} and adds scope/dictionary bookkeeping that
 * the raw store does not provide.
 */
export interface CacheManager {
  /**
   * Add translation data to the store for a locale and namespace.
   *
   * @param locale - Target locale code.
   * @param namespace - Target namespace.
   * @param data - Nested translations to merge into the store.
   * @param options - Optional source tag and pinning flag.
   */
  addResources(
    locale: string,
    namespace: string,
    data: NestedTranslations,
    options?: { source?: 'dictionary' | 'scope' | 'manual'; pinned?: boolean },
  ): void;

  /**
   * Retrieve translation data for a locale and namespace.
   *
   * @param locale - Target locale code.
   * @param namespace - Target namespace.
   * @returns The stored translations, or `undefined` if not loaded.
   */
  getResource(locale: string, namespace: string): NestedTranslations | undefined;

  /**
   * Check whether a namespace has data in the store for a locale.
   *
   * @param locale - Target locale code.
   * @param namespace - Namespace to check.
   * @returns `true` when the namespace contains data.
   */
  isNamespaceLoaded(locale: string, namespace: string): boolean;

  /**
   * Check whether a scope is considered loaded for a locale.
   *
   * In dev namespace mode, a scope is loaded when its root namespace is loaded.
   * Otherwise, the scope must have been explicitly marked and either contain
   * stored data or have been marked as intentionally empty.
   *
   * @param locale - Target locale code.
   * @param scope - Scope identifier (e.g. `"products"` or `"products.show"`).
   * @returns `true` when the scope is loaded.
   */
  isScopeLoaded(locale: string, scope: string): boolean;

  /**
   * Check whether a named dictionary has been loaded for a locale.
   *
   * @param locale - Target locale code.
   * @param name - Dictionary name.
   * @returns `true` when the dictionary has been marked as loaded.
   */
  isDictionaryLoaded(locale: string, name: string): boolean;

  /**
   * Mark a scope as loaded for a locale.
   *
   * When `allowEmpty` is `true` and the scope has no stored data, it will be
   * tracked in the empty-loaded set so that {@link isScopeLoaded} still returns
   * `true`.
   *
   * @param locale - Target locale code.
   * @param scope - Scope identifier.
   * @param allowEmpty - Whether to accept scopes that resolved to no data.
   */
  markScopeLoaded(locale: string, scope: string, allowEmpty?: boolean): void;

  /**
   * Mark a named dictionary as loaded for a locale.
   *
   * @param locale - Target locale code.
   * @param name - Dictionary name.
   */
  markDictionaryLoaded(locale: string, name: string): void;

  /**
   * Return the namespace names that have data in the store for a locale.
   *
   * @param locale - Target locale code.
   * @returns Sorted array of namespace names.
   */
  getLoadedNamespaces(locale: string): string[];

  /**
   * Return the scope identifiers that are currently loaded for a locale.
   *
   * @param locale - Target locale code.
   * @returns Sorted array of scope identifiers.
   */
  getLoadedScopes(locale: string): string[];

  /**
   * Return the dictionary names that are currently loaded for a locale.
   *
   * @param locale - Target locale code.
   * @returns Sorted array of dictionary names.
   */
  getLoadedDictionaries(locale: string): string[];

  /**
   * Return cache statistics for the runtime store.
   *
   * @returns Aggregated {@link CacheStats}.
   */
  getCacheStats(): CacheStats;

  /**
   * Count the number of leaf (string) translation keys currently stored
   * for a locale across all namespaces.
   *
   * @param locale - Target locale code.
   * @returns Total number of leaf keys.
   */
  getResidentKeyCount(locale: string): number;

  /**
   * Remove all data and load markers for a locale.
   *
   * @param locale - Locale to unload.
   */
  unloadLocale(locale: string): void;

  /**
   * Remove a single namespace and its related load markers for a locale.
   *
   * @param locale - Target locale code.
   * @param namespace - Namespace to remove.
   */
  unloadNamespace(locale: string, namespace: string): void;

  /**
   * Run LRU eviction against the configured constraints.
   *
   * Pinned namespaces and the current locale are protected from eviction.
   *
   * @param currentLocale - The active locale, which is protected from locale-level eviction.
   */
  evictUnused(currentLocale: string): void;

  /**
   * Subscribe to resource-change events. Returns an unsubscribe function.
   *
   * @param callback - Listener invoked after resources change.
   * @returns A function that removes the listener.
   */
  onResourcesChange(callback: () => void): () => void;

  /**
   * Suppress resource-change events. Calls nest: each `suppressEvents` must
   * be balanced by a {@link resumeEvents} call.
   */
  suppressEvents(): void;

  /**
   * Resume resource-change events after a previous {@link suppressEvents}.
   * When the suppression count reaches zero, a single change event is emitted.
   */
  resumeEvents(): void;

  /**
   * Return the underlying {@link ResourceStore}.
   *
   * @returns The wrapped resource store.
   */
  getStore(): ResourceStore;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Separator used in scope/dictionary composite keys. */
const KEY_SEP = ':';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Resolve config shorthand into a concrete runtime-cache settings object. */
function resolveRuntimeCache(config: CacheManagerConfig): ResolvedRuntimeCache {
  const runtime = config.cache?.runtime;

  if (runtime === 'none') {
    return { strategy: 'none', eviction: 'none', pinDictionaries: false };
  }

  if (runtime === 'memory' || runtime == null) {
    return { strategy: 'memory', eviction: 'none', pinDictionaries: true };
  }

  return {
    strategy: runtime.strategy ?? 'memory',
    eviction: runtime.eviction ?? 'none',
    maxLocales: runtime.maxLocales,
    maxNamespaces: runtime.maxNamespaces,
    maxBytes: runtime.maxBytes,
    pinDictionaries: runtime.pinDictionaries ?? true,
  };
}

/** Build a composite key for scope/dictionary tracking sets. */
function compositeKey(locale: string, id: string): string {
  return `${locale}${KEY_SEP}${id}`;
}

/** Extract the sub-key portion of a scope identifier, if any. */
function getScopeSubkey(scope: string): string | undefined {
  const dot = scope.indexOf('.');
  return dot === -1 ? undefined : scope.slice(dot + 1);
}

/** Walk a nested translations object along a dot-separated path. */
function pathExists(data: NestedTranslations, keyPath: string): boolean {
  const segments = keyPath.split('.');
  let current: NestedTranslations | string = data;

  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) return false;
    current = current[segment];
    if (current === undefined) return false;
  }

  return true;
}

/** Check whether a dictionary config references a given namespace. */
function dictionaryTouchesNamespace(
  dict: DictionaryConfig,
  namespace: string,
): boolean {
  if ((dict.keys ?? []).includes(namespace)) return true;

  return (dict.include ?? []).some((pattern) => {
    if (pattern === namespace || pattern === `${namespace}.*`) return true;
    if (pattern.startsWith(`${namespace}.`)) return true;
    if (!pattern.includes('.') && pattern.endsWith('*')) {
      return namespace.startsWith(pattern.slice(0, -1));
    }
    return false;
  });
}

/**
 * Recursively count leaf (string) values in a nested translations object.
 *
 * Defensive: `data` may be `null`/`undefined` when a namespace entry is
 * registered but its payload is still being fetched, or when user JSON has
 * a nullable leaf. Every level short-circuits on null to keep the walk
 * total-function.
 */
function countLeaves(data: NestedTranslations | null | undefined): number {
  if (data == null) return 0;
  let count = 0;
  for (const value of Object.values(data)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      count += 1;
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      count += countLeaves(value);
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new {@link CacheManager} instance.
 *
 * The manager wraps a freshly created {@link ResourceStore} and layers on
 * scope/dictionary load-state tracking, LRU eviction, resident-key counting,
 * and resource-change event dispatch.
 *
 * @param config - Cache and dictionary configuration subset.
 * @param options - Optional flags.
 * @param options.devNamespaceMode - When `true`, scopes are considered loaded
 *   if their root namespace is loaded (used in dev mode without a resolveUrl).
 * @returns A configured {@link CacheManager}.
 */
export function createCacheManager(
  config: CacheManagerConfig = {},
  options: { devNamespaceMode?: boolean } = {},
): CacheManager {
  const store = createStore();
  const runtimeCache = resolveRuntimeCache(config);
  const devNamespaceMode = options.devNamespaceMode ?? false;

  const loadedScopes = new Set<string>();
  const emptyLoadedScopes = new Set<string>();
  const loadedDicts = new Set<string>();

  const resourceListeners = new Set<() => void>();
  let suppressionDepth = 0;
  let pendingEmit = false;

  // -- Event helpers --------------------------------------------------------

  function emitResourcesChange(): void {
    if (suppressionDepth > 0) {
      pendingEmit = true;
      return;
    }
    for (const listener of resourceListeners) {
      listener();
    }
  }

  // -- Scope data helpers ---------------------------------------------------

  function scopeHasStoredData(locale: string, scope: string): boolean {
    const namespace = inferNamespace(scope);
    const resource = store.getResource(locale, namespace);
    if (!resource) return false;

    const subkey = getScopeSubkey(scope);
    if (!subkey) return Object.keys(resource).length > 0;

    return pathExists(resource, subkey);
  }

  // -- Load-marker management -----------------------------------------------

  function clearLoadMarkersForNamespace(locale: string, namespace: string): void {
    for (const scopeKey of [...loadedScopes]) {
      const sepIdx = scopeKey.indexOf(KEY_SEP);
      const scopeLocale = scopeKey.slice(0, sepIdx);
      const scope = scopeKey.slice(sepIdx + 1);
      if (scopeLocale !== locale) continue;
      const scopeNs = inferNamespace(scope);
      if (scopeNs === namespace) {
        loadedScopes.delete(scopeKey);
        emptyLoadedScopes.delete(scopeKey);
      }
    }

    for (const dictKey of [...loadedDicts]) {
      const sepIdx = dictKey.indexOf(KEY_SEP);
      const dictLocale = dictKey.slice(0, sepIdx);
      const dictName = dictKey.slice(sepIdx + 1);
      if (dictLocale !== locale) continue;
      const dictConfig = config.dictionaries?.[dictName];
      if (dictConfig && dictionaryTouchesNamespace(dictConfig, namespace)) {
        loadedDicts.delete(dictKey);
      }
    }
  }

  function clearLoadMarkersForLocale(locale: string): void {
    const prefix = `${locale}${KEY_SEP}`;
    for (const key of [...loadedScopes]) {
      if (key.startsWith(prefix)) {
        loadedScopes.delete(key);
        emptyLoadedScopes.delete(key);
      }
    }
    for (const key of [...loadedDicts]) {
      if (key.startsWith(prefix)) {
        loadedDicts.delete(key);
      }
    }
  }

  // -- Public interface -----------------------------------------------------

  const manager: CacheManager = {
    addResources(locale, namespace, data, opts) {
      store.addResources(locale, namespace, data, {
        source: opts?.source ?? 'manual',
        pinned: opts?.pinned ?? false,
      });
      emitResourcesChange();
    },

    getResource(locale, namespace) {
      return store.getResource(locale, namespace);
    },

    isNamespaceLoaded(locale, namespace) {
      return store.hasNamespace(locale, namespace);
    },

    isScopeLoaded(locale, scope) {
      if (devNamespaceMode && store.hasNamespace(locale, inferNamespace(scope))) {
        return true;
      }
      const key = compositeKey(locale, scope);
      return loadedScopes.has(key) && (
        emptyLoadedScopes.has(key) || scopeHasStoredData(locale, scope)
      );
    },

    isDictionaryLoaded(locale, name) {
      return loadedDicts.has(compositeKey(locale, name));
    },

    markScopeLoaded(locale, scope, allowEmpty = false) {
      const key = compositeKey(locale, scope);
      loadedScopes.add(key);

      if (scopeHasStoredData(locale, scope)) {
        emptyLoadedScopes.delete(key);
        return;
      }

      if (allowEmpty) {
        emptyLoadedScopes.add(key);
        return;
      }

      emptyLoadedScopes.delete(key);
    },

    markDictionaryLoaded(locale, name) {
      loadedDicts.add(compositeKey(locale, name));
    },

    getLoadedNamespaces(locale) {
      return store
        .getEntries()
        .filter((e) => e.locale === locale)
        .map((e) => e.namespace);
    },

    getLoadedScopes(locale) {
      const prefix = `${locale}${KEY_SEP}`;
      return [...loadedScopes]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
        .filter((scope) => manager.isScopeLoaded(locale, scope))
        .sort();
    },

    getLoadedDictionaries(locale) {
      const prefix = `${locale}${KEY_SEP}`;
      return [...loadedDicts]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
        .sort();
    },

    getCacheStats() {
      const stats = store.getStats();
      return {
        ...stats,
        loadedScopes: loadedScopes.size,
        loadedDictionaries: loadedDicts.size,
      };
    },

    getResidentKeyCount(locale) {
      const entries = store.getEntries().filter((e) => e.locale === locale);
      let total = 0;
      for (const entry of entries) {
        total += countLeaves(entry.data);
      }
      return total;
    },

    unloadLocale(locale) {
      store.removeLocale(locale);
      clearLoadMarkersForLocale(locale);
      emitResourcesChange();
    },

    unloadNamespace(locale, namespace) {
      store.removeNamespace(locale, namespace);
      clearLoadMarkersForNamespace(locale, namespace);
      emitResourcesChange();
    },

    evictUnused(currentLocale) {
      if (runtimeCache.strategy === 'none' || runtimeCache.eviction === 'none') {
        return;
      }

      const entries = store.getEntries();
      const nonPinned = entries
        .filter((e) => !e.pinned)
        .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

      const evictOne = () => {
        const candidate = nonPinned.shift();
        if (!candidate) return false;
        store.removeNamespace(candidate.locale, candidate.namespace);
        clearLoadMarkersForNamespace(candidate.locale, candidate.namespace);
        return true;
      };

      if (runtimeCache.maxLocales !== undefined) {
        while (store.getStats().totalLocales > runtimeCache.maxLocales) {
          const localeCandidates = new Map<string, number>();
          for (const entry of nonPinned) {
            const prev = localeCandidates.get(entry.locale) ?? Number.POSITIVE_INFINITY;
            localeCandidates.set(entry.locale, Math.min(prev, entry.lastAccessedAt));
          }

          const localeToEvict = [...localeCandidates.entries()]
            .filter(([loc]) => loc !== currentLocale)
            .sort((a, b) => a[1] - b[1])[0]?.[0];

          if (!localeToEvict) break;
          store.removeLocale(localeToEvict);
          clearLoadMarkersForLocale(localeToEvict);
          for (let i = nonPinned.length - 1; i >= 0; i--) {
            if (nonPinned[i].locale === localeToEvict) {
              nonPinned.splice(i, 1);
            }
          }
        }
      }

      if (runtimeCache.maxNamespaces !== undefined) {
        while (store.getStats().totalNamespaces > runtimeCache.maxNamespaces) {
          if (!evictOne()) break;
        }
      }

      if (runtimeCache.maxBytes !== undefined) {
        while (store.getStats().approxTotalBytes > runtimeCache.maxBytes) {
          if (!evictOne()) break;
        }
      }
    },

    onResourcesChange(callback) {
      resourceListeners.add(callback);
      return () => {
        resourceListeners.delete(callback);
      };
    },

    suppressEvents() {
      suppressionDepth += 1;
    },

    resumeEvents() {
      if (suppressionDepth > 0) suppressionDepth -= 1;
      if (suppressionDepth === 0 && pendingEmit) {
        pendingEmit = false;
        emitResourcesChange();
      }
    },

    getStore() {
      return store;
    },
  };

  return manager;
}
