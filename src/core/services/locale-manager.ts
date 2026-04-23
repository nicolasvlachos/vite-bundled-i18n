import type { BundleLoader } from './bundle-loader';
import type { CacheManager } from './cache-manager';

// ---------------------------------------------------------------------------
// Types / interfaces
// ---------------------------------------------------------------------------

/**
 * Manages the active locale, orchestrates locale changes (loading all
 * required bundles for the new locale), and handles HMR resource reloading.
 */
export interface LocaleManager {
  /**
   * Return the currently active locale code.
   *
   * @returns The active locale string.
   */
  getLocale(): string;

  /**
   * Switch the active locale.
   *
   * Loads all dictionaries for the new locale, then reloads every scope that
   * was previously loaded under the old locale. Listeners are notified after
   * all resources are ready.
   *
   * If the requested locale is already active, this is a no-op.
   *
   * @param locale - The locale code to switch to.
   */
  changeLocale(locale: string): Promise<void>;

  /**
   * Subscribe to locale-change events.
   *
   * @param callback - Invoked with the new locale code after every change.
   * @returns A function that removes the listener.
   */
  onLocaleChange(callback: (locale: string) => void): () => void;

  /**
   * Reload all currently loaded resources for a locale.
   *
   * Unloads the locale from the cache, then reloads every dictionary
   * sequentially and every scope in parallel. Resource-change events are
   * suppressed during the reload and a single event is emitted at the end.
   *
   * @param locale - The locale code whose resources should be reloaded.
   */
  reloadResources(locale: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new {@link LocaleManager} instance.
 *
 * The manager tracks the active locale, orchestrates locale switches by
 * loading all required bundles through the {@link BundleLoader}, and provides
 * HMR-friendly resource reloading via the {@link CacheManager}.
 *
 * @param initialLocale - The locale code to start with.
 * @param loader - The bundle loader used to fetch dictionaries and scopes.
 * @param cache - The cache manager used to query and invalidate loaded resources.
 * @returns A configured {@link LocaleManager}.
 */
export function createLocaleManager(
  initialLocale: string,
  loader: BundleLoader,
  cache: CacheManager,
): LocaleManager {
  let currentLocale = initialLocale;
  const localeListeners = new Set<(locale: string) => void>();

  function getLocale(): string {
    return currentLocale;
  }

  async function changeLocale(locale: string): Promise<void> {
    if (locale === currentLocale) return;

    // Load all dictionaries for the new locale
    await loader.loadAllDictionaries(locale);

    // Reload previously loaded scopes for the new locale.
    // Individual scope failures are caught so one broken scope doesn't
    // block the entire locale switch.
    const previousScopes = cache.getLoadedScopes(currentLocale);
    if (previousScopes.length > 0) {
      await Promise.allSettled(
        previousScopes.map((scope) => loader.loadScope(locale, scope)),
      );
    }

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

  async function reloadResources(locale: string): Promise<void> {
    const dictionaries = cache.getLoadedDictionaries(locale);
    const scopes = cache.getLoadedScopes(locale);

    if (dictionaries.length === 0 && scopes.length === 0) return;

    cache.suppressEvents();
    try {
      cache.unloadLocale(locale);

      for (const dictionary of dictionaries) {
        await loader.loadDictionary(locale, dictionary);
      }

      await Promise.allSettled(scopes.map((scope) => loader.loadScope(locale, scope)));
    } finally {
      cache.resumeEvents();
    }
  }

  return {
    getLocale,
    changeLocale,
    onLocaleChange,
    reloadResources,
  };
}
