import type { DictionaryConfig } from '../types';
import type { CacheManager } from './cache-manager';
import {
  buildBundlePath,
  buildLoadPath,
  fetchBundleFromUrl,
  fetchNamespaceFromUrl,
} from '../fetcher';
import { resolveRequestInit } from '../createI18n';
import { inferNamespace } from '../resolver';

// ---------------------------------------------------------------------------
// Types / interfaces
// ---------------------------------------------------------------------------

/** Subset of the full i18n config needed by the bundle loader. */
export interface BundleLoaderConfig {
  /** Current active locale code. */
  locale: string;
  /** Fallback locale used when a key is missing in the active locale. */
  defaultLocale: string;
  /** Path to the directory containing locale folders (e.g., `'/locales'`). */
  localesDir: string;
  /** Named dictionary definitions. */
  dictionaries?: Record<string, DictionaryConfig>;
  /**
   * Custom options passed to every `fetch()` call made by the loader.
   * May be a static object or a (possibly async) factory function.
   */
  requestInit?: RequestInit | (() => RequestInit | Promise<RequestInit>);
  /**
   * Custom URL resolver for all translation fetches.
   *
   * @param locale - The locale being fetched.
   * @param type - The bundle type.
   * @param name - The resource name.
   * @returns The URL to fetch from.
   */
  resolveUrl?: (
    locale: string,
    type: 'dictionary' | 'scope' | 'namespace' | 'manifest',
    name: string,
  ) => string;
}

/**
 * Optional compiled-runtime loader that the orchestrator can provide.
 *
 * When the loader returns `true` for a given resource, the BundleLoader
 * skips the fetch path entirely.
 */
export interface CompiledLoader {
  /**
   * Attempt to load a compiled dictionary module.
   *
   * @param locale - Target locale code.
   * @param name - Dictionary name.
   * @returns `true` when the compiled module was loaded successfully.
   */
  loadDictionary(locale: string, name: string): Promise<boolean>;
  /**
   * Attempt to load a compiled scope module.
   *
   * @param locale - Target locale code.
   * @param scope - Scope identifier.
   * @returns `true` when the compiled module was loaded successfully.
   */
  loadScope(locale: string, scope: string): Promise<boolean>;
}

/**
 * Handles all translation fetch orchestration: dictionary loading, scope
 * loading, namespace loading, and request deduplication.
 */
export interface BundleLoader {
  /**
   * Load a single named dictionary bundle for a locale.
   *
   * Fetches `/{i18nBase}/{locale}/_dict/{name}.json` — one HTTP request
   * containing all namespaces for that dictionary. Deduplicates concurrent
   * calls for the same dictionary.
   *
   * @param locale - Target locale code.
   * @param name - Dictionary name from the config.
   */
  loadDictionary(locale: string, name: string): Promise<void>;

  /**
   * Load all configured dictionaries for a locale, in declaration order.
   *
   * Each dictionary is one HTTP request. Dictionaries are loaded sequentially
   * so that priority ordering is respected.
   *
   * @param locale - Target locale code.
   */
  loadAllDictionaries(locale: string): Promise<void>;

  /**
   * Load a page/scope bundle for a locale.
   *
   * Fetches `/{i18nBase}/{locale}/{scope}.json` — one HTTP request
   * containing all namespaces needed by that page. In dev namespace mode,
   * the URL uses `/_scope/{namespace}` instead. Deduplicates concurrent calls.
   *
   * @param locale - Target locale code.
   * @param scope - Scope identifier (e.g. `"products"` or `"products.show"`).
   */
  loadScope(locale: string, scope: string): Promise<void>;

