import type { KeyUsageEntry } from '../types';

const DEFAULT_MAX_ENTRIES = 10_000;
const DROP_FRACTION = 0.2;

/** Function signature accepted by {@link KeyTracker.warnMissing}. */
type WarnFn = (message: string) => void;

/**
 * Track translation key usage and missing-key warnings at dev time.
 *
 * In production mode (`enabled = false`) every method is a no-op so the
 * tracker adds zero runtime cost.
 */
export interface KeyTracker {
  /**
   * Record a single key lookup. Entries are tagged with the current epoch
   * so devtools can filter stale entries after a locale change or reset.
   *
   * @param key - Fully qualified translation key.
   * @param namespace - Namespace extracted from the key.
   * @param locale - Locale used for the lookup.
   * @param resolvedFrom - Where the translated value came from.
   * @param scope - Optional scope/bundle that triggered the lookup.
   */
  recordUsage(
    key: string,
    namespace: string,
    locale: string,
    resolvedFrom: KeyUsageEntry['resolvedFrom'],
    scope?: string,
  ): void;

  /**
   * Return all recorded key-usage entries.
   *
   * @returns A mutable reference to the internal entries array.
   */
  getKeyUsage(): KeyUsageEntry[];

  /**
   * Return the current epoch. Devtools compare each entry's `epoch` field
   * against this value to drop stale rows from previous routes/locales.
   */
  getEpoch(): number;

  /**
   * Bump the epoch without clearing entries. Call this on locale change
   * or namespace unload — old entries stay in memory (for "all keys ever
   * used" views) but the devtools panel filters them out.
   */
  bumpEpoch(): void;

  /**
   * Clear all entries and bump the epoch. Call from HMR hooks and explicit
   * host-app reset paths.
   */
  reset(): void;

  /**
   * Emit a console warning for a missing key, deduplicating by key string.
   *
   * @param key - The translation key that could not be resolved.
   * @param locale - The locale that was active during the lookup.
   * @param warn - Optional override for `console.warn`.
   */
  warnMissing(key: string, locale: string, warn?: WarnFn): void;
}

/**
 * Create a {@link KeyTracker} instance.
 *
 * When `enabled` is `false` the returned object is a complete no-op — all
 * methods return immediately (or return an empty array) without allocating
 * any tracking state.
 *
 * @param enabled - Whether tracking is active (typically `true` only in dev).
 * @param maxEntries - Maximum entries to retain before dropping the oldest 20%.
 * @returns A new {@link KeyTracker}.
 */
export function createKeyTracker(
  enabled: boolean,
  maxEntries = DEFAULT_MAX_ENTRIES,
): KeyTracker {
  if (!enabled) {
    return {
      recordUsage() {},
      getKeyUsage() { return []; },
      getEpoch() { return 0; },
      bumpEpoch() {},
      reset() {},
      warnMissing() {},
    };
  }

  let entries: KeyUsageEntry[] = [];
  const warnedKeys = new Set<string>();
  let epoch = 0;

  return {
    recordUsage(key, namespace, locale, resolvedFrom, scope) {
      if (entries.length >= maxEntries) {
        entries.splice(0, Math.floor(maxEntries * DROP_FRACTION));
      }
      entries.push({ key, namespace, locale, resolvedFrom, scope, epoch });
    },

    getKeyUsage() {
      return entries;
    },

    getEpoch() {
      return epoch;
    },

    bumpEpoch() {
      epoch++;
    },

    reset() {
      entries = [];
      warnedKeys.clear();
      epoch++;
    },

    warnMissing(key, locale, warn) {
      if (warnedKeys.has(key)) return;
      warnedKeys.add(key);
      const message = `vite-bundled-i18n: Missing translation for "${key}" in locale "${locale}". Returning key as fallback.`;
      if (warn) {
        warn(message);
      } else {
        console.warn(message);
      }
    },
  };
}
