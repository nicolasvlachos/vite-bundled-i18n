import { createContext } from 'react';
import type { I18nInstance } from '../core/types';

/**
 * Context value passed from I18nProvider to consumers.
 * Includes the i18n instance and a version counter that increments
 * whenever the store is updated (dictionaries loaded, locale changed).
 * The version forces useMemo in useI18n to re-create the t function.
 */
export interface I18nContextValue {
  instance: I18nInstance;
  version: number;
}

/**
 * React context for the i18n instance.
 *
 * Provided by `I18nProvider`, consumed by `useI18n`.
 * The default value is `null` — using `useI18n` outside of a provider
 * will throw a descriptive error.
 */
export const I18nContext = createContext<I18nContextValue | null>(null);
