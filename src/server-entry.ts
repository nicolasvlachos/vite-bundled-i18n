export { createI18n } from './core/createI18n';
export { defineI18nConfig } from './core/config';
export { defineI18nData, i18nKey } from './core/data';
export { getTranslations, createTranslations } from './core/getTranslations';
export { initServerI18n } from './server';

export type { I18nSharedConfig } from './core/config';
export type {
  NestedTranslations,
  I18nConfig,
  I18nInstance,
  DictionaryConfig,
  CacheConfig,
  CompiledConfig,
  Translations,
} from './core/types';
