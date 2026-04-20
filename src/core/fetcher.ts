import type { NestedTranslations } from './types';

export function buildLoadPath(
  localesDir: string,
  locale: string,
  namespace: string,
): string {
  const base = localesDir.endsWith('/') ? localesDir.slice(0, -1) : localesDir;
  return `${base}/${locale}/${namespace}.json`;
}

export function buildBundlePath(locale: string, bundleName: string): string {
  return `/__i18n/${locale}/${bundleName}.json`;
}

export async function fetchNamespace(
  localesDir: string,
  locale: string,
  namespace: string,
  requestInit?: RequestInit,
): Promise<NestedTranslations> {
  const url = buildLoadPath(localesDir, locale, namespace);
  const response = requestInit
    ? await fetch(url, requestInit)
    : await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to load translations: ${url} (${response.status} ${response.statusText})`,
    );
  }

  return response.json() as Promise<NestedTranslations>;
}

export async function fetchBundle(
  locale: string,
  bundleName: string,
  requestInit?: RequestInit,
): Promise<Record<string, NestedTranslations>> {
  const url = buildBundlePath(locale, bundleName);
  const response = requestInit
    ? await fetch(url, requestInit)
    : await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to load translation bundle: ${url} (${response.status} ${response.statusText})`,
    );
  }

  return response.json() as Promise<Record<string, NestedTranslations>>;
}
