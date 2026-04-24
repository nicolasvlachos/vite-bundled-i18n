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
export { mountI18nDevtools } from './devtools/mountDevtools';
export { initServerI18n } from './server';
export { createReadinessGate } from './core/services/readiness-gate';
export { createScopeMapClient } from './core/scope-map-client';
export type { ReadinessGate } from './core/services/readiness-gate';
export type {
  ScopeMapClient,
  ScopeMapFileRuntime,
  ScopeMapPageEntryRuntime,
  CreateScopeMapClientOptions,
} from './core/scope-map-client';
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
  I18nScopeMap,
  I18nNestedKeys,
  ValidScope,
  DotPath,
} from './core/types';
export type {
  I18nDevtoolsHandle,
  I18nDevtoolsOptions,
} from './devtools/mountDevtools';
