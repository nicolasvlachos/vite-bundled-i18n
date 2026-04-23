import type { NestedTranslations } from './types';

/**
 * Builds the URL path for a single namespace JSON file.
 *
 * @param localesDir - Root directory containing locale folders (e.g. `'/locales'`).
 * @param locale - Target locale code (e.g. `'en'`).
 * @param namespace - Namespace name (e.g. `'products'`).
 * @returns The full path to the namespace JSON file (e.g. `'/locales/en/products.json'`).
 */
export function buildLoadPath(
  localesDir: string,
  locale: string,
  namespace: string,
): string {
  const base = localesDir.endsWith('/') ? localesDir.slice(0, -1) : localesDir;
  return `${base}/${locale}/${namespace}.json`;
}

/**
 * Builds the URL path for a bundle JSON file (dictionary or scope).
 *
 * @param base - Base path for translation bundles (e.g. `'/__i18n'`).
 * @param locale - Target locale code (e.g. `'en'`).
 * @param bundleName - Bundle identifier (e.g. `'_dict/global'` or `'products'`).
 * @returns The full path to the bundle JSON file (e.g. `'/__i18n/en/_dict/global.json'`).
 */
export function buildBundlePath(base: string, locale: string, bundleName: string): string {
  const normalized = base.endsWith('/') ? base : base + '/';
  return normalized + locale + '/' + bundleName + '.json';
}

/**
 * Fetches a single namespace JSON file from the locales directory.
 *
 * Delegates to {@link fetchNamespaceFromUrl} after building the URL
 * via {@link buildLoadPath}.
 *
 * @param localesDir - Root directory containing locale folders.
 * @param locale - Target locale code.
 * @param namespace - Namespace name to fetch.
 * @param requestInit - Optional `RequestInit` options forwarded to `fetch()`.
 * @returns The parsed namespace translations.
 */
export async function fetchNamespace(
  localesDir: string,
  locale: string,
  namespace: string,
  requestInit?: RequestInit,
): Promise<NestedTranslations> {
  return fetchNamespaceFromUrl(buildLoadPath(localesDir, locale, namespace), requestInit);
}

/**
 * Fetches a translation bundle (dictionary or scope) from the given base path.
 *
 * @param base - Base path for translation bundles.
 * @param locale - Target locale code.
 * @param bundleName - Bundle identifier.
 * @param requestInit - Optional `RequestInit` options forwarded to `fetch()`.
 * @returns A record mapping namespace names to their translations.
 */
export async function fetchBundle(
  base: string,
  locale: string,
  bundleName: string,
  requestInit?: RequestInit,
): Promise<Record<string, NestedTranslations>> {
  const url = buildBundlePath(base, locale, bundleName);
  return fetchBundleFromUrl(url, requestInit);
}

/**
 * Fetches a JSON response from a URL with optional request options.
 *
 * @param url - The URL to fetch from.
 * @param requestInit - Optional `RequestInit` options forwarded to `fetch()`.
 * @param label - Human-readable label used in error messages.
 * @returns The parsed JSON response.
 */
async function fetchJson<T>(
  url: string,
  requestInit: RequestInit | undefined,
  label: string,
): Promise<T> {
  const response = requestInit
    ? await fetch(url, requestInit)
    : await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to load ${label}: ${url} (${response.status} ${response.statusText})`,
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Fetches a translation bundle from an absolute or relative URL.
 *
 * @param url - The URL to fetch the bundle from.
 * @param requestInit - Optional `RequestInit` options forwarded to `fetch()`.
 * @returns A record mapping namespace names to their translations.
 */
export async function fetchBundleFromUrl(
  url: string,
  requestInit?: RequestInit,
): Promise<Record<string, NestedTranslations>> {
  return fetchJson<Record<string, NestedTranslations>>(url, requestInit, 'translation bundle');
}

/**
 * Fetches a single namespace translation file from an absolute or relative URL.
 *
 * @param url - The URL to fetch translations from.
 * @param requestInit - Optional `RequestInit` options forwarded to `fetch()`.
 * @returns The parsed namespace translations.
 */
export async function fetchNamespaceFromUrl(
  url: string,
  requestInit?: RequestInit,
): Promise<NestedTranslations> {
  return fetchJson<NestedTranslations>(url, requestInit, 'translations');
}
