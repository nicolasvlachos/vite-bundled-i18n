import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createI18n } from '../../core/createI18n';
import { getTranslations } from '../../core/getTranslations';
import type { TranslationKey } from '../../core/types';

describe('getTranslations', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns t function that resolves dictionary keys', async () => {
    const i18n = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });
    i18n.addResources('en', 'shared', { ok: 'OK', cancel: 'Cancel' });

    const translations = await getTranslations(i18n);

    expect(translations.locale).toBe('en');
    expect(translations.t('shared.ok')).toBe('OK');
    expect(translations.t('shared.cancel')).toBe('Cancel');
  });

  it('loads scope and resolves scope keys', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ products: { show: { title: 'Details' } } }),
    } as Response);

    const i18n = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });

    const translations = await getTranslations(i18n, 'products.show');
    expect(translations.t('products.show.title')).toBe('Details');
  });

  it('uses locale override', async () => {
    const i18n = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en', 'bg'],
      localesDir: '/locales',
    });
    i18n.addResources('bg', 'shared', { ok: 'Добре' });

    const translations = await getTranslations(i18n, undefined, { locale: 'bg' });

    expect(translations.locale).toBe('bg');
    expect(translations.t('shared.ok')).toBe('Добре');
  });

  it('provides has and exists aliases', async () => {
    const i18n = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });
    i18n.addResources('en', 'shared', { ok: 'OK' });

    const translations = await getTranslations(i18n);
    expect(translations.has('shared.ok')).toBe(true);
    expect(translations.exists('shared.ok')).toBe(true);
    expect(translations.has('shared.missing')).toBe(false);
    expect(translations.exists('shared.missing')).toBe(false);
  });

  it('resolves fallback for missing keys', async () => {
    const i18n = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });

    const translations = await getTranslations(i18n);
    expect(translations.t('missing.key' as TranslationKey, 'Fallback')).toBe('Fallback');
  });

  it('works without provider or setGlobalInstance', async () => {
    // This is the key test — no global state needed
    const i18n = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });
    i18n.addResources('en', 'shared', { ok: 'OK' });

    // No setGlobalInstance, no I18nProvider — should still work
    const translations = await getTranslations(i18n);
    expect(translations.t('shared.ok')).toBe('OK');
  });

  it('exposes get as an alias of t', async () => {
    const i18n = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });
    i18n.addResources('en', 'shared', { ok: 'OK' });

    const translations = await getTranslations(i18n);
    expect(translations.get).toBe(translations.t);
    expect(translations.get('shared.ok')).toBe('OK');
  });

  it('returns undefined from tryGet for unresolved keys', async () => {
    const i18n = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });
    i18n.addResources('en', 'shared', { ok: 'OK' });

    const translations = await getTranslations(i18n);
    expect(translations.tryGet('shared.ok')).toBe('OK');
    expect(translations.tryGet('shared.missing' as TranslationKey)).toBeUndefined();
  });

  it('throws from require for unresolved keys', async () => {
    const i18n = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });
    i18n.addResources('en', 'shared', { ok: 'OK' });

    const translations = await getTranslations(i18n);
    expect(translations.require('shared.ok')).toBe('OK');
    expect(() => translations.require('shared.missing' as TranslationKey)).toThrow(
      'vite-bundled-i18n: Missing translation',
    );
  });

  it('provides namespace-bound translators', async () => {
    const i18n = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });
    i18n.addResources('en', 'global', { nav: { home: 'Home' } });

    const translations = await getTranslations(i18n);
    const globalT = translations.namespace('global');

    expect(globalT.get('nav.home')).toBe('Home');
    expect(globalT.t('nav.home')).toBe('Home');
    expect(globalT.has('nav.home')).toBe(true);
  });
});
