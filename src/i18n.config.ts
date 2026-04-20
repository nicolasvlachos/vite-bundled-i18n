import { defineI18nConfig } from './core/config';

/**
 * Shared i18n configuration.
 * Imported by both the runtime (src/i18n.ts) and the Vite plugin (vite.config.ts).
 */
export const i18nConfig = defineI18nConfig({
  localesDir: 'locales',
  dictionaries: {
    global: { keys: ['shared', 'global', 'actions'] },
  },
});
