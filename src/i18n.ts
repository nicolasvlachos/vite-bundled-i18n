import { createI18n } from './core/createI18n';
import { i18nConfig } from './i18n.config';

export const i18n = createI18n({
  ...i18nConfig,
  localesDir: '/' + i18nConfig.localesDir,
  locale: 'en',
  defaultLocale: 'en',
  supportedLocales: ['en', 'bg'],
});
