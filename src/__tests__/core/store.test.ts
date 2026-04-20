import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../../core/store';

describe('createStore', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  describe('addResources', () => {
    it('stores translations for a locale and namespace', () => {
      store.addResources('en', 'shared', { ok: 'OK', cancel: 'Cancel' });
      expect(store.getResource('en', 'shared')).toEqual({ ok: 'OK', cancel: 'Cancel' });
    });

    it('stores nested translations', () => {
      store.addResources('en', 'products', { show: { title: 'Product Details' } });
      expect(store.getResource('en', 'products')).toEqual({ show: { title: 'Product Details' } });
    });

    it('stores multiple namespaces for the same locale', () => {
      store.addResources('en', 'shared', { ok: 'OK' });
      store.addResources('en', 'products', { show: { title: 'Details' } });
      expect(store.getResource('en', 'shared')).toEqual({ ok: 'OK' });
      expect(store.getResource('en', 'products')).toEqual({ show: { title: 'Details' } });
    });

    it('stores the same namespace for different locales', () => {
      store.addResources('en', 'shared', { ok: 'OK' });
      store.addResources('bg', 'shared', { ok: 'Добре' });
      expect(store.getResource('en', 'shared')).toEqual({ ok: 'OK' });
      expect(store.getResource('bg', 'shared')).toEqual({ ok: 'Добре' });
    });

    it('overwrites existing data when the same locale+namespace is added again', () => {
      store.addResources('en', 'shared', { ok: 'OK' });
      store.addResources('en', 'shared', { ok: 'Okay' });
      expect(store.getResource('en', 'shared')).toEqual({ ok: 'Okay' });
    });
  });

  describe('getResource', () => {
    it('returns undefined for a missing locale', () => {
      expect(store.getResource('fr', 'shared')).toBeUndefined();
    });

    it('returns undefined for a missing namespace', () => {
      store.addResources('en', 'shared', { ok: 'OK' });
      expect(store.getResource('en', 'products')).toBeUndefined();
    });
  });

  describe('hasNamespace', () => {
    it('returns true for a loaded namespace', () => {
      store.addResources('en', 'shared', { ok: 'OK' });
      expect(store.hasNamespace('en', 'shared')).toBe(true);
    });

    it('returns false for a missing namespace', () => {
      expect(store.hasNamespace('en', 'shared')).toBe(false);
    });

    it('returns false for a missing locale', () => {
      store.addResources('en', 'shared', { ok: 'OK' });
      expect(store.hasNamespace('fr', 'shared')).toBe(false);
    });
  });

  describe('clear', () => {
    it('removes all stored data', () => {
      store.addResources('en', 'shared', { ok: 'OK' });
      store.addResources('bg', 'shared', { ok: 'Добре' });
      store.clear();
      expect(store.hasNamespace('en', 'shared')).toBe(false);
      expect(store.hasNamespace('bg', 'shared')).toBe(false);
    });
  });

  describe('cache metadata helpers', () => {
    it('returns stats for locales, namespaces, and bytes', () => {
      store.addResources('en', 'shared', { ok: 'OK' }, { pinned: true, source: 'dictionary' });
      store.addResources('bg', 'products', { show: { title: 'Details' } }, { source: 'scope' });

      const stats = store.getStats();
      expect(stats.totalLocales).toBe(2);
      expect(stats.totalNamespaces).toBe(2);
      expect(stats.approxTotalBytes).toBeGreaterThan(0);
      expect(stats.pinnedNamespaces).toBe(1);
    });

    it('can remove a namespace and a locale', () => {
      store.addResources('en', 'shared', { ok: 'OK' });
      store.addResources('en', 'products', { show: { title: 'Details' } });
      store.addResources('bg', 'shared', { ok: 'Добре' });

      store.removeNamespace('en', 'products');
      expect(store.hasNamespace('en', 'products')).toBe(false);

      store.removeLocale('bg');
      expect(store.hasNamespace('bg', 'shared')).toBe(false);
      expect(store.hasNamespace('en', 'shared')).toBe(true);
    });
  });
});
