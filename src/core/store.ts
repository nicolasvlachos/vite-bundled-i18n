import type { NestedTranslations } from './types';

type StoreSource = 'dictionary' | 'scope' | 'manual';

interface StoreEntry {
  locale: string;
  namespace: string;
  data: NestedTranslations;
  source: StoreSource;
  pinned: boolean;
  lastAccessedAt: number;
  approxSize: number;
}

interface StoreStats {
  totalLocales: number;
  totalNamespaces: number;
  approxTotalBytes: number;
  pinnedNamespaces: number;
}

function isNestedObject(value: string | NestedTranslations): value is NestedTranslations {
  return typeof value === 'object' && value !== null;
}

function mergeTranslations(
  existing: NestedTranslations,
  incoming: NestedTranslations,
): NestedTranslations {
  const merged: NestedTranslations = { ...existing };

  for (const [key, value] of Object.entries(incoming)) {
    const current = merged[key];
    if (current !== undefined && isNestedObject(current) && isNestedObject(value)) {
      merged[key] = mergeTranslations(current, value);
      continue;
    }
    merged[key] = value;
  }

  return merged;
}

/**
 * The resource store's public interface.
 * Manages an in-memory map of `locale → namespace → translations`.
 */
export interface ResourceStore {
  /** Stores translation data for a locale and namespace. Deep merges if already present. */
  addResources: (
    locale: string,
    namespace: string,
    data: NestedTranslations,
    options?: { source?: StoreSource; pinned?: boolean },
  ) => void;
  /** Retrieves translation data for a locale and namespace. Returns undefined if not loaded. */
  getResource: (locale: string, namespace: string) => NestedTranslations | undefined;
  /** Checks whether a namespace has been loaded for a locale. */
  hasNamespace: (locale: string, namespace: string) => boolean;
  /** Removes a namespace from a locale. */
  removeNamespace: (locale: string, namespace: string) => void;
  /** Removes an entire locale from the store. */
  removeLocale: (locale: string) => void;
  /** Returns cache metadata for all entries. */
  getEntries: () => StoreEntry[];
  /** Returns store-level stats. */
  getStats: () => StoreStats;
  /** Removes all stored translation data. */
  clear: () => void;
}

/**
 * Creates a new in-memory resource store.
 *
 * The store holds loaded translation data in a two-level map:
 * `locale → namespace → NestedTranslations`. It provides no fetching logic —
 * data is added externally via `addResources` after being loaded by the fetcher.
 *
 * @returns A {@link ResourceStore} instance
 *
 * @example
 * ```ts
 * const store = createStore();
 * store.addResources('en', 'shared', { ok: 'OK', cancel: 'Cancel' });
 * store.getResource('en', 'shared'); // { ok: 'OK', cancel: 'Cancel' }
 * store.hasNamespace('en', 'shared'); // true
 * ```
 */
export function createStore(): ResourceStore {
  const data = new Map<string, Map<string, StoreEntry>>();

  const now = () => Date.now();
  const approxSizeOf = (resources: NestedTranslations) =>
    JSON.stringify(resources).length;

  return {
    addResources(locale, namespace, resources, options) {
      let localeMap = data.get(locale);
      if (!localeMap) {
        localeMap = new Map();
        data.set(locale, localeMap);
      }
      const existing = localeMap.get(namespace);
      const merged = existing
        ? mergeTranslations(existing.data, resources)
        : resources;

      localeMap.set(namespace, {
        locale,
        namespace,
        data: merged,
        source: options?.source ?? existing?.source ?? 'manual',
        pinned: (options?.pinned ?? false) || existing?.pinned === true,
        lastAccessedAt: now(),
        approxSize: approxSizeOf(merged),
      });
    },

    getResource(locale, namespace) {
      const entry = data.get(locale)?.get(namespace);
      if (!entry) return undefined;
      entry.lastAccessedAt = now();
      return entry.data;
    },

    hasNamespace(locale, namespace) {
      return data.get(locale)?.has(namespace) ?? false;
    },

    removeNamespace(locale, namespace) {
      const localeMap = data.get(locale);
      if (!localeMap) return;
      localeMap.delete(namespace);
      if (localeMap.size === 0) {
        data.delete(locale);
      }
    },

    removeLocale(locale) {
      data.delete(locale);
    },

    getEntries() {
      return [...data.values()].flatMap((localeMap) => [...localeMap.values()]);
    },

    getStats() {
      const entries = [...data.values()].flatMap((localeMap) => [...localeMap.values()]);
      return {
        totalLocales: data.size,
        totalNamespaces: entries.length,
        approxTotalBytes: entries.reduce((sum, entry) => sum + entry.approxSize, 0),
        pinnedNamespaces: entries.filter((entry) => entry.pinned).length,
      };
    },

    clear() {
      data.clear();
    },
  };
}
