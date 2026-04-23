import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLocaleManager, type LocaleManager } from '../../../core/services/locale-manager';
import type { BundleLoader } from '../../../core/services/bundle-loader';
import type { CacheManager } from '../../../core/services/cache-manager';

// ---------------------------------------------------------------------------
// Mock fetch globally (required by test-case spec)
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Helpers — mock BundleLoader and CacheManager
// ---------------------------------------------------------------------------

function createMockLoader(): BundleLoader {
  return {
    loadDictionary: vi.fn<[string, string], Promise<void>>().mockResolvedValue(undefined),
    loadAllDictionaries: vi.fn<[string], Promise<void>>().mockResolvedValue(undefined),
    loadScope: vi.fn<[string, string], Promise<void>>().mockResolvedValue(undefined),
    loadNamespaces: vi.fn<[string, string[]], Promise<void>>().mockResolvedValue(undefined),
  };
}

function createMockCache(): CacheManager {
  return {
    addResources: vi.fn(),
    getResource: vi.fn(),
    isNamespaceLoaded: vi.fn().mockReturnValue(false),
    isScopeLoaded: vi.fn().mockReturnValue(false),
    isDictionaryLoaded: vi.fn().mockReturnValue(false),
    markScopeLoaded: vi.fn(),
    markDictionaryLoaded: vi.fn(),
    getLoadedNamespaces: vi.fn().mockReturnValue([]),
    getLoadedScopes: vi.fn().mockReturnValue([]),
    getLoadedDictionaries: vi.fn().mockReturnValue([]),
    getCacheStats: vi.fn().mockReturnValue({}),
    getResidentKeyCount: vi.fn().mockReturnValue(0),
    unloadLocale: vi.fn(),
    unloadNamespace: vi.fn(),
    evictUnused: vi.fn(),
    onResourcesChange: vi.fn().mockReturnValue(() => {}),
    suppressEvents: vi.fn(),
    resumeEvents: vi.fn(),
    getStore: vi.fn() as CacheManager['getStore'],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createLocaleManager', () => {
  let loader: BundleLoader;
  let cache: CacheManager;
  let manager: LocaleManager;

  beforeEach(() => {
    vi.clearAllMocks();
    loader = createMockLoader();
    cache = createMockCache();
    manager = createLocaleManager('en', loader, cache);
  });

  // 1. Returns the initial locale
  it('returns the initial locale', () => {
    expect(manager.getLocale()).toBe('en');
  });

  // 2. Changes locale and notifies listeners
  it('changes locale, loads resources, and notifies listeners', async () => {
    // Simulate scopes loaded under 'en'
    vi.mocked(cache.getLoadedScopes).mockReturnValue(['products', 'dashboard']);

    const listener = vi.fn();
    manager.onLocaleChange(listener);

    await manager.changeLocale('fr');

    expect(manager.getLocale()).toBe('fr');
    expect(loader.loadAllDictionaries).toHaveBeenCalledWith('fr');
    expect(loader.loadScope).toHaveBeenCalledWith('fr', 'products');
    expect(loader.loadScope).toHaveBeenCalledWith('fr', 'dashboard');
    expect(listener).toHaveBeenCalledWith('fr');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // 3. Skips locale change if already current
  it('skips locale change when already set to the requested locale', async () => {
    const listener = vi.fn();
    manager.onLocaleChange(listener);

    await manager.changeLocale('en');

    expect(loader.loadAllDictionaries).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(manager.getLocale()).toBe('en');
  });

  // 4. Unsubscribes locale listener correctly
  it('unsubscribes a locale listener', async () => {
    const listener = vi.fn();
    const unsub = manager.onLocaleChange(listener);

    unsub();
    await manager.changeLocale('de');

    expect(listener).not.toHaveBeenCalled();
    expect(manager.getLocale()).toBe('de');
  });

  // 5. reloadResources unloads and reloads dictionaries and scopes
  it('reloadResources unloads locale then reloads dictionaries and scopes', async () => {
    vi.mocked(cache.getLoadedDictionaries).mockReturnValue(['core', 'admin']);
    vi.mocked(cache.getLoadedScopes).mockReturnValue(['products']);

    await manager.reloadResources('en');

    // Should suppress events, unload, reload, then resume
    expect(cache.suppressEvents).toHaveBeenCalledTimes(1);
    expect(cache.unloadLocale).toHaveBeenCalledWith('en');

    // Dictionaries reloaded sequentially
    expect(loader.loadDictionary).toHaveBeenCalledWith('en', 'core');
    expect(loader.loadDictionary).toHaveBeenCalledWith('en', 'admin');

    // Scopes reloaded
    expect(loader.loadScope).toHaveBeenCalledWith('en', 'products');

    expect(cache.resumeEvents).toHaveBeenCalledTimes(1);
  });

  // Edge: reloadResources is a no-op when nothing is loaded
  it('reloadResources is a no-op when no resources are loaded', async () => {
    vi.mocked(cache.getLoadedDictionaries).mockReturnValue([]);
    vi.mocked(cache.getLoadedScopes).mockReturnValue([]);

    await manager.reloadResources('en');

    expect(cache.suppressEvents).not.toHaveBeenCalled();
    expect(cache.unloadLocale).not.toHaveBeenCalled();
    expect(cache.resumeEvents).not.toHaveBeenCalled();
  });

  // Edge: resumeEvents is called even if reload throws
  it('resumeEvents is called even when reload throws', async () => {
    vi.mocked(cache.getLoadedDictionaries).mockReturnValue(['core']);
    vi.mocked(cache.getLoadedScopes).mockReturnValue([]);
    vi.mocked(loader.loadDictionary).mockRejectedValueOnce(new Error('fail'));

    await expect(manager.reloadResources('en')).rejects.toThrow('fail');

    expect(cache.suppressEvents).toHaveBeenCalledTimes(1);
    expect(cache.resumeEvents).toHaveBeenCalledTimes(1);
  });
});