  /**
   * Load namespace JSON files individually for a locale.
   *
   * Fetches each namespace from `{localesDir}/{locale}/{namespace}.json`.
   * Skips namespaces already present in the cache.
   *
   * @param locale - Target locale code.
   * @param namespaces - Array of namespace names to load.
   */
  loadNamespaces(locale: string, namespaces: string[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new {@link BundleLoader} instance.
 *
 * The loader handles all translation fetch orchestration: dictionary loading,
 * scope loading, namespace loading, compiled-module delegation, and request
 * deduplication. It delegates cache storage to the provided {@link CacheManager}.
 *
 * @param config - Loader configuration subset (locale, dictionaries, etc.).
 * @param cache - The cache manager that stores loaded translations.
 * @param i18nBase - Base path for translation bundle URLs (e.g. `'/__i18n'`).
 * @param options - Optional flags and callbacks.
 * @param options.devNamespaceMode - When `true`, scope bundles use `/_scope/{namespace}` URLs.
 * @param options.compiledLoader - Optional compiled-runtime loader to try before fetching.
 * @param options.onFetchError - Called once on the first fetch failure.
 * @param options.pinDictionaries - Whether dictionary namespaces should be pinned in cache.
 * @returns A configured {@link BundleLoader}.
 */
export function createBundleLoader(
  config: BundleLoaderConfig,
  cache: CacheManager,
  i18nBase: string,
  options: {
    devNamespaceMode?: boolean;
    compiledLoader?: CompiledLoader;
    onFetchError?: () => void;
    pinDictionaries?: boolean;
  } = {},
): BundleLoader {
  const devNamespaceMode = options.devNamespaceMode ?? false;
  const pinDictionaries = options.pinDictionaries ?? true;

  /** Tracks whether the fetch-error callback has already been invoked. */
  let fetchErrorEmitted = false;

  /** In-flight dictionary load promises, keyed by `{locale}:{name}`. */
  const inFlightDictionaryLoads = new Map<string, Promise<void>>();

  /** In-flight scope load promises, keyed by `{locale}:{scope}`. */
  const inFlightScopeLoads = new Map<string, Promise<void>>();

  // -- Internal helpers ------------------------------------------------------

  /**
   * Invoke the `onFetchError` callback at most once.
   */
  function handleFetchError(): void {
    if (!fetchErrorEmitted && options.onFetchError) {
      fetchErrorEmitted = true;
      options.onFetchError();
    }
  }

  // -- Load methods ----------------------------------------------------------

  async function loadDictionary(locale: string, name: string): Promise<void> {
    const dictKey = `${locale}:${name}`;
    if (cache.isDictionaryLoaded(locale, name)) return;

    const inFlight = inFlightDictionaryLoads.get(dictKey);
    if (inFlight) return inFlight;

    const dictConfig = config.dictionaries?.[name];
    if (!dictConfig) return;

    const loadPromise = (async () => {
      try {
        // Try compiled runtime first
        if (options.compiledLoader) {
          const loaded = await options.compiledLoader.loadDictionary(locale, name);
          if (loaded) {
            cache.markDictionaryLoaded(locale, name);
            return;
          }
        }

        const reqInit = await resolveRequestInit(config.requestInit);
        const url = config.resolveUrl
          ? config.resolveUrl(locale, 'dictionary', name)
          : buildBundlePath(i18nBase, locale, `_dict/${name}`);
        const bundle = await fetchBundleFromUrl(url, reqInit);

        for (const [namespace, data] of Object.entries(bundle)) {
          cache.addResources(locale, namespace, data, {
            source: 'dictionary',
            pinned: pinDictionaries,
          });
        }
        cache.markDictionaryLoaded(locale, name);
        cache.evictUnused(locale);
      } catch {
        handleFetchError();
      }
    })().finally(() => {
      inFlightDictionaryLoads.delete(dictKey);
    });

    inFlightDictionaryLoads.set(dictKey, loadPromise);
    return loadPromise;
  }

  async function loadAllDictionaries(locale: string): Promise<void> {
    if (!config.dictionaries) return;

    // Load in declaration order, sequentially (priority matters)
    for (const name of Object.keys(config.dictionaries)) {
      await loadDictionary(locale, name);
    }
  }

  async function loadScope(locale: string, scope: string): Promise<void> {
    const scopeKey = `${locale}:${scope}`;
    const namespace = inferNamespace(scope);

    if (cache.isScopeLoaded(locale, scope)) return;

    // In dev namespace mode, reuse an already-loaded namespace
    if (devNamespaceMode && cache.isNamespaceLoaded(locale, namespace)) {
      cache.markScopeLoaded(locale, scope, true);
      return;
    }

    const inFlight = inFlightScopeLoads.get(scopeKey);
    if (inFlight) return inFlight;

    const loadPromise = (async () => {
      try {
        // Try compiled runtime first
        if (options.compiledLoader) {
          const loaded = await options.compiledLoader.loadScope(locale, scope);
          if (loaded) {
            cache.markScopeLoaded(locale, scope, true);
            return;
          }
        }

        const reqInit = await resolveRequestInit(config.requestInit);
        const url = config.resolveUrl
          ? config.resolveUrl(locale, 'scope', scope)
          : buildBundlePath(
            i18nBase,
            locale,
            devNamespaceMode ? `_scope/${namespace}` : scope,
          );
        const bundle = await fetchBundleFromUrl(url, reqInit);

        for (const [ns, data] of Object.entries(bundle)) {
          cache.addResources(locale, ns, data, {
            source: 'scope',
            pinned: false,
          });
        }
        cache.markScopeLoaded(locale, scope, true);
        cache.evictUnused(locale);
      } catch {
        handleFetchError();
      }
    })().finally(() => {
      inFlightScopeLoads.delete(scopeKey);
    });

    inFlightScopeLoads.set(scopeKey, loadPromise);
    return loadPromise;
  }

  async function loadNamespaces(
    locale: string,
    namespaces: string[],
  ): Promise<void> {
    for (const ns of namespaces) {
      if (!cache.isNamespaceLoaded(locale, ns)) {
        try {
          const reqInit = await resolveRequestInit(config.requestInit);
          const nsUrl = config.resolveUrl
            ? config.resolveUrl(locale, 'namespace', ns)
            : buildLoadPath(config.localesDir, locale, ns);
          const data = await fetchNamespaceFromUrl(nsUrl, reqInit);
          cache.addResources(locale, ns, data, {
            source: 'manual',
            pinned: false,
          });
          cache.evictUnused(locale);
        } catch {
          handleFetchError();
        }
      }
    }
  }

  // -- Public interface ------------------------------------------------------

  return {
    loadDictionary,
    loadAllDictionaries,
    loadScope,
    loadNamespaces,
  };
}
