import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createI18n } from '../../core/createI18n';
import type { I18nConfig } from '../../core/types';

const baseConfig: I18nConfig = {
  locale: 'en',
  defaultLocale: 'en',
  supportedLocales: ['en', 'bg'],
  localesDir: '/locales',
};

describe('createI18n', () => {
  const originalFetch = globalThis.fetch;
  let tmpDir: string;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-runtime-compiled-'));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an I18nInstance with frozen config', () => {
    const instance = createI18n(baseConfig);
    expect(instance.config.locale).toBe('en');
    expect(Object.isFrozen(instance.config)).toBe(true);
  });

  it('returns the current locale via getLocale', () => {
    const instance = createI18n(baseConfig);
    expect(instance.getLocale()).toBe('en');
  });

  it('translates a key after resources are added directly', () => {
    const instance = createI18n(baseConfig);
    instance.addResources('en', 'shared', { ok: 'OK', cancel: 'Cancel' });
    expect(instance.translate('en', 'shared.ok')).toBe('OK');
  });

  it('resolves nested keys', () => {
    const instance = createI18n(baseConfig);
    instance.addResources('en', 'products', {
      show: { title: 'Product Details' },
    });
    expect(instance.translate('en', 'products.show.title')).toBe('Product Details');
  });

  it('interpolates params in translated strings', () => {
    const instance = createI18n(baseConfig);
    instance.addResources('en', 'products', {
      show: { price: 'Price: {{amount}}' },
    });
    expect(
      instance.translate('en', 'products.show.price', { amount: 29.99 }),
    ).toBe('Price: 29.99');
  });

  it('falls back to defaultLocale when key is missing in active locale', () => {
    const instance = createI18n(baseConfig);
    instance.addResources('en', 'shared', { ok: 'OK' });
    expect(instance.translate('bg', 'shared.ok')).toBe('OK');
  });

  it('returns fallback string when key is missing in all locales', () => {
    const instance = createI18n(baseConfig);
    expect(
      instance.translate('en', 'missing.key', undefined, 'Fallback'),
    ).toBe('Fallback');
  });

  it('returns the key when no fallback and key is missing', () => {
    const instance = createI18n(baseConfig);
    expect(instance.translate('en', 'missing.key')).toBe('missing.key');
  });

  it('interpolates params into fallback string', () => {
    const instance = createI18n(baseConfig);
    expect(
      instance.translate('en', 'missing.key', { n: 5 }, 'Found {{n}} items'),
    ).toBe('Found 5 items');
  });

  it('checks key existence via hasKey', () => {
    const instance = createI18n(baseConfig);
    instance.addResources('en', 'shared', { ok: 'OK' });
    expect(instance.hasKey('en', 'shared.ok')).toBe(true);
    expect(instance.hasKey('en', 'shared.missing')).toBe(false);
  });

  it('tryTranslate returns undefined for unresolved keys', () => {
    const instance = createI18n(baseConfig);
    instance.addResources('en', 'shared', { ok: 'OK' });
    expect(instance.tryTranslate('en', 'shared.ok')).toBe('OK');
    expect(instance.tryTranslate('en', 'shared.missing')).toBeUndefined();
  });

  it('tryTranslate falls back to defaultLocale but not to key-as-value', () => {
    const instance = createI18n(baseConfig);
    instance.addResources('en', 'shared', { ok: 'OK' });
    expect(instance.tryTranslate('bg', 'shared.ok')).toBe('OK');
    expect(instance.tryTranslate('bg', 'shared.cancel')).toBeUndefined();
  });

  it('collects dictionary namespaces with deduplication', () => {
    const instance = createI18n({
      ...baseConfig,
      dictionaries: {
        global: { keys: ['shared', 'global'] },
        ui: { keys: ['shared', 'actions'] },
      },
    });
    expect(instance.getDictionaryNamespaces()).toEqual(['shared', 'global', 'actions']);
  });

  it('returns empty array when no dictionaries configured', () => {
    const instance = createI18n(baseConfig);
    expect(instance.getDictionaryNamespaces()).toEqual([]);
  });

  it('changes locale via changeLocale', async () => {
    const instance = createI18n(baseConfig);
    await instance.changeLocale('bg');
    expect(instance.getLocale()).toBe('bg');
  });

  it('notifies subscribers on locale change', async () => {
    const instance = createI18n(baseConfig);
    const callback = vi.fn();
    instance.onLocaleChange(callback);
    await instance.changeLocale('bg');
    expect(callback).toHaveBeenCalledWith('bg');
  });

  it('unsubscribes from locale changes', async () => {
    const instance = createI18n(baseConfig);
    const callback = vi.fn();
    const unsub = instance.onLocaleChange(callback);
    unsub();
    await instance.changeLocale('bg');
    expect(callback).not.toHaveBeenCalled();
  });

  it('loads named dictionaries and scopes when changing locale', async () => {
    const instance = createI18n({
      ...baseConfig,
      dictionaries: {
        global: { keys: ['shared'] },
      },
    });
    // Add English resources
    instance.addResources('en', 'shared', { ok: 'OK' });

    // Simulate a page that loaded a scope
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ products: { show: { title: 'Details' } } }),
    } as Response);
    await instance.loadScope('en', 'products.show');

    // Mock fetch for changeLocale — named dictionary + scope
    vi.mocked(globalThis.fetch).mockImplementation((url) => {
      const urlStr = String(url);
      // Named dictionary bundle: /__i18n/bg/_dict/global.json
      if (urlStr.includes('bg/_dict/global')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ shared: { ok: 'Добре' } }),
        } as Response);
      }
      // Scope bundle: /__i18n/bg/products.show.json
      if (urlStr.includes('bg/products.show')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ products: { show: { title: 'Детайли' } } }),
        } as Response);
      }
      return Promise.reject(new Error('Unexpected URL: ' + urlStr));
    });

    await instance.changeLocale('bg');

    expect(instance.translate('bg', 'shared.ok')).toBe('Добре');
    expect(instance.translate('bg', 'products.show.title')).toBe('Детайли');
  });

  it('reports namespace and scope load state', async () => {
    const instance = createI18n(baseConfig);
    expect(instance.isNamespaceLoaded('en', 'shared')).toBe(false);
    expect(instance.isScopeLoaded('en', 'products.show')).toBe(false);

    instance.addResources('en', 'shared', { ok: 'OK' });
    expect(instance.isNamespaceLoaded('en', 'shared')).toBe(true);

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ products: { show: { title: 'Details' } } }),
    } as Response);
    await instance.loadScope('en', 'products.show');

    expect(instance.isScopeLoaded('en', 'products.show')).toBe(true);
    expect(instance.isNamespaceLoaded('en', 'products')).toBe(true);
  });

  it('tracks key usage for dev diagnostics', () => {
    const instance = createI18n(baseConfig);
    instance.addResources('en', 'shared', { ok: 'OK' });

    instance.translate('en', 'shared.ok');
    instance.translate('en', 'shared.missing', undefined, 'Fallback');
    instance.translate('en', 'nonexistent.key');

    const usage = instance.getKeyUsage();
    expect(usage).toHaveLength(3);
    expect(usage[0]).toMatchObject({ key: 'shared.ok', resolvedFrom: 'primary' });
    expect(usage[1]).toMatchObject({ key: 'shared.missing', resolvedFrom: 'fallback-string' });
    expect(usage[2]).toMatchObject({ key: 'nonexistent.key', resolvedFrom: 'key-as-value' });
  });

  it('returns dictionary names in declaration order', () => {
    const instance = createI18n({
      ...baseConfig,
      dictionaries: {
        global: { keys: ['shared', 'global'] },
        admin: { keys: ['admin'] },
      },
    });
    expect(instance.getDictionaryNames()).toEqual(['global', 'admin']);
  });

  it('loads namespaces via fetch', async () => {
    const mockData = { ok: 'OK' };
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    } as Response);

    const instance = createI18n(baseConfig);
    await instance.loadNamespaces('en', ['shared']);

    expect(instance.translate('en', 'shared.ok')).toBe('OK');
    expect(globalThis.fetch).toHaveBeenCalledWith('/locales/en/shared.json');
  });

  it('loads compiled dictionaries and scopes without fetch when a compiled manifest is configured', async () => {
    const instance = createI18n({
      ...baseConfig,
      dictionaries: {
        global: { keys: ['shared'] },
      },
      compiled: {
        enabled: true,
        loadManifest: async () => ({
          scopes: {
            'products.show': {
              en: async () => ({ default: new Map([['products.show.title', 'Details']]) }),
              bg: async () => ({ default: new Map([['products.show.title', 'Детайли']]) }),
            },
          },
          dictionaries: {
            global: {
              en: async () => ({ default: new Map([
                ['shared.ok', 'OK'],
                ['shared.loading', 'Loading...'],
              ]) }),
              bg: async () => ({ default: new Map([
                ['shared.ok', 'Добре'],
                ['shared.loading', 'Loading...'],
              ]) }),
            },
          },
        }),
      },
    });

    await instance.loadAllDictionaries('en');
    await instance.loadScope('en', 'products.show');

    expect(instance.translate('en', 'shared.ok')).toBe('OK');
    expect(instance.translate('en', 'products.show.title')).toBe('Details');
    expect(globalThis.fetch).not.toHaveBeenCalled();

    await instance.changeLocale('bg');

    expect(instance.translate('bg', 'shared.ok')).toBe('Добре');
    expect(instance.translate('bg', 'products.show.title')).toBe('Детайли');
    expect(instance.translate('bg', 'shared.loading')).toBe('Loading...');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('passes requestInit to namespace loading', async () => {
    const mockData = { ok: 'OK' };
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    } as Response);

    const instance = createI18n({
      ...baseConfig,
      requestInit: { cache: 'force-cache' },
    });
    await instance.loadNamespaces('en', ['shared']);

    expect(globalThis.fetch).toHaveBeenCalledWith('/locales/en/shared.json', {
      cache: 'force-cache',
    });
  });

  it('skips loading namespaces already in the store', async () => {
    const instance = createI18n(baseConfig);
    instance.addResources('en', 'shared', { ok: 'OK' });

    await instance.loadNamespaces('en', ['shared']);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('throws for empty supportedLocales', () => {
    expect(() => createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: [],
      localesDir: '/locales',
    })).toThrow('supportedLocales');
  });

  it('throws when defaultLocale is not in supportedLocales', () => {
    expect(() => createI18n({
      locale: 'en',
      defaultLocale: 'fr',
      supportedLocales: ['en', 'bg'],
      localesDir: '/locales',
    })).toThrow('defaultLocale');
  });

  it('logs a consolidated error and continues when a namespace fails to load', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Network error'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const instance = createI18n(baseConfig);
    await instance.loadNamespaces('en', ['shared']);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('Cannot load translations');
    expect(instance.hasKey('en', 'shared.ok')).toBe(false);
    errorSpy.mockRestore();
  });

  it('returns cache stats and can unload namespaces/locales', async () => {
    const instance = createI18n({
      ...baseConfig,
      dictionaries: {
        global: { keys: ['shared'] },
      },
    });

    instance.addResources('en', 'products', { show: { title: 'Details' } });
    expect(instance.getCacheStats().totalNamespaces).toBe(1);

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ shared: { ok: 'OK' } }),
    } as Response);
    await instance.loadDictionary('en', 'global');

    const stats = instance.getCacheStats();
    expect(stats.totalNamespaces).toBe(2);
    expect(stats.loadedDictionaries).toBe(1);
    expect(stats.pinnedNamespaces).toBe(1);

    instance.unloadNamespace('en', 'products');
    expect(instance.isNamespaceLoaded('en', 'products')).toBe(false);

    instance.unloadLocale('en');
    expect(instance.isNamespaceLoaded('en', 'shared')).toBe(false);
    expect(instance.getCacheStats().totalLocales).toBe(0);
  });

  it('evicts least recently used non-pinned namespaces when maxNamespaces is exceeded', () => {
    const instance = createI18n({
      ...baseConfig,
      cache: {
        runtime: {
          strategy: 'memory',
          eviction: 'lru',
          maxNamespaces: 1,
          pinDictionaries: true,
        },
      },
      dictionaries: {
        global: { keys: ['shared'] },
      },
    });

    instance.addResources('en', 'shared', { ok: 'OK' });
    instance.addResources('en', 'products', { show: { title: 'Details' } });
    instance.addResources('en', 'cart', { title: 'Cart' });

    expect(instance.isNamespaceLoaded('en', 'shared')).toBe(false);
    expect(instance.isNamespaceLoaded('en', 'products')).toBe(false);
    expect(instance.isNamespaceLoaded('en', 'cart')).toBe(true);
  });

  it('errors on scope load failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);

    const instance = createI18n(baseConfig);
    await instance.loadScope('en', 'some.scope');

    expect(instance.isScopeLoaded('en', 'some.scope')).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('Cannot load translations');

    errorSpy.mockRestore();
  });

  it('consolidates multiple fetch failures into one error message', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
      dictionaries: {
        global: { include: ['shared.*'], priority: 1 },
        admin: { include: ['admin.*'], priority: 2 },
      },
    });

    await instance.loadAllDictionaries('en');
    await instance.loadScope('en', 'products.index');

    // Should emit exactly one consolidated error, not 3 separate warnings
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('Cannot load translations');
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('warns once per missing key in dev mode', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });

    // Translate a key that doesn't exist — should warn
    instance.translate('en', 'missing.key');
    instance.translate('en', 'missing.key'); // second call — should NOT warn again
    instance.translate('en', 'another.missing'); // different key — should warn

    const missingKeyWarns = warnSpy.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('Missing translation')
    );
    expect(missingKeyWarns).toHaveLength(2);
    expect(missingKeyWarns[0][0]).toContain('missing.key');
    expect(missingKeyWarns[1][0]).toContain('another.missing');

    warnSpy.mockRestore();
  });

  it('does not evict pinned dictionary namespaces under namespace pressure', async () => {
    const instance = createI18n({
      ...baseConfig,
      cache: {
        runtime: {
          strategy: 'memory',
          eviction: 'lru',
          maxNamespaces: 1,
          pinDictionaries: true,
        },
      },
      dictionaries: {
        global: { keys: ['shared'] },
      },
    });

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ shared: { ok: 'OK' } }),
    } as Response);
    await instance.loadDictionary('en', 'global');

    instance.addResources('en', 'products', { show: { title: 'Details' } });

    expect(instance.isNamespaceLoaded('en', 'shared')).toBe(true);
    expect(instance.isNamespaceLoaded('en', 'products')).toBe(false);
  });

  it('uses resolveUrl for dictionary fetches when provided', async () => {
    const resolveUrl = vi.fn((locale: string, type: string, name: string) =>
      `/api/i18n/${locale}/${type}/${name}`
    );

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ shared: { ok: 'OK' } }),
    } as Response);

    const instance = createI18n({
      ...baseConfig,
      dictionaries: { global: { include: ['shared.*'], priority: 1 } },
      resolveUrl,
    });

    await instance.loadDictionary('en', 'global');

    expect(resolveUrl).toHaveBeenCalledWith('en', 'dictionary', 'global');
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith('/api/i18n/en/dictionary/global');
  });

  it('uses resolveUrl for scope fetches when provided', async () => {
    const resolveUrl = vi.fn((locale: string, type: string, name: string) =>
      `/api/i18n/${locale}/${type}/${name}`
    );

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ products: { title: 'Hi' } }),
    } as Response);

    const instance = createI18n({
      ...baseConfig,
      resolveUrl,
    });

    await instance.loadScope('en', 'products.index');

    expect(resolveUrl).toHaveBeenCalledWith('en', 'scope', 'products.index');
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith('/api/i18n/en/scope/products.index');
  });

  it('uses resolveUrl for namespace fetches when provided', async () => {
    const resolveUrl = vi.fn((locale: string, type: string, name: string) =>
      `/api/i18n/${locale}/${type}/${name}`
    );

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: 'OK' }),
    } as Response);

    const instance = createI18n({
      ...baseConfig,
      resolveUrl,
    });

    await instance.loadNamespaces('en', ['shared']);

    expect(resolveUrl).toHaveBeenCalledWith('en', 'namespace', 'shared');
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith('/api/i18n/en/namespace/shared');
  });

  it('uses resolveUrl for manifest when provided', () => {
    const resolveUrl = vi.fn((locale: string, type: string, name: string) =>
      `/cdn/i18n/${type}/${name}.js`
    );

    createI18n({
      ...baseConfig,
      resolveUrl,
    });

    // The manifest URL is resolved at init time
    expect(resolveUrl).toHaveBeenCalledWith('en', 'manifest', 'manifest');
  });

  it('falls back to default paths when resolveUrl is not provided', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ shared: { ok: 'OK' } }),
    } as Response);

    const instance = createI18n({
      ...baseConfig,
      dictionaries: { global: { include: ['shared.*'], priority: 1 } },
    });

    await instance.loadDictionary('en', 'global');

    // Default path: /__i18n/en/_dict/global.json
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith('/__i18n/en/_dict/global.json');
  });
});
