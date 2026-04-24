import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBundleLoader, type BundleLoader } from '../../../core/services/bundle-loader';
import { createCacheManager, type CacheManager } from '../../../core/services/cache-manager';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

function failResponse(status = 500): Response {
  return jsonResponse({}, status);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG = {
  locale: 'en',
  defaultLocale: 'en',
  localesDir: '/locales',
  dictionaries: {
    core: { keys: ['shared', 'layout'] },
    admin: { keys: ['admin'] },
  },
};

const I18N_BASE = '/__i18n';

describe('createBundleLoader', () => {
  let cache: CacheManager;
  let loader: BundleLoader;
  let onFetchError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onFetchError = vi.fn();
    cache = createCacheManager({ dictionaries: BASE_CONFIG.dictionaries });
    loader = createBundleLoader(BASE_CONFIG, cache, I18N_BASE, {
      onFetchError,
      pinDictionaries: true,
    });
  });

  // 1. Loads a dictionary bundle and adds to cache, marks loaded
  describe('loadDictionary', () => {
    it('fetches a dictionary bundle and stores namespaces in cache', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ shared: { ok: 'OK' }, layout: { header: 'Header' } }),
      );

      await loader.loadDictionary('en', 'core');

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith('/__i18n/en/_dict/core.json');
      expect(cache.getResource('en', 'shared')).toEqual({ ok: 'OK' });
      expect(cache.getResource('en', 'layout')).toEqual({ header: 'Header' });
      expect(cache.isDictionaryLoaded('en', 'core')).toBe(true);
    });

    it('pins dictionary namespaces when pinDictionaries is true', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ shared: { ok: 'OK' } }),
      );

      await loader.loadDictionary('en', 'core');

      const entries = cache.getStore().getEntries();
      expect(entries[0].pinned).toBe(true);
      expect(entries[0].source).toBe('dictionary');
    });

    // 3. Skips already-loaded dictionaries
    it('skips when dictionary is already loaded', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ shared: { ok: 'OK' } }),
      );

      await loader.loadDictionary('en', 'core');
      await loader.loadDictionary('en', 'core');

      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('does nothing for unknown dictionary name', async () => {
      await loader.loadDictionary('en', 'nonexistent');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // 2. Deduplicates concurrent dictionary loads (only 1 fetch for 2 parallel calls)
  describe('deduplication', () => {
    it('deduplicates concurrent dictionary loads', async () => {
      let resolveFirst!: (v: Response) => void;
      mockFetch.mockReturnValueOnce(
        new Promise<Response>((resolve) => { resolveFirst = resolve; }),
      );

      const p1 = loader.loadDictionary('en', 'core');
      const p2 = loader.loadDictionary('en', 'core');

      resolveFirst(jsonResponse({ shared: { ok: 'OK' } }));

      await Promise.all([p1, p2]);

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(cache.isDictionaryLoaded('en', 'core')).toBe(true);
    });

    it('deduplicates concurrent scope loads', async () => {
      let resolveFirst!: (v: Response) => void;
      mockFetch.mockReturnValueOnce(
        new Promise<Response>((resolve) => { resolveFirst = resolve; }),
      );

      const p1 = loader.loadScope('en', 'products');
      const p2 = loader.loadScope('en', 'products');

      resolveFirst(jsonResponse({ products: { title: 'Products' } }));

      await Promise.all([p1, p2]);

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(cache.isScopeLoaded('en', 'products')).toBe(true);
    });

    it('100 parallel loadScope calls for the same (locale, scope) collapse to a single fetch', async () => {
      let resolveFirst!: (v: Response) => void;
      mockFetch.mockReturnValueOnce(
        new Promise<Response>((resolve) => { resolveFirst = resolve; }),
      );

      const promises = Array.from({ length: 100 }, () =>
        loader.loadScope('en', 'products'),
      );

      resolveFirst(jsonResponse({ products: { title: 'Products' } }));
      await Promise.all(promises);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(cache.isScopeLoaded('en', 'products')).toBe(true);
    });

    it('loadScope on an already-loaded scope resolves without firing a new fetch', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ products: { title: 'Products' } }),
      );
      await loader.loadScope('en', 'products');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Subsequent calls — any number of them — are no-ops.
      await Promise.all([
        loader.loadScope('en', 'products'),
        loader.loadScope('en', 'products'),
        loader.loadScope('en', 'products'),
      ]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('clears the in-flight entry on fetch failure so the next call fires a fresh fetch', async () => {
      // First attempt: fetch rejects.
      mockFetch.mockRejectedValueOnce(new Error('network down'));
      await loader.loadScope('en', 'products');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(cache.isScopeLoaded('en', 'products')).toBe(false);

      // Retry succeeds: a new fetch must fire (not the settled rejected promise).
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ products: { title: 'Products' } }),
      );
      await loader.loadScope('en', 'products');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(cache.isScopeLoaded('en', 'products')).toBe(true);
    });
  });

  // 4. Loads a scope bundle
  describe('loadScope', () => {
    it('fetches a scope bundle and stores namespaces in cache', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ products: { title: 'Products' } }),
      );

      await loader.loadScope('en', 'products');

      expect(mockFetch).toHaveBeenCalledWith('/__i18n/en/products.json');
      expect(cache.getResource('en', 'products')).toEqual({ title: 'Products' });
      expect(cache.isScopeLoaded('en', 'products')).toBe(true);
    });

    it('skips when scope is already loaded', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ products: { title: 'Products' } }),
      );

      await loader.loadScope('en', 'products');
      await loader.loadScope('en', 'products');

      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('stores scope namespaces with source "scope" and pinned false', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ products: { title: 'Products' } }),
      );

      await loader.loadScope('en', 'products');

      const entries = cache.getStore().getEntries();
      const productsEntry = entries.find((e) => e.namespace === 'products');
      expect(productsEntry?.source).toBe('scope');
      expect(productsEntry?.pinned).toBe(false);
    });
  });

  // 5. Uses resolveUrl when provided
  describe('resolveUrl', () => {
    it('uses resolveUrl for dictionary loads', async () => {
      const resolveUrl = vi.fn().mockReturnValue('/cdn/en/dict/core.json');
      const customLoader = createBundleLoader(
        { ...BASE_CONFIG, resolveUrl },
        cache,
        I18N_BASE,
        { onFetchError },
      );

      mockFetch.mockResolvedValueOnce(
        jsonResponse({ shared: { ok: 'OK' } }),
      );

      await customLoader.loadDictionary('en', 'core');

      expect(resolveUrl).toHaveBeenCalledWith('en', 'dictionary', 'core');
      expect(mockFetch).toHaveBeenCalledWith('/cdn/en/dict/core.json');
    });

    it('uses resolveUrl for scope loads', async () => {
      const resolveUrl = vi.fn().mockReturnValue('/cdn/en/products.json');
      const customLoader = createBundleLoader(
        { ...BASE_CONFIG, resolveUrl },
        cache,
        I18N_BASE,
        { onFetchError },
      );

      mockFetch.mockResolvedValueOnce(
        jsonResponse({ products: { title: 'Products' } }),
      );

      await customLoader.loadScope('en', 'products');

      expect(resolveUrl).toHaveBeenCalledWith('en', 'scope', 'products');
      expect(mockFetch).toHaveBeenCalledWith('/cdn/en/products.json');
    });

    it('uses resolveUrl for namespace loads', async () => {
      const resolveUrl = vi.fn().mockReturnValue('/cdn/en/shared.json');
      const customLoader = createBundleLoader(
        { ...BASE_CONFIG, resolveUrl },
        cache,
        I18N_BASE,
        { onFetchError },
      );

      mockFetch.mockResolvedValueOnce(
        jsonResponse({ ok: 'OK' }),
      );

      await customLoader.loadNamespaces('en', ['shared']);

      expect(resolveUrl).toHaveBeenCalledWith('en', 'namespace', 'shared');
      expect(mockFetch).toHaveBeenCalledWith('/cdn/en/shared.json');
    });
  });

  // 6. In dev namespace mode, uses /_scope/{namespace} URL and reuses loaded namespaces
  describe('devNamespaceMode', () => {
    let devLoader: BundleLoader;

    beforeEach(() => {
      cache = createCacheManager(
        { dictionaries: BASE_CONFIG.dictionaries },
        { devNamespaceMode: true },
      );
      devLoader = createBundleLoader(BASE_CONFIG, cache, I18N_BASE, {
        devNamespaceMode: true,
        onFetchError,
      });
    });

    it('uses /_scope/{namespace} URL in dev namespace mode', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ products: { title: 'Products' } }),
      );

      await devLoader.loadScope('en', 'products');

      expect(mockFetch).toHaveBeenCalledWith('/__i18n/en/_scope/products.json');
    });

    it('reuses loaded namespace and skips fetch for subkey scope', async () => {
      // Pre-load the namespace
      cache.addResources('en', 'products', { show: { title: 'Details' } });

      await devLoader.loadScope('en', 'products.show');

      expect(mockFetch).not.toHaveBeenCalled();
      expect(cache.isScopeLoaded('en', 'products.show')).toBe(true);
    });
  });

  // 7. Calls onFetchError on network failure (only once)
  describe('error handling', () => {
    it('calls onFetchError on dictionary fetch failure', async () => {
      mockFetch.mockResolvedValueOnce(failResponse(500));

      await loader.loadDictionary('en', 'core');

      expect(onFetchError).toHaveBeenCalledOnce();
    });

    it('calls onFetchError on scope fetch failure', async () => {
      mockFetch.mockResolvedValueOnce(failResponse(500));

      await loader.loadScope('en', 'products');

      expect(onFetchError).toHaveBeenCalledOnce();
    });

    it('calls onFetchError on namespace fetch failure', async () => {
      mockFetch.mockResolvedValueOnce(failResponse(500));

      await loader.loadNamespaces('en', ['shared']);

      expect(onFetchError).toHaveBeenCalledOnce();
    });

    it('calls onFetchError only once across multiple failures', async () => {
      mockFetch.mockResolvedValue(failResponse(500));

      await loader.loadDictionary('en', 'core');
      await loader.loadScope('en', 'products');
      await loader.loadNamespaces('en', ['shared']);

      expect(onFetchError).toHaveBeenCalledOnce();
    });
  });

  // 8. Loads all dictionaries in order
  describe('loadAllDictionaries', () => {
    it('loads all configured dictionaries sequentially', async () => {
      const callOrder: string[] = [];

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('_dict/core')) {
          callOrder.push('core');
          return Promise.resolve(jsonResponse({ shared: { ok: 'OK' } }));
        }
        if (url.includes('_dict/admin')) {
          callOrder.push('admin');
          return Promise.resolve(jsonResponse({ admin: { dashboard: 'Dashboard' } }));
        }
        return Promise.resolve(failResponse(404));
      });

      await loader.loadAllDictionaries('en');

      expect(callOrder).toEqual(['core', 'admin']);
      expect(cache.isDictionaryLoaded('en', 'core')).toBe(true);
      expect(cache.isDictionaryLoaded('en', 'admin')).toBe(true);
    });

    it('does nothing when no dictionaries are configured', async () => {
      const noDictLoader = createBundleLoader(
        { locale: 'en', defaultLocale: 'en', localesDir: '/locales' },
        cache,
        I18N_BASE,
      );

      await noDictLoader.loadAllDictionaries('en');

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // Compiled loader integration
  describe('compiledLoader', () => {
    it('skips fetch when compiled loader succeeds for dictionary', async () => {
      const compiledLoader = {
        loadDictionary: vi.fn().mockResolvedValue(true),
        loadScope: vi.fn().mockResolvedValue(false),
      };

      const compiledBundleLoader = createBundleLoader(
        BASE_CONFIG,
        cache,
        I18N_BASE,
        { compiledLoader, onFetchError },
      );

      await compiledBundleLoader.loadDictionary('en', 'core');

      expect(compiledLoader.loadDictionary).toHaveBeenCalledWith('en', 'core');
      expect(mockFetch).not.toHaveBeenCalled();
      expect(cache.isDictionaryLoaded('en', 'core')).toBe(true);
    });

    it('falls back to fetch when compiled loader returns false', async () => {
      const compiledLoader = {
        loadDictionary: vi.fn().mockResolvedValue(false),
        loadScope: vi.fn().mockResolvedValue(false),
      };

      mockFetch.mockResolvedValueOnce(
        jsonResponse({ shared: { ok: 'OK' } }),
      );

      const compiledBundleLoader = createBundleLoader(
        BASE_CONFIG,
        cache,
        I18N_BASE,
        { compiledLoader, onFetchError },
      );

      await compiledBundleLoader.loadDictionary('en', 'core');

      expect(compiledLoader.loadDictionary).toHaveBeenCalledWith('en', 'core');
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(cache.isDictionaryLoaded('en', 'core')).toBe(true);
    });

    it('skips fetch when compiled loader succeeds for scope', async () => {
      const compiledLoader = {
        loadDictionary: vi.fn().mockResolvedValue(false),
        loadScope: vi.fn().mockResolvedValue(true),
      };

      const compiledBundleLoader = createBundleLoader(
        BASE_CONFIG,
        cache,
        I18N_BASE,
        { compiledLoader, onFetchError },
      );

      await compiledBundleLoader.loadScope('en', 'products');

      expect(compiledLoader.loadScope).toHaveBeenCalledWith('en', 'products');
      expect(mockFetch).not.toHaveBeenCalled();
      expect(cache.isScopeLoaded('en', 'products')).toBe(true);
    });
  });

  // loadNamespaces
  describe('loadNamespaces', () => {
    it('loads individual namespace files from localesDir', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: 'OK' }));
      mockFetch.mockResolvedValueOnce(jsonResponse({ header: 'Header' }));

      await loader.loadNamespaces('en', ['shared', 'layout']);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith('/locales/en/shared.json');
      expect(mockFetch).toHaveBeenCalledWith('/locales/en/layout.json');
      expect(cache.getResource('en', 'shared')).toEqual({ ok: 'OK' });
      expect(cache.getResource('en', 'layout')).toEqual({ header: 'Header' });
    });

    it('skips namespaces already loaded in cache', async () => {
      cache.addResources('en', 'shared', { ok: 'OK' });

      mockFetch.mockResolvedValueOnce(jsonResponse({ header: 'Header' }));

      await loader.loadNamespaces('en', ['shared', 'layout']);

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith('/locales/en/layout.json');
    });

    it('stores namespaces with source "manual" and pinned false', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: 'OK' }));

      await loader.loadNamespaces('en', ['shared']);

      const entries = cache.getStore().getEntries();
      const sharedEntry = entries.find((e) => e.namespace === 'shared');
      expect(sharedEntry?.source).toBe('manual');
      expect(sharedEntry?.pinned).toBe(false);
    });
  });
});
