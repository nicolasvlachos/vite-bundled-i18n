/**
 * Vanilla JS entry point for vite-bundled-i18n.
 * Use this when not using React. Provides the full core API
 * plus a DOM-based locale switcher helper.
 */

// Core API — same as main entry
export { createI18n } from './core/createI18n';
export { defineI18nConfig } from './core/config';
export { defineI18nData, i18nKey } from './core/data';
export { t, hasKey, scopedT, setGlobalInstance } from './core/t';
export { getTranslations } from './core/getTranslations';
export { initServerI18n } from './server';

// Compiled runtime
export {
  setTranslations,
  mergeTranslations,
  compiledTranslate,
  compiledHasKey,
  clearTranslations,
} from './core/compiled-runtime';

// Types
export type {
  I18nSharedConfig,
} from './core/config';
export type {
  NestedTranslations,
  I18nConfig,
  I18nInstance,
  DictionaryConfig,
  CacheConfig,
  CompiledConfig,
  I18nKeyMap,
  TranslationKey,
  TFunction,
  ScopedTFunction,
  UseI18nResult,
  KeyUsageEntry,
} from './core/types';

import { createI18n } from './core/createI18n';
import { setGlobalInstance } from './core/t';
import { applyServerResources } from './server';
import type { I18nConfig, I18nInstance, NestedTranslations } from './core/types';

export interface InitI18nOptions {
  serverResources?: Record<string, NestedTranslations>;
  scope?: string;
  setGlobal?: boolean;
}

/**
 * Initializes translations for vanilla JS apps.
 *
 * Convenience function that creates the instance, sets it as global,
 * and loads dictionaries. Returns the instance for further use.
 *
 * @example
 * ```ts
 * import { initI18n } from 'vite-bundled-i18n/vanilla';
 *
 * const i18n = await initI18n({
 *   locale: 'en',
 *   defaultLocale: 'en',
 *   supportedLocales: ['en', 'bg'],
 *   localesDir: '/locales',
 *   dictionaries: { global: { keys: ['shared', 'global'] } },
 * });
 *
 * // Now use t() globally
 * document.getElementById('title')!.textContent = t('global.appName', 'Store');
 * ```
 */
export async function initI18n(
  config: I18nConfig,
  options?: InitI18nOptions,
): Promise<I18nInstance> {
  const instance = createI18n(config);
  if (options?.setGlobal !== false) {
    setGlobalInstance(instance);
  }
  if (options?.serverResources) {
    applyServerResources(instance, options.serverResources, config.locale);
  } else {
    await instance.loadAllDictionaries(config.locale);
  }
  if (options?.scope) {
    await instance.loadScope(config.locale, options.scope);
  }
  return instance;
}
