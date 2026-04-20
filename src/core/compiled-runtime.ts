/**
 * Compiled runtime for i18n production mode.
 *
 * Replaces the full store + resolver + fetcher stack with a single flat
 * `Map<string, string>` that is populated at build time. Lookups are O(1)
 * — no namespace inference, no dot-path traversal, no fallback chain.
 */

/** Matches `{{key}}` and `{{ key }}` placeholders (whitespace-tolerant). */
const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

let currentMap: Map<string, string> = new Map();

export type CompiledTranslationMap = Map<string, string>;
export type CompiledModuleLoader = () => Promise<{ default: CompiledTranslationMap }>;

export interface CompiledManifestModule {
  scopes: Record<string, Record<string, CompiledModuleLoader>>;
  dictionaries?: Record<string, Record<string, CompiledModuleLoader>>;
}

/**
 * Replaces the active translation map entirely.
 *
 * Intended to be called once per locale load (e.g. on app boot or locale
 * switch). The map is copied so that mutations to the original do not
 * affect the runtime state.
 *
 * @param map - A flat `Map` of dot-path translation keys to their string values.
 */
export function setTranslations(map: Map<string, string>): void {
  currentMap = new Map(map);
}

/**
 * Merges additional translations into the current map.
 *
 * Existing keys are overwritten if they appear in the incoming map. This
 * is used when loading scope bundles (e.g. lazy-loaded route namespaces)
 * on top of a base dictionary that was set via {@link setTranslations}.
 *
 * @param map - A flat `Map` of dot-path translation keys to merge in.
 */
export function mergeTranslations(map: Map<string, string>): void {
  for (const [k, v] of map) {
    currentMap.set(k, v);
  }
}

/**
 * Clears all translations from the runtime map.
 *
 * Resets state to an empty map. Primarily intended for use in tests via
 * `beforeEach` to ensure isolation between test cases.
 */
export function clearTranslations(): void {
  currentMap = new Map();
}

/**
 * Returns `true` if the given key exists in the compiled translation map.
 *
 * Useful for conditional rendering or feature detection without triggering
 * a full translation lookup.
 *
 * @param key - The dot-path translation key to check.
 */
export function compiledHasKey(key: string): boolean {
  return currentMap.has(key);
}

export function compiledTryTranslate(
  key: string,
  params?: Record<string, unknown>,
): string | undefined {
  return compiledTryTranslateFromMap(currentMap, key, params);
}

export function compiledHasKeyInMap(
  map: CompiledTranslationMap,
  key: string,
): boolean {
  return map.has(key);
}

export function compiledTryTranslateFromMap(
  map: CompiledTranslationMap,
  key: string,
  params?: Record<string, unknown>,
): string | undefined {
  const value = map.get(key);
  if (value === undefined) return undefined;
  return params ? interpolate(value, params) : value;
}

/**
 * Resolves a translation key from the compiled flat map.
 *
 * Lookup is O(1) — no namespace inference, no dot-path traversal, no
 * fallback chain. If the key is found, its value is returned (with
 * optional `{{param}}` interpolation). If not found, `fallback` is used
 * (also interpolated if provided). If neither is available, the raw `key`
 * string is returned so the UI degrades gracefully.
 *
 * @param key      - The dot-path translation key to look up.
 * @param params   - Optional map of placeholder names to replacement values.
 *                   Placeholders are written as `{{name}}` or `{{ name }}`.
 *                   Placeholders whose name is absent from `params` are left
 *                   untouched in the output.
 * @param fallback - Optional string to use when `key` is not in the map.
 *                   Subject to the same `params` interpolation as a found value.
 * @returns The resolved (and optionally interpolated) string.
 */
export function compiledTranslate(
  key: string,
  params?: Record<string, unknown>,
  fallback?: string,
): string {
  return compiledTranslateFromMap(currentMap, key, params, fallback);
}

export function compiledTranslateFromMap(
  map: CompiledTranslationMap,
  key: string,
  params?: Record<string, unknown>,
  fallback?: string,
): string {
  const value = map.get(key);

  if (value !== undefined) {
    return params ? interpolate(value, params) : value;
  }

  if (fallback !== undefined) {
    return params ? interpolate(fallback, params) : fallback;
  }

  return key;
}

export async function loadCompiledManifest(
  url: string,
): Promise<CompiledManifestModule> {
  const dynamicImport = new Function('u', 'return import(u)') as (
    specifier: string,
  ) => Promise<CompiledManifestModule>;
  return dynamicImport(url);
}

/**
 * Replaces all `{{placeholder}}` tokens in `text` with values from `params`.
 *
 * Tokens whose name is absent from `params` are left as-is. Matched values
 * are coerced to strings via `String()`.
 *
 * @param text   - The template string containing zero or more placeholders.
 * @param params - The parameter map supplying replacement values.
 */
function interpolate(text: string, params: Record<string, unknown>): string {
  return text.replace(PLACEHOLDER, (match, key: string) => {
    const value = params[key];
    return value !== undefined ? String(value) : match;
  });
}
