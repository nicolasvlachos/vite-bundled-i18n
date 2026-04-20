/**
 * vite-bundled-i18n — core entry point.
 *
 * Framework-agnostic i18n runtime with zero dependencies. Provides the
 * translation engine, key resolution, interpolation, config helpers,
 * and global translation functions.
 *
 * For React bindings, import from `vite-bundled-i18n/react`.
 * For vanilla JS convenience helpers, import from `vite-bundled-i18n/vanilla`.
 *
 * @packageDocumentation
 */
export { createI18n } from './core/createI18n';
export { getTranslations, createTranslations } from './core/getTranslations';
export { defineI18nConfig } from './core/config';
export { defineI18nData, i18nKey } from './core/data';
export { t, hasKey, scopedT, setGlobalInstance, getGlobalTranslations } from './core/t';
export { initServerI18n } from './server';
export type {
  I18nSharedConfig,
} from './core/config';
export type {
  NestedTranslations,
  I18nConfig,
  I18nInstance,
  DictionaryConfig,
  CacheConfig,

  RuntimeCacheConfig,
  CacheStats,
  CompiledConfig,
  I18nKeyMap,
  I18nParamsMap,
  Primitive,
  ParamsOf,
  TranslationKey,
  TFunction,
  TryTFunction,
  RequireTFunction,
  Translations,
  NamespacedTranslations,
  ScopedTFunction,
  UseI18nResult,
  KeyUsageEntry,
} from './core/types';
