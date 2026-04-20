import type { I18nConfig, I18nInstance, NestedTranslations, KeyUsageEntry } from './types';
import { createStore } from './store';
import { resolveKey, inferNamespace, extractSubkey } from './resolver';
import { interpolate } from './interpolator';
import { fetchBundle, fetchNamespace } from './fetcher';
import {
  compiledHasKeyInMap,
  compiledTranslateFromMap,
  compiledTryTranslateFromMap,
  loadCompiledManifest,
  type CompiledManifestModule,
  type CompiledTranslationMap,
} from './compiled-runtime';

/**
 * Resolves the requestInit config value to a concrete RequestInit object.
 * Handles static objects, sync functions, and async functions.
 */
export async function resolveRequestInit(
  requestInit: RequestInit | (() => RequestInit | Promise<RequestInit>) | undefined,
): Promise<RequestInit | undefined> {
  if (requestInit === undefined) return undefined;
  if (typeof requestInit === 'function') return requestInit();
  return requestInit;
}

function resolveRuntimeCache(config: I18nConfig) {
  const runtime = config.cache?.runtime;

  if (runtime === 'none') {
    return { strategy: 'none', eviction: 'none', pinDictionaries: false } as const;
  }

  if (runtime === 'memory' || runtime == null) {
    return { strategy: 'memory', eviction: 'none', pinDictionaries: true } as const;
  }

  return {
    strategy: runtime.strategy ?? 'memory',
    eviction: runtime.eviction ?? 'none',
    maxLocales: runtime.maxLocales,
    maxNamespaces: runtime.maxNamespaces,
    maxBytes: runtime.maxBytes,
    pinDictionaries: runtime.pinDictionaries ?? true,
  } as const;
}

function getInjectedI18nBase(): string | undefined {
  return typeof __VITE_I18N_BASE__ !== 'undefined'
    ? __VITE_I18N_BASE__
    : undefined;
}

/**
 * Resolves the base path for bundle fetches.
 * Resolution order: config.publicBase > __VITE_I18N_BASE__ > '/__i18n'
 */
function resolveI18nBase(config: I18nConfig): string {
  return config.publicBase ?? getInjectedI18nBase() ?? '/__i18n';
}

function getInjectedCompiledManifestUrl(): string | undefined {
  return typeof __VITE_I18N_COMPILED_MANIFEST__ !== 'undefined'
    ? __VITE_I18N_COMPILED_MANIFEST__
    : undefined;
}

function shouldUseCompiledRuntime(config: I18nConfig, manifestUrl?: string): boolean {
  if (config.compiled?.enabled === false) return false;
  if (config.compiled?.enabled === true) return true;
  if (config.compiled?.enabled === 'auto') return !!manifestUrl;
  return !!manifestUrl;
}

/**
 * Creates and configures an i18n instance.
 *
 * This is the main entry point for setting up translations. It assembles
 * the resource store, key resolver, interpolator, and fetcher into a
 * single {@link I18nInstance} with a unified API.
 *
 * Translation loading uses bundles:
 * - **Named dictionaries** — one HTTP request per dictionary name
 *   (`/__i18n/{locale}/_dict/{name}.json`), loaded in declaration order.
 * - **Scope bundles** — one HTTP request per page scope
 *   (`/__i18n/{locale}/{scope}.json`).
 *
 * The dev plugin (`i18nDevPlugin`) serves these by combining individual
 * namespace JSON files on the fly.
 *
 * @param config - The i18n configuration
 * @returns A configured {@link I18nInstance}
 *
 * @example
 * ```ts
 * const i18n = createI18n({
 *   locale: 'en',
 *   defaultLocale: 'en',
 *   supportedLocales: ['en', 'bg'],
 *   localesDir: '/locales',
 *   dictionaries: {
 *     global: { keys: ['shared', 'global', 'actions'] },
 *     admin: { keys: ['admin'] },
 *   },
 * });
 * ```
 */
