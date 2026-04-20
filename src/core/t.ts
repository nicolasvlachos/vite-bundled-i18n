import type { I18nInstance, TFunction, ScopedTFunction, Translations } from './types';
import { createTranslations } from './getTranslations';
import { resolveArgs } from './args';
export { resolveArgs } from './args';

type ResolveArgsInput = Parameters<typeof resolveArgs>[0];

let globalInstance: I18nInstance | null = null;

/**
 * Registers the global i18n instance used by the module-level `t()`, `hasKey()`,
 * and `scopedT()` functions.
 *
 * Called automatically by `I18nProvider` on mount. You only need to call this
 * directly if using the global functions outside of React.
 *
 * @param instance - The instance returned by `createI18n()`
 */
export function setGlobalInstance(instance: I18nInstance): void {
  globalInstance = instance;
}

function getGlobalInstance(): I18nInstance {
  if (!globalInstance) {
    throw new Error(
      'vite-bundled-i18n: No i18n instance found. ' +
        'Call createI18n() and either wrap your app with <I18nProvider> ' +
        'or call setGlobalInstance() before using t().',
    );
  }
  return globalInstance;
}

export function getGlobalTranslations(): Translations {
  const instance = getGlobalInstance();
  return createTranslations(instance, instance.getLocale());
}

/**
 * Global translation function.
 *
 * Translates a fully qualified key using the global i18n instance.
 * Supports two calling conventions:
 * - `t(key, fallback?)` — when no interpolation is needed
 * - `t(key, params, fallback?)` — when interpolation parameters are needed
 *
 * @example
 * ```ts
 * t('shared.ok', 'OK');
 * t('products.show.price', { amount: 29.99 }, 'Price: {{amount}}');
 * ```
 */
export const t: TFunction = ((...args: Parameters<TFunction>): string => {
  const { key, params, fallback } = resolveArgs(args as ResolveArgsInput);
  const instance = getGlobalInstance();
  return instance.translate(instance.getLocale(), key, params, fallback);
}) as TFunction;

/**
 * Checks whether a translation key exists in the currently loaded translations
 * for the active locale.
 *
 * @param key - Fully qualified key path (e.g., `'products.show.title'`)
 * @returns `true` if the key exists, `false` otherwise
 */
export function hasKey(key: string): boolean {
  return getGlobalTranslations().has(key);
}

/**
 * Creates a translation function fixed to a specific language and namespace.
 *
 * Useful for SSR, emails, or other contexts outside the React tree.
 *
 * @param language - Locale code (e.g., `'bg'`)
 * @param namespace - Namespace to bind to (e.g., `'products'`)
 * @param keyPrefix - Optional key prefix to prepend
 * @returns A `TFunction` bound to the specified language and namespace
 *
 * @example
 * ```ts
 * const tBulgarian = scopedT('bg', 'products', 'show');
 * tBulgarian('title'); // resolves 'products.show.title' in Bulgarian
 * ```
 */
export function scopedT(
  language: string,
  namespace: string,
  keyPrefix?: string,
): ScopedTFunction {
  return getGlobalTranslations()
    .forLocale(language)
    .namespace(namespace, keyPrefix)
    .t;
}
