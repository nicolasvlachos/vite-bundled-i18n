import type { TranslationKey } from './types';

/**
 * Marks a serializable data structure as i18n-owned without changing it.
 * Useful for navigation configs, tables, and other shared data files.
 */
export function defineI18nData<const T>(data: T): T {
  return data;
}

/**
 * Typed identity helper for translation keys in arbitrary field names.
 */
export function i18nKey<K extends TranslationKey>(key: K): K {
  return key;
}