export function createI18n(config: I18nConfig): I18nInstance {
  if (!config.locale || typeof config.locale !== 'string') {
    throw new Error('vite-bundled-i18n: locale must be a non-empty string');
  }
  if (!config.defaultLocale || typeof config.defaultLocale !== 'string') {
    throw new Error('vite-bundled-i18n: defaultLocale must be a non-empty string');
  }
  if (!Array.isArray(config.supportedLocales) || config.supportedLocales.length === 0) {
    throw new Error('vite-bundled-i18n: supportedLocales must be a non-empty array');
  }
  if (!config.supportedLocales.includes(config.defaultLocale)) {
    throw new Error(
      `vite-bundled-i18n: defaultLocale "${config.defaultLocale}" must be included in supportedLocales`,
    );
  }

  const store = createStore();
  const frozenConfig = Object.freeze({ ...config });
  const i18nBase = resolveI18nBase(config);
  const runtimeCache = resolveRuntimeCache(config);
  // Derive manifest URL from publicBase when set — single source of truth for paths.
  // Resolution: explicit manifestUrl > derived from publicBase > build-injected value
  const compiledManifestUrl = config.compiled?.manifestUrl
    ?? (config.publicBase ? `${i18nBase}/compiled/manifest.js` : undefined)
    ?? getInjectedCompiledManifestUrl();
  const useCompiledRuntime = shouldUseCompiledRuntime(config, compiledManifestUrl);
  let compiledRuntimeActive = useCompiledRuntime;

  let currentLocale = config.locale;
  const localeListeners = new Set<(locale: string) => void>();

  /** Tracks which scopes have been loaded per locale. */
  const loadedScopes = new Set<string>();

  /** Tracks which named dictionaries have been loaded per locale. */
  const loadedDicts = new Set<string>();

  /** Key usage log for dev diagnostics. */
  const keyUsage: KeyUsageEntry[] = [];

  /** The current scope set by useI18n, used for key tracking. */
  let activeScope: string | undefined;
  /** Tracks whether a consolidated fetch error has been emitted. */
  let fetchErrorEmitted = false;

  /** Dedup set for dev-mode missing key warnings. */
  const warnedMissingKeys = new Set<string>();

  function handleFetchError(): void {
    if (!fetchErrorEmitted) {
      fetchErrorEmitted = true;
      console.error(
        'vite-bundled-i18n: Cannot load translations. ' +
        'Ensure __i18n assets are accessible at the configured base path. ' +
        'Are you running the Vite dev server, or have you built with the i18n plugin?'
      );
    }
  }

  let compiledManifestPromise: Promise<CompiledManifestModule | null> | null = null;
  const compiledLocaleMaps = new Map<string, CompiledTranslationMap>();

  function getCompiledLocaleMap(locale: string): CompiledTranslationMap {
    const existing = compiledLocaleMaps.get(locale);
    if (existing) return existing;
    const created = new Map<string, string>();
    compiledLocaleMaps.set(locale, created);
    return created;
  }

  async function getCompiledManifest(): Promise<CompiledManifestModule | null> {
    if (!useCompiledRuntime) return null;
    if (!compiledManifestUrl && !config.compiled?.loadManifest) return null;
    if (!compiledManifestPromise) {
      const manifestLoader = config.compiled?.loadManifest
        ? config.compiled.loadManifest
        : () => loadCompiledManifest(compiledManifestUrl!);
      compiledManifestPromise = manifestLoader().catch((error) => {
        compiledRuntimeActive = false;
        console.warn(
          `vite-bundled-i18n: Failed to load compiled manifest from "${compiledManifestUrl}". Falling back to JSON bundles.`,
          error,
        );
        return null;
      });
    }
    return compiledManifestPromise;
  }

  async function loadCompiledModule(
    locale: string,
    loader: (() => Promise<{ default: CompiledTranslationMap }>) | undefined,
  ): Promise<boolean> {
    if (!loader) return false;
    const module = await loader();
    const localeMap = getCompiledLocaleMap(locale);
    for (const [key, value] of module.default) {
      localeMap.set(key, value);
    }
    return true;
  }

  function clearLoadMarkersForNamespace(locale: string, namespace: string): void {
    for (const scopeKey of [...loadedScopes]) {
      const [scopeLocale, scope] = scopeKey.split(':');
      if (scopeLocale !== locale || !scope) continue;
      const scopeNamespace = scope.includes('.') ? scope.slice(0, scope.indexOf('.')) : scope;
      if (scopeNamespace === namespace) {
        loadedScopes.delete(scopeKey);
      }
    }

    for (const dictKey of [...loadedDicts]) {
      const [dictLocale, dictName] = dictKey.split(':');
      if (dictLocale !== locale || !dictName) continue;
      const dict = config.dictionaries?.[dictName];
      if ((dict?.keys ?? []).includes(namespace)) {
        loadedDicts.delete(dictKey);
      }
    }
  }

  function clearLoadMarkersForLocale(locale: string): void {
    for (const scopeKey of [...loadedScopes]) {
      if (scopeKey.startsWith(`${locale}:`)) {
        loadedScopes.delete(scopeKey);
      }
    }
    for (const dictKey of [...loadedDicts]) {
      if (dictKey.startsWith(`${locale}:`)) {
        loadedDicts.delete(dictKey);
      }
    }
  }

  function evictUnused(): void {
    if (runtimeCache.strategy === 'none' || runtimeCache.eviction === 'none') {
      return;
    }

    const entries = store.getEntries();
    const nonPinned = entries
      .filter((entry) => !entry.pinned)
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
          const previous = localeCandidates.get(entry.locale) ?? Number.POSITIVE_INFINITY;
          localeCandidates.set(entry.locale, Math.min(previous, entry.lastAccessedAt));
        }

        const localeToEvict = [...localeCandidates.entries()]
          .filter(([locale]) => locale !== currentLocale)
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
  }

  /**
   * Resolves a fully qualified key against the store, with fallback chain.
   * Records the resolution in the key usage log for dev diagnostics.
   */
  function translate(
    locale: string,
    key: string,
    params?: Record<string, unknown>,
    fallback?: string,
  ): string {
    if (compiledRuntimeActive) {
      recordUsage(key, inferNamespace(key), locale, 'primary');
      return compiledTranslateFromMap(getCompiledLocaleMap(locale), key, params, fallback);
    }

    const namespace = inferNamespace(key);
    const subkey = extractSubkey(key);

    if (!subkey) {
      recordUsage(key, namespace, locale, 'fallback-string');
      if (fallback !== undefined) return interpolate(fallback, params);
      return key;
    }

    // Try requested locale
    const data = store.getResource(locale, namespace);
    if (data) {
      const value = resolveKey(data, subkey);
      if (value !== undefined) {
        recordUsage(key, namespace, locale, 'primary');
        return interpolate(value, params);
      }
    }

    // Fallback to default locale
    if (locale !== config.defaultLocale) {
      const fallbackData = store.getResource(config.defaultLocale, namespace);
      if (fallbackData) {
        const value = resolveKey(fallbackData, subkey);
        if (value !== undefined) {
          recordUsage(key, namespace, locale, 'fallback-locale');
          return interpolate(value, params);
        }
      }
    }

    // Return fallback string or key
    if (fallback !== undefined) {
      recordUsage(key, namespace, locale, 'fallback-string');
      return interpolate(fallback, params);
    }

    recordUsage(key, namespace, locale, 'key-as-value');
    if (import.meta.env?.DEV && !warnedMissingKeys.has(key)) {
      warnedMissingKeys.add(key);
      console.warn(
        `vite-bundled-i18n: Missing translation for "${key}" in locale "${locale}". Returning key as fallback.`
      );
    }
    return key;
  }

  /** Records a key lookup for dev diagnostics. */
  function recordUsage(
    key: string,
    namespace: string,
    locale: string,
    resolvedFrom: KeyUsageEntry['resolvedFrom'],
  ): void {
    keyUsage.push({ key, namespace, locale, resolvedFrom, scope: activeScope });
  }

  function hasKey(locale: string, key: string): boolean {
    if (compiledRuntimeActive) {
      return compiledHasKeyInMap(getCompiledLocaleMap(locale), key);
    }

    const namespace = inferNamespace(key);
    const subkey = extractSubkey(key);
    if (!subkey) return false;

    const data = store.getResource(locale, namespace);
    if (!data) return false;
    return resolveKey(data, subkey) !== undefined;
  }

  function tryTranslate(
    locale: string,
    key: string,
    params?: Record<string, unknown>,
  ): string | undefined {
    if (compiledRuntimeActive) {
      return compiledTryTranslateFromMap(getCompiledLocaleMap(locale), key, params);
    }

    const namespace = inferNamespace(key);
    const subkey = extractSubkey(key);
    if (!subkey) return undefined;

    const data = store.getResource(locale, namespace);
    if (data) {
      const value = resolveKey(data, subkey);
      if (value !== undefined) {
        return interpolate(value, params);
      }
    }

    if (locale !== config.defaultLocale) {
      const fallbackData = store.getResource(config.defaultLocale, namespace);
      if (fallbackData) {
        const value = resolveKey(fallbackData, subkey);
        if (value !== undefined) {
          return interpolate(value, params);
        }
      }
    }

    return undefined;
  }

  /**
   * Loads a single named dictionary bundle for a locale.
   * Fetches `/__i18n/{locale}/_dict/{name}.json` — one HTTP request
   * containing all namespaces for that dictionary.
   */
  async function loadDictionary(locale: string, name: string): Promise<void> {
    const dictKey = `${locale}:${name}`;
    if (loadedDicts.has(dictKey)) return;

    const dictConfig = config.dictionaries?.[name];
    if (!dictConfig) return;

    try {
      if (compiledRuntimeActive) {
        const manifest = await getCompiledManifest();
        const loaded = await loadCompiledModule(locale, manifest?.dictionaries?.[name]?.[locale]);
        if (loaded) {
          loadedDicts.add(dictKey);
          return;
        }
      }

      const reqInit = await resolveRequestInit(config.requestInit);
      const bundle = await fetchBundle(i18nBase, locale, `_dict/${name}`, reqInit);
      for (const [namespace, data] of Object.entries(bundle)) {
        store.addResources(locale, namespace, data, {
          source: 'dictionary',
          pinned: runtimeCache.pinDictionaries,
        });
      }
      loadedDicts.add(dictKey);
      evictUnused();
    } catch {
      handleFetchError();
    }
  }

  /**
   * Loads all configured dictionaries for a locale, in declaration order.
   * Each dictionary is one HTTP request.
   */
  async function loadAllDictionaries(locale: string): Promise<void> {
    if (!config.dictionaries) return;

    // Load in declaration order, sequentially (priority matters)
    for (const name of Object.keys(config.dictionaries)) {
      await loadDictionary(locale, name);
    }
  }

  /**
   * Loads a page/scope bundle for a locale.
   * Fetches `/__i18n/{locale}/{scope}.json` — one HTTP request
   * containing all namespaces needed by that page.
   */
  async function loadScope(locale: string, scope: string): Promise<void> {
    const scopeKey = `${locale}:${scope}`;
    if (loadedScopes.has(scopeKey)) return;

    try {
      if (compiledRuntimeActive) {
        const manifest = await getCompiledManifest();
        const loaded = await loadCompiledModule(locale, manifest?.scopes?.[scope]?.[locale]);
        if (loaded) {
          loadedScopes.add(scopeKey);
          return;
        }
      }

      const reqInit = await resolveRequestInit(config.requestInit);
      const bundle = await fetchBundle(i18nBase, locale, scope, reqInit);
      for (const [namespace, data] of Object.entries(bundle)) {
        store.addResources(locale, namespace, data, {
          source: 'scope',
          pinned: false,
        });
      }
      loadedScopes.add(scopeKey);
      evictUnused();
    } catch {
      handleFetchError();
    }
  }

  /**
   * Loads namespace files individually. Kept for testing and non-plugin usage.
   */
  async function loadNamespaces(
    locale: string,
    namespaces: string[],
  ): Promise<void> {
    for (const ns of namespaces) {
      if (!store.hasNamespace(locale, ns)) {
        try {
          const reqInit = await resolveRequestInit(config.requestInit);
          const data = await fetchNamespace(
            config.localesDir,
            locale,
            ns,
            reqInit,
          );
          store.addResources(locale, ns, data, {
            source: 'manual',
            pinned: false,
          });
          evictUnused();
        } catch {
          handleFetchError();
        }
      }
    }
  }

  function addResources(
    locale: string,
    namespace: string,
    data: NestedTranslations,
  ): void {
    store.addResources(locale, namespace, data, {
      source: 'manual',
      pinned: false,
    });
    evictUnused();
  }

  function getResource(locale: string, namespace: string): NestedTranslations | undefined {
    if (compiledRuntimeActive) {
      const localeMap = compiledLocaleMaps.get(locale);
      if (!localeMap) return undefined;
      const prefix = `${namespace}.`;
      const nested: NestedTranslations = {};
      let found = false;

      for (const [key, value] of localeMap.entries()) {
        if (!key.startsWith(prefix)) continue;
        found = true;
        const parts = key.slice(prefix.length).split('.');
        let current: NestedTranslations = nested;
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          const next = current[part];
          if (!next || typeof next === 'string') {
            current[part] = {};
          }
          current = current[part] as NestedTranslations;
        }
        current[parts[parts.length - 1]] = value;
      }

      return found ? nested : undefined;
    }

    return store.getResource(locale, namespace);
  }

  function getLoadedNamespaces(locale: string): string[] {
    if (compiledRuntimeActive) {
      const localeMap = compiledLocaleMaps.get(locale);
      if (!localeMap) return [];
      return [...new Set([...localeMap.keys()].map((key) => inferNamespace(key)))];
    }

    return store.getEntries()
      .filter((entry) => entry.locale === locale)
      .map((entry) => entry.namespace);
  }

  function isNamespaceLoaded(locale: string, namespace: string): boolean {
    if (compiledRuntimeActive) {
      return getLoadedNamespaces(locale).includes(namespace);
    }
    return store.hasNamespace(locale, namespace);
  }

  function isScopeLoaded(locale: string, scope: string): boolean {
    return loadedScopes.has(`${locale}:${scope}`);
  }

  function getCacheStats() {
    if (compiledRuntimeActive) {
      const totalLocales = compiledLocaleMaps.size;
      const totalNamespaces = new Set(
        [...compiledLocaleMaps.values()].flatMap((map) =>
          [...map.keys()].map((key) => inferNamespace(key)),
        ),
      ).size;
      const approxTotalBytes = [...compiledLocaleMaps.values()].reduce(
        (sum, map) =>
          sum + [...map.entries()].reduce((inner, [key, value]) => inner + key.length + value.length, 0),
        0,
      );

      return {
        totalLocales,
        totalNamespaces,
        approxTotalBytes,
        pinnedNamespaces: 0,
        loadedScopes: loadedScopes.size,
        loadedDictionaries: loadedDicts.size,
      };
    }

    const stats = store.getStats();
    return {
      ...stats,
      loadedScopes: loadedScopes.size,
      loadedDictionaries: loadedDicts.size,
    };
  }

  function unloadLocale(locale: string): void {
    if (compiledRuntimeActive) {
      compiledLocaleMaps.delete(locale);
      clearLoadMarkersForLocale(locale);
      return;
    }
    store.removeLocale(locale);
    clearLoadMarkersForLocale(locale);
  }

  function unloadNamespace(locale: string, namespace: string): void {
    if (compiledRuntimeActive) {
      const localeMap = compiledLocaleMaps.get(locale);
      if (localeMap) {
        for (const key of [...localeMap.keys()]) {
          if (key === namespace || key.startsWith(`${namespace}.`)) {
            localeMap.delete(key);
          }
        }
      }
      clearLoadMarkersForNamespace(locale, namespace);
      return;
    }
    store.removeNamespace(locale, namespace);
    clearLoadMarkersForNamespace(locale, namespace);
  }

  function getDictionaryNamespaces(): string[] {
    if (!config.dictionaries) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const dict of Object.values(config.dictionaries)) {
      const patterns = [
        ...(dict.keys ?? []),
        ...((dict.include ?? []).map((pattern) => {
          const namespacePart = pattern.split('.')[0];
          return namespacePart.endsWith('*') ? namespacePart.slice(0, -1) : namespacePart;
        })),
      ];
      for (const ns of patterns) {
        if (!seen.has(ns)) {
          seen.add(ns);
          result.push(ns);
        }
      }
    }
    return result;
  }

  function getDictionaryNames(): string[] {
    if (!config.dictionaries) return [];
    return Object.keys(config.dictionaries);
  }

  function getLocale(): string {
    return currentLocale;
  }

  /**
   * Switches the active locale. Loads all dictionaries and previously
   * loaded scopes for the new locale before notifying listeners.
   */
  async function changeLocale(locale: string): Promise<void> {
    if (locale === currentLocale) return;

    if (compiledRuntimeActive) {
      compiledLocaleMaps.delete(locale);
    }

    // Load all dictionaries for the new locale (one request per dictionary)
    await loadAllDictionaries(locale);

    // Reload all previously loaded scopes for the new locale
    const uniqueScopes = new Set<string>();
    for (const scopeKey of loadedScopes) {
      const colonIdx = scopeKey.indexOf(':');
      if (colonIdx !== -1) {
        uniqueScopes.add(scopeKey.slice(colonIdx + 1));
      }
    }
    await Promise.all(
      [...uniqueScopes].map((scope) => loadScope(locale, scope)),
    );

    currentLocale = locale;
    for (const listener of localeListeners) {
      listener(locale);
    }
  }

  function onLocaleChange(callback: (locale: string) => void): () => void {
    localeListeners.add(callback);
    return () => {
      localeListeners.delete(callback);
    };
  }

  function getKeyUsage(): KeyUsageEntry[] {
    return keyUsage;
  }

  return {
    config: frozenConfig,
    translate,
    tryTranslate,
    hasKey,
    loadNamespaces,
    loadDictionary,
    loadAllDictionaries,
    loadScope,
    addResources,
    getResource,
    getLoadedNamespaces,
    isNamespaceLoaded,
    isScopeLoaded,
    getCacheStats,
    unloadLocale,
    unloadNamespace,
    evictUnused,
    getDictionaryNamespaces,
    getDictionaryNames,
    getLocale,
    changeLocale,
    onLocaleChange,
    getKeyUsage,
  };
}
