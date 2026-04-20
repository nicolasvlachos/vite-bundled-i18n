import type {
  HasKeyFunction,
  I18nInstance,
  NamespacedTranslations,
  RequireTFunction,
  ScopedRequireTFunction,
  ScopedTFunction,
  ScopedTryTFunction,
  TFunction,
  TranslationKey,
  Translations,
  TryTFunction,
} from './types';
import { resolveArgs } from './args';

interface GetTranslationsOptions {
  /** Override the locale. Defaults to the instance's current locale. */
  locale?: string;
}

type ResolveArgsInput = Parameters<typeof resolveArgs>[0];
type LookupArgs = [string] | [string, Record<string, unknown>];

function hasResolvedKey(
  instance: I18nInstance,
  locale: string,
  key: string,
): boolean {
  return instance.tryTranslate(locale, key) !== undefined;
}

function createNamespacedTranslations(
  instance: I18nInstance,
  locale: string,
  namespace: string,
  keyPrefix?: string,
): NamespacedTranslations {
  const buildFullKey = (key: string): string =>
    keyPrefix ? `${namespace}.${keyPrefix}.${key}` : `${namespace}.${key}`;

  const get: ScopedTFunction = ((...args: unknown[]): string => {
    const { key, params, fallback } = resolveArgs(args as ResolveArgsInput);
    return instance.translate(locale, buildFullKey(key), params, fallback);
  }) as ScopedTFunction;

  const has: HasKeyFunction = (key) => {
    return hasResolvedKey(instance, locale, buildFullKey(key));
  };

  const tryGet: ScopedTryTFunction = ((...args: LookupArgs) => {
    const [key, params] = args;
    return instance.tryTranslate(locale, buildFullKey(key), params);
  }) as ScopedTryTFunction;

  const requireFn: ScopedRequireTFunction = ((...args: LookupArgs) => {
    const [key, params] = args;
    const fullKey = buildFullKey(key);
    if (!hasResolvedKey(instance, locale, fullKey)) {
      throw new Error(`vite-bundled-i18n: Missing translation for "${fullKey}" in locale "${locale}"`);
    }
    return instance.translate(locale, fullKey, params);
  }) as ScopedRequireTFunction;

  return {
    t: get,
    get,
    has,
    exists: has,
    tryGet,
    require: requireFn,
    locale,
    namespace,
  };
}

export function createTranslations(
  instance: I18nInstance,
  locale: string,
): Translations {
  const get: TFunction = ((...args: unknown[]): string => {
    const { key, params, fallback } = resolveArgs(args as ResolveArgsInput);
    return instance.translate(locale, key as TranslationKey, params, fallback);
  }) as TFunction;

  const has: HasKeyFunction = (key) => {
    return hasResolvedKey(instance, locale, key);
  };

  const tryGet: TryTFunction = ((...args: [TranslationKey] | [TranslationKey, Record<string, unknown>]) => {
    const [key, params] = args;
    return instance.tryTranslate(locale, key as TranslationKey, params);
  }) as TryTFunction;

  const requireFn: RequireTFunction = ((...args: [TranslationKey] | [TranslationKey, Record<string, unknown>]) => {
    const [key, params] = args;
    if (!hasResolvedKey(instance, locale, key)) {
      throw new Error(`vite-bundled-i18n: Missing translation for "${key}" in locale "${locale}"`);
    }
    return instance.translate(locale, key as TranslationKey, params);
  }) as RequireTFunction;

  return {
    t: get,
    get,
    has,
    exists: has,
    tryGet,
    require: requireFn,
    namespace: (namespace: string, keyPrefix?: string) =>
      createNamespacedTranslations(instance, locale, namespace, keyPrefix),
    forLocale: (nextLocale: string) => createTranslations(instance, nextLocale),
    locale,
  };
}

/**
 * Loads translations and returns a translation function — no React context needed.
 *
 * Works in server components, API routes, scripts, SSR, or any context
 * where React hooks aren't available. Ensures dictionaries (and optionally
 * a scope bundle) are loaded before returning.
 *
 * @param instance - The i18n instance from createI18n()
 * @param scope - Optional scope to load (e.g., 'products.show')
 * @param options - Optional settings (locale override)
 * @returns Object with t function, locale, and hasKey
 */
export async function getTranslations(
  instance: I18nInstance,
  scope?: string,
  options?: GetTranslationsOptions,
): Promise<Translations> {
  const locale = options?.locale ?? instance.getLocale();

  // Ensure dictionaries are loaded for this locale
  await instance.loadAllDictionaries(locale);

  // Load scope if provided
  if (scope) {
    await instance.loadScope(locale, scope);
  }

  return createTranslations(instance, locale);
}
