import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCacheManager, type CacheManager } from '../../../core/services/cache-manager';

describe('createCacheManager', () => {
  let cm: CacheManager;

  beforeEach(() => {
    cm = createCacheManager();
  });

  // 1. Adds and retrieves resources
  describe('addResources / getResource', () => {
    it('stores and retrieves translation data', () => {
      cm.addResources('en', 'shared', { ok: 'OK', cancel: 'Cancel' });
      expect(cm.getResource('en', 'shared')).toEqual({ ok: 'OK', cancel: 'Cancel' });
    });

    it('returns undefined for missing namespace', () => {
      expect(cm.getResource('en', 'missing')).toBeUndefined();
    });

    it('deep merges when adding to the same namespace', () => {
      cm.addResources('en', 'shared', { ok: 'OK' });
      cm.addResources('en', 'shared', { cancel: 'Cancel' });
      expect(cm.getResource('en', 'shared')).toEqual({ ok: 'OK', cancel: 'Cancel' });
    });

    it('passes source and pinned options to the store', () => {
      cm.addResources('en', 'shared', { ok: 'OK' }, { source: 'dictionary', pinned: true });
      const entries = cm.getStore().getEntries();
      expect(entries[0].source).toBe('dictionary');
      expect(entries[0].pinned).toBe(true);
    });
  });

  // 2. Tracks scope loaded state
  describe('scope loaded state', () => {
    it('marks and queries a scope as loaded', () => {
      cm.addResources('en', 'products', { show: { title: 'Details' } });
      cm.markScopeLoaded('en', 'products');
      expect(cm.isScopeLoaded('en', 'products')).toBe(true);
    });

    it('returns false for unmarked scope', () => {
      expect(cm.isScopeLoaded('en', 'products')).toBe(false);
    });

    it('tracks subkey scopes', () => {
      cm.addResources('en', 'products', { show: { title: 'Details' } });
      cm.markScopeLoaded('en', 'products.show');
      expect(cm.isScopeLoaded('en', 'products.show')).toBe(true);
    });

    it('returns false for subkey scope when path does not exist', () => {
      cm.addResources('en', 'products', { list: { title: 'List' } });
      cm.markScopeLoaded('en', 'products.show');
      expect(cm.isScopeLoaded('en', 'products.show')).toBe(false);
    });

    it('handles allowEmpty for scopes with no stored data', () => {
      cm.markScopeLoaded('en', 'empty-scope', true);
      expect(cm.isScopeLoaded('en', 'empty-scope')).toBe(true);
    });

    it('lists loaded scopes for a locale', () => {
      cm.addResources('en', 'products', { title: 'Products' });
      cm.addResources('en', 'shared', { ok: 'OK' });
      cm.markScopeLoaded('en', 'products');
      cm.markScopeLoaded('en', 'shared');
      expect(cm.getLoadedScopes('en')).toEqual(['products', 'shared']);
    });
  });

  // 3. Tracks dictionary loaded state
  describe('dictionary loaded state', () => {
    it('marks and queries a dictionary as loaded', () => {
      cm.markDictionaryLoaded('en', 'global');
      expect(cm.isDictionaryLoaded('en', 'global')).toBe(true);
    });

    it('returns false for unmarked dictionary', () => {
      expect(cm.isDictionaryLoaded('en', 'global')).toBe(false);
    });

    it('lists loaded dictionaries for a locale', () => {
      cm.markDictionaryLoaded('en', 'global');
      cm.markDictionaryLoaded('en', 'admin');
      expect(cm.getLoadedDictionaries('en')).toEqual(['admin', 'global']);
    });
  });

  // 4. Emits resource change events
  describe('resource change events', () => {
    it('fires listener on addResources', () => {
      const listener = vi.fn();
      cm.onResourcesChange(listener);
      cm.addResources('en', 'shared', { ok: 'OK' });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('fires listener on unloadLocale', () => {
      const listener = vi.fn();
      cm.addResources('en', 'shared', { ok: 'OK' });
      cm.onResourcesChange(listener);
      cm.unloadLocale('en');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('fires listener on unloadNamespace', () => {
      const listener = vi.fn();
      cm.addResources('en', 'shared', { ok: 'OK' });
      cm.onResourcesChange(listener);
      cm.unloadNamespace('en', 'shared');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes correctly', () => {
      const listener = vi.fn();
      const unsub = cm.onResourcesChange(listener);
      unsub();
      cm.addResources('en', 'shared', { ok: 'OK' });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // 5. Suppresses and resumes events correctly
  describe('event suppression', () => {
    it('suppresses events and emits once on resume', () => {
      const listener = vi.fn();
      cm.onResourcesChange(listener);

      cm.suppressEvents();
      cm.addResources('en', 'a', { x: '1' });
      cm.addResources('en', 'b', { y: '2' });
      expect(listener).not.toHaveBeenCalled();

      cm.resumeEvents();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('supports nested suppression', () => {
      const listener = vi.fn();
      cm.onResourcesChange(listener);

      cm.suppressEvents();
      cm.suppressEvents();
      cm.addResources('en', 'a', { x: '1' });
      cm.resumeEvents();
      expect(listener).not.toHaveBeenCalled();

      cm.resumeEvents();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('does not emit on resume when no changes occurred', () => {
      const listener = vi.fn();
      cm.onResourcesChange(listener);

      cm.suppressEvents();
      cm.resumeEvents();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // 6. Unloads locale and clears all its markers
  describe('unloadLocale', () => {
    it('removes all data for a locale', () => {
      cm.addResources('en', 'shared', { ok: 'OK' });
      cm.addResources('en', 'products', { title: 'Products' });
      cm.markScopeLoaded('en', 'products');
      cm.markDictionaryLoaded('en', 'global');

      cm.unloadLocale('en');

      expect(cm.getResource('en', 'shared')).toBeUndefined();
      expect(cm.getResource('en', 'products')).toBeUndefined();
      expect(cm.isScopeLoaded('en', 'products')).toBe(false);
      expect(cm.isDictionaryLoaded('en', 'global')).toBe(false);
      expect(cm.getLoadedScopes('en')).toEqual([]);
      expect(cm.getLoadedDictionaries('en')).toEqual([]);
    });

    it('does not affect other locales', () => {
      cm.addResources('en', 'shared', { ok: 'OK' });
      cm.addResources('bg', 'shared', { ok: 'Добре' });
      cm.markScopeLoaded('bg', 'shared');

      cm.unloadLocale('en');

      expect(cm.getResource('bg', 'shared')).toEqual({ ok: 'Добре' });
      expect(cm.isScopeLoaded('bg', 'shared')).toBe(true);
    });
  });

  // 7. Returns cache stats
  describe('getCacheStats', () => {
    it('returns aggregate stats', () => {
      cm.addResources('en', 'shared', { ok: 'OK' });
      cm.addResources('en', 'products', { title: 'Products' });
      cm.addResources('bg', 'shared', { ok: 'Добре' });
      cm.markScopeLoaded('en', 'products');
      cm.markDictionaryLoaded('en', 'global');

      const stats = cm.getCacheStats();
      expect(stats.totalLocales).toBe(2);
      expect(stats.totalNamespaces).toBe(3);
      expect(stats.approxTotalBytes).toBeGreaterThan(0);
      expect(stats.loadedScopes).toBe(1);
      expect(stats.loadedDictionaries).toBe(1);
    });
  });

  // 8. Counts resident leaf keys
  describe('getResidentKeyCount', () => {
    it('counts flat leaf keys', () => {
      cm.addResources('en', 'shared', { ok: 'OK', cancel: 'Cancel', yes: 'Yes' });
      expect(cm.getResidentKeyCount('en')).toBe(3);
    });

    it('counts nested leaves, not branches', () => {
      cm.addResources('en', 'products', {
        show: { title: 'Details', description: 'Desc' },
        list: { title: 'List' },
      });
      expect(cm.getResidentKeyCount('en')).toBe(3);
    });

    it('aggregates across namespaces', () => {
      cm.addResources('en', 'shared', { ok: 'OK' });
      cm.addResources('en', 'products', { title: 'Products' });
      expect(cm.getResidentKeyCount('en')).toBe(2);
    });

    it('returns 0 for unknown locale', () => {
      expect(cm.getResidentKeyCount('xx')).toBe(0);
    });
  });

  // 9. Dev namespace mode
  describe('devNamespaceMode', () => {
    let devCm: CacheManager;

    beforeEach(() => {
      devCm = createCacheManager({}, { devNamespaceMode: true });
    });

    /**
     * v0.7.1 behavior change: in dev mode, `isScopeLoaded` no longer
     * returns true just because the inferred namespace is present in
     * the store. With `bundling.dev.leanBundles: true` (the default
     * since v0.6.1), two scopes sharing a namespace receive different
     * tree-shaken slices — so namespace-presence-as-scope-completeness
     * was a silent data-loss bug. The scope-keyed `loadedScopes` set
     * is now the single source of truth.
     *
     * The previous tests asserting the bug as a feature have been
     * inverted to lock in the fix.
     */
    it('does NOT recognize a scope as loaded just because its namespace has SOME data', () => {
      devCm.addResources('en', 'products', { show: { title: 'Details' } });
      // The namespace is present, but the scope was never marked
      // loaded — the runtime must fetch to learn what THIS scope needs.
      expect(devCm.isScopeLoaded('en', 'products.show')).toBe(false);
      expect(devCm.isScopeLoaded('en', 'products.list')).toBe(false);
    });

    it('does NOT recognize a root scope as loaded just because its namespace has SOME data', () => {
      devCm.addResources('en', 'shared', { ok: 'OK' });
      expect(devCm.isScopeLoaded('en', 'shared')).toBe(false);
    });

    it('does not recognize scope when namespace is absent', () => {
      expect(devCm.isScopeLoaded('en', 'products.show')).toBe(false);
    });

    it('recognizes scope as loaded after explicit markScopeLoaded (the canonical path)', () => {
      devCm.addResources('en', 'products', { show: { title: 'Details' } });
      devCm.markScopeLoaded('en', 'products.show');
      expect(devCm.isScopeLoaded('en', 'products.show')).toBe(true);
      // Sibling scope not marked → still false even though namespace is shared.
      expect(devCm.isScopeLoaded('en', 'products.list')).toBe(false);
    });
  });

  // 10. Eviction respects pinned namespaces
  describe('eviction', () => {
    it('does nothing when eviction is disabled (default)', () => {
      cm.addResources('en', 'a', { x: '1' });
      cm.addResources('en', 'b', { y: '2' });
      cm.evictUnused('en');
      expect(cm.getResource('en', 'a')).toBeDefined();
      expect(cm.getResource('en', 'b')).toBeDefined();
    });

    it('evicts unpinned namespaces when maxNamespaces is exceeded', () => {
      const evictCm = createCacheManager({
        cache: { runtime: { eviction: 'lru', maxNamespaces: 1 } },
      });

      evictCm.addResources('en', 'old', { x: '1' });
      evictCm.addResources('en', 'new', { y: '2' });
      evictCm.evictUnused('en');

      expect(evictCm.getCacheStats().totalNamespaces).toBeLessThanOrEqual(1);
    });

    it('respects pinned namespaces during eviction', () => {
      const evictCm = createCacheManager({
        cache: { runtime: { eviction: 'lru', maxNamespaces: 1 } },
      });

      evictCm.addResources('en', 'pinned-ns', { x: '1' }, { pinned: true });
      evictCm.addResources('en', 'unpinned', { y: '2' });
      evictCm.evictUnused('en');

      expect(evictCm.getResource('en', 'pinned-ns')).toEqual({ x: '1' });
    });

    it('evicts by maxBytes', () => {
      const evictCm = createCacheManager({
        cache: { runtime: { eviction: 'lru', maxBytes: 10 } },
      });

      evictCm.addResources('en', 'ns1', { key: 'a long value that exceeds the byte budget' });
      evictCm.addResources('en', 'ns2', { key: 'another value' });
      evictCm.evictUnused('en');

      expect(evictCm.getCacheStats().totalNamespaces).toBeLessThan(2);
    });

    it('evicts locales but protects current locale', () => {
      const evictCm = createCacheManager({
        cache: { runtime: { eviction: 'lru', maxLocales: 1 } },
      });

      evictCm.addResources('en', 'shared', { ok: 'OK' });
      evictCm.addResources('bg', 'shared', { ok: 'Добре' });
      evictCm.evictUnused('en');

      expect(evictCm.getResource('en', 'shared')).toBeDefined();
      expect(evictCm.getResource('bg', 'shared')).toBeUndefined();
    });

    it('clears scope markers when namespace is evicted', () => {
      const evictCm = createCacheManager({
        cache: { runtime: { eviction: 'lru', maxNamespaces: 1 } },
      });

      evictCm.addResources('en', 'old', { x: '1' });
      evictCm.markScopeLoaded('en', 'old');
      evictCm.addResources('en', 'new', { y: '2' });
      evictCm.evictUnused('en');

      expect(evictCm.isScopeLoaded('en', 'old')).toBe(false);
    });
  });

  // Additional: unloadNamespace clears related markers
  describe('unloadNamespace', () => {
    it('clears scope markers for the unloaded namespace', () => {
      cm.addResources('en', 'products', { show: { title: 'Details' } });
      cm.markScopeLoaded('en', 'products.show');
      expect(cm.isScopeLoaded('en', 'products.show')).toBe(true);

      cm.unloadNamespace('en', 'products');
      expect(cm.isScopeLoaded('en', 'products.show')).toBe(false);
      expect(cm.getResource('en', 'products')).toBeUndefined();
    });

    it('clears dictionary markers that touch the unloaded namespace', () => {
      const cmWithDict = createCacheManager({
        dictionaries: {
          global: { keys: ['shared', 'actions'] },
        },
      });

      cmWithDict.addResources('en', 'shared', { ok: 'OK' });
      cmWithDict.markDictionaryLoaded('en', 'global');
      expect(cmWithDict.isDictionaryLoaded('en', 'global')).toBe(true);

      cmWithDict.unloadNamespace('en', 'shared');
      expect(cmWithDict.isDictionaryLoaded('en', 'global')).toBe(false);
    });
  });

  // Additional: isNamespaceLoaded
  describe('isNamespaceLoaded', () => {
    it('returns true when namespace has data', () => {
      cm.addResources('en', 'shared', { ok: 'OK' });
      expect(cm.isNamespaceLoaded('en', 'shared')).toBe(true);
    });

    it('returns false when namespace has no data', () => {
      expect(cm.isNamespaceLoaded('en', 'shared')).toBe(false);
    });
  });

  // Additional: getStore
  describe('getStore', () => {
    it('returns the underlying resource store', () => {
      const store = cm.getStore();
      expect(store).toBeDefined();
      expect(typeof store.addResources).toBe('function');
      expect(typeof store.getResource).toBe('function');
    });
  });
});
