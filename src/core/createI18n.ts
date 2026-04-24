import type { I18nConfig, I18nInstance, NestedTranslations } from './types';
import { resolveKey, inferNamespace, extractSubkey } from './resolver';
import { interpolate } from './interpolator';
import {
  compiledHasKeyInMap,
  compiledTryTranslateFromMap,
  loadCompiledManifest,
  type CompiledManifestModule,
  type CompiledTranslationMap,
} from './compiled-runtime';
import {
  getDefinedDevFlag,
  getHmrClient,
  I18N_DEV_UPDATE_EVENT,
  isDevRuntime,
  type I18nDevUpdatePayload,
} from './runtime-env';
import { createKeyTracker } from './services/key-tracker';
import { createCacheManager } from './services/cache-manager';
import { createBundleLoader, type CompiledLoader } from './services/bundle-loader';
import { createLocaleManager } from './services/locale-manager';

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Internal config helpers
// ---------------------------------------------------------------------------

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
  if (isDevRuntime()) return false;
  if (config.compiled?.enabled === 'auto') return !!manifestUrl;
  return !!manifestUrl;
}

/** Whether dev-namespace scope bundles should be used (dev mode without resolveUrl). */
function shouldUseDevNamespaceScopeBundles(config: I18nConfig): boolean {
  if (config.resolveUrl) return false;
  return getDefinedDevFlag() === true;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates and configures an i18n instance.
 *
 * This is the main entry point for setting up translations. It assembles
 * four internal services — {@link createKeyTracker KeyTracker},
 * {@link createCacheManager CacheManager}, {@link createBundleLoader BundleLoader},
 * and {@link createLocaleManager LocaleManager} — into a single
 * {@link I18nInstance} with a unified API.
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
  // -- Config validation ------------------------------------------------------

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

  const frozenConfig = Object.freeze({ ...config });
  const i18nBase = resolveI18nBase(config);
  const devNamespaceMode = shouldUseDevNamespaceScopeBundles(config);

  // -- Compiled runtime setup -------------------------------------------------

  // Derive manifest URL. Resolution order:
  // 1. resolveUrl callback (if provided)
  // 2. explicit compiled.manifestUrl
  // 3. derived from publicBase
  // 4. build-injected __VITE_I18N_COMPILED_MANIFEST__
  const compiledManifestUrl = config.resolveUrl
    ? config.resolveUrl(config.locale, 'manifest', 'manifest')
    : (config.compiled?.manifestUrl
      ?? (config.publicBase ? `${i18nBase}/compiled/manifest.js` : undefined)
      ?? getInjectedCompiledManifestUrl());
  const useCompiledRuntime = shouldUseCompiledRuntime(config, compiledManifestUrl);
  let compiledRuntimeActive = useCompiledRuntime;

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

  // -- Create services --------------------------------------------------------

  const keyTracker = createKeyTracker(isDevRuntime());

  const cache = createCacheManager(
    { dictionaries: config.dictionaries, cache: config.cache },
    { devNamespaceMode },
  );

  // Build a compiled loader bridge that the BundleLoader can use
  // to try compiled modules before falling back to fetch.
  const compiledLoader: CompiledLoader | undefined = useCompiledRuntime
    ? {
        async loadDictionary(locale: string, name: string): Promise<boolean> {
          const manifest = await getCompiledManifest();
          return loadCompiledModule(locale, manifest?.dictionaries?.[name]?.[locale]);
        },
        async loadScope(locale: string, scope: string): Promise<boolean> {
          const manifest = await getCompiledManifest();
          return loadCompiledModule(locale, manifest?.scopes?.[scope]?.[locale]);
        },
      }
    : undefined;

  /** Tracks whether a consolidated fetch error has been emitted. */
  let fetchErrorEmitted = false;

  const loader = createBundleLoader(
    {
      locale: config.locale,
      defaultLocale: config.defaultLocale,
      localesDir: config.localesDir,
      dictionaries: config.dictionaries,
      requestInit: config.requestInit,
      resolveUrl: config.resolveUrl,
    },
    cache,
    i18nBase,
    {
      devNamespaceMode,
      compiledLoader,
      onFetchError() {
        if (!fetchErrorEmitted) {
          fetchErrorEmitted = true;
          console.error(
            'vite-bundled-i18n: Cannot load translations. ' +
            'Ensure __i18n assets are accessible at the configured base path. ' +
            'Are you running the Vite dev server, or have you built with the i18n plugin?'
          );
        }
      },
      pinDictionaries: (() => {
        const runtime = config.cache?.runtime;
        if (runtime === 'none') return false;
        if (runtime === 'memory' || runtime == null) return true;
        return runtime.pinDictionaries ?? true;
      })(),
    },
  );

  const localeManager = createLocaleManager(config.locale, loader, cache);

  // -- Warning suppression for loading scopes --------------------------------

  /** Scopes currently being loaded by useI18n hooks. */
  const loadingScopes = new Set<string>();

  /**
   * The scope the host adapter is currently rendering under, if any. Set by
   * {@link I18nInstance.setActiveScope} (called by `useI18n(scope)` on every
   * render and by `getTranslations(instance, scope)`). Annotated onto every
   * {@link KeyUsageEntry.scope} so the devtools panel can filter stale
   * entries from other routes without waiting for a locale change.
   */
  let activeScope: string | undefined;

  /**
   * Check if a key belongs to a scope that's currently loading.
   * If so, the missing-key warning should be suppressed.
   */
  function isKeyInLoadingScope(key: string): boolean {
    if (loadingScopes.size === 0) return false;
    for (const scope of loadingScopes) {
      // A scope like 'products.index' covers keys starting with 'products.'
      const ns = scope.indexOf('.') === -1 ? scope : scope.slice(0, scope.indexOf('.'));
      if (key.startsWith(`${ns}.`)) return true;
    }
    return false;
  }

  // -- Translate / hasKey (orchestrator owns these) ---------------------------

  /**
   * Resolves a fully qualified key against the cache, with fallback chain.
   * When compiled runtime is active, delegates to the compiled map instead.
   * Records the resolution in the key tracker for dev diagnostics.
   */
  function translate(
    locale: string,
    key: string,
    params?: Record<string, unknown>,
    fallback?: string,
  ): string {
    if (compiledRuntimeActive) {
      const namespace = inferNamespace(key);
      // Try requested locale
      const primaryValue = compiledTryTranslateFromMap(getCompiledLocaleMap(locale), key, params);
      if (primaryValue !== undefined) {
        keyTracker.recordUsage(key, namespace, locale, 'primary', activeScope);
        return primaryValue;
      }
      // Fallback to default locale (same chain as JSON mode)
      if (locale !== config.defaultLocale) {
        const fallbackValue = compiledTryTranslateFromMap(getCompiledLocaleMap(config.defaultLocale), key, params);
        if (fallbackValue !== undefined) {
          keyTracker.recordUsage(key, namespace, locale, 'fallback-locale', activeScope);
          return fallbackValue;
        }
      }
      // Fallback string or key
      if (fallback !== undefined) {
        keyTracker.recordUsage(key, namespace, locale, 'fallback-string', activeScope);
        return interpolate(fallback, params);
      }
      if (!isKeyInLoadingScope(key)) {
        keyTracker.recordUsage(key, namespace, locale, 'key-as-value', activeScope);
        keyTracker.warnMissing(key, locale);
      }
      return key;
    }

    const namespace = inferNamespace(key);
    const subkey = extractSubkey(key);

    if (!subkey) {
      keyTracker.recordUsage(key, namespace, locale, 'fallback-string', activeScope);
      if (fallback !== undefined) return interpolate(fallback, params);
      return key;
    }

    // Try requested locale
    const data = cache.getResource(locale, namespace);
    if (data) {
      const value = resolveKey(data, subkey);
      if (value !== undefined) {
        keyTracker.recordUsage(key, namespace, locale, 'primary', activeScope);
        return interpolate(value, params);
      }
    }

    // Fallback to default locale
    if (locale !== config.defaultLocale) {
      const fallbackData = cache.getResource(config.defaultLocale, namespace);
      if (fallbackData) {
        const value = resolveKey(fallbackData, subkey);
        if (value !== undefined) {
          keyTracker.recordUsage(key, namespace, locale, 'fallback-locale', activeScope);
          return interpolate(value, params);
        }
      }
    }

    // Return fallback string or key
    if (fallback !== undefined) {
      keyTracker.recordUsage(key, namespace, locale, 'fallback-string', activeScope);
      return interpolate(fallback, params);
    }

    if (!isKeyInLoadingScope(key)) {
      keyTracker.recordUsage(key, namespace, locale, 'key-as-value', activeScope);
      keyTracker.warnMissing(key, locale);
    }
    return key;
  }

  function tryTranslate(
    locale: string,
    key: string,
    params?: Record<string, unknown>,
  ): string | undefined {
    if (compiledRuntimeActive) {
      const value = compiledTryTranslateFromMap(getCompiledLocaleMap(locale), key, params);
      if (value !== undefined) return value;
      // Fallback to default locale
      if (locale !== config.defaultLocale) {
        return compiledTryTranslateFromMap(getCompiledLocaleMap(config.defaultLocale), key, params);
      }
      return undefined;
    }

    const namespace = inferNamespace(key);
    const subkey = extractSubkey(key);
    if (!subkey) return undefined;

    const data = cache.getResource(locale, namespace);
    if (data) {
      const value = resolveKey(data, subkey);
      if (value !== undefined) {
        return interpolate(value, params);
      }
    }

    if (locale !== config.defaultLocale) {
      const fallbackData = cache.getResource(config.defaultLocale, namespace);
      if (fallbackData) {
        const value = resolveKey(fallbackData, subkey);
        if (value !== undefined) {
          return interpolate(value, params);
        }
      }
    }

    return undefined;
  }

  function hasKey(locale: string, key: string): boolean {
    if (compiledRuntimeActive) {
      return compiledHasKeyInMap(getCompiledLocaleMap(locale), key);
    }

    const namespace = inferNamespace(key);
    const subkey = extractSubkey(key);
    if (!subkey) return false;

    const data = cache.getResource(locale, namespace);
    if (!data) return false;
    return resolveKey(data, subkey) !== undefined;
  }

  // -- Compiled-runtime overlays for getResource / getLoadedNamespaces --------

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

    return cache.getResource(locale, namespace);
  }

  function getLoadedNamespaces(locale: string): string[] {
    if (compiledRuntimeActive) {
      const localeMap = compiledLocaleMaps.get(locale);
      if (!localeMap) return [];
      return [...new Set([...localeMap.keys()].map((key) => inferNamespace(key)))];
    }

    return cache.getLoadedNamespaces(locale);
  }

  function isNamespaceLoaded(locale: string, namespace: string): boolean {
    if (compiledRuntimeActive) {
      return getLoadedNamespaces(locale).includes(namespace);
    }
    return cache.isNamespaceLoaded(locale, namespace);
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
        loadedScopes: cache.getCacheStats().loadedScopes,
        loadedDictionaries: cache.getCacheStats().loadedDictionaries,
      };
    }

    return cache.getCacheStats();
  }

  // -- Unload with compiled-map cleanup --------------------------------------

  function unloadLocale(locale: string): void {
    if (compiledRuntimeActive) {
      compiledLocaleMaps.delete(locale);
    }
    cache.unloadLocale(locale);
    keyTracker.bumpEpoch();
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
    }
    cache.unloadNamespace(locale, namespace);
    keyTracker.bumpEpoch();
  }

  // -- changeLocale with compiled-map cleanup --------------------------------

  async function changeLocale(locale: string): Promise<void> {
    if (compiledRuntimeActive) {
      // Clear compiled data for the target locale so fresh modules are loaded
      compiledLocaleMaps.delete(locale);
    }
    keyTracker.bumpEpoch();
    await localeManager.changeLocale(locale);
  }

  // -- Public addResources with eviction ------------------------------------

  function addResources(
    locale: string,
    namespace: string,
    data: NestedTranslations,
  ): void {
    cache.addResources(locale, namespace, data, {
      source: 'manual',
      pinned: false,
    });
    cache.evictUnused(localeManager.getLocale());
  }

  // -- Dictionary namespace helpers ------------------------------------------

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

  // -- HMR wiring ------------------------------------------------------------

  const hmrClient = getHmrClient();

  const handleDevUpdate = (payload?: I18nDevUpdatePayload) => {
    const affectedLocales = payload?.locales;
    if (affectedLocales && affectedLocales.length > 0 && !affectedLocales.includes(localeManager.getLocale())) {
      return;
    }

    void localeManager.reloadResources(localeManager.getLocale());
  };

  hmrClient?.on?.(I18N_DEV_UPDATE_EVENT, handleDevUpdate);

  // Test-environment fallback: CustomEvent on window for HMR simulation
  if (typeof window !== 'undefined' && typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
    window.addEventListener(I18N_DEV_UPDATE_EVENT, (event: Event) => {
      const customEvent = event as CustomEvent<I18nDevUpdatePayload | undefined>;
      handleDevUpdate(customEvent.detail);
    });
  }

  // -- Return I18nInstance ----------------------------------------------------

  const instance: I18nInstance = {
    config: frozenConfig,
    translate,
    tryTranslate,
    hasKey,
    loadNamespaces: (locale, namespaces) => loader.loadNamespaces(locale, namespaces),
    loadDictionary: (locale, name) => loader.loadDictionary(locale, name),
    loadAllDictionaries: (locale) => loader.loadAllDictionaries(locale),
    loadScope: (locale, scope) => loader.loadScope(locale, scope),
    addResources,
    markScopeLoaded: (locale, scope) => cache.markScopeLoaded(locale, scope),
    markDictionaryLoaded: (locale, name) => cache.markDictionaryLoaded(locale, name),
    getResource,
    getLoadedNamespaces,
    getLoadedScopes: (locale) => cache.getLoadedScopes(locale),
    getLoadedDictionaries: (locale) => cache.getLoadedDictionaries(locale),
    isNamespaceLoaded,
    isScopeLoaded: (locale, scope) => cache.isScopeLoaded(locale, scope),
    getCacheStats,
    unloadLocale,
    unloadNamespace,
    evictUnused: () => cache.evictUnused(localeManager.getLocale()),
    getDictionaryNamespaces,
    getDictionaryNames: () => config.dictionaries ? Object.keys(config.dictionaries) : [],
    getLocale: () => localeManager.getLocale(),
    changeLocale,
    onLocaleChange: (callback) => localeManager.onLocaleChange(callback),
    onResourcesChange: (callback) => cache.onResourcesChange(callback),
    getKeyUsage: () => keyTracker.getKeyUsage(),
    getKeyUsageEpoch: () => keyTracker.getEpoch(),
    resetKeyUsage: () => keyTracker.reset(),
    getResidentKeyCount: (locale) => cache.getResidentKeyCount(locale),
    addLoadingScope(scope: string) {
      loadingScopes.add(scope);
      activeScope = scope;
    },
    removeLoadingScope(scope: string) {
      loadingScopes.delete(scope);
    },
    setActiveScope(scope: string | undefined) {
      activeScope = scope;
    },
  };

  return instance;
}
