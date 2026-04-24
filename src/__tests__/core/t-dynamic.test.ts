import { describe, it, expect } from 'vitest';
import { createI18n } from '../../core/createI18n';
import { createTranslations } from '../../core/getTranslations';

function makeInstance() {
  const instance = createI18n({
    locale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    localesDir: '/locales',
  });
  instance.addResources('en', 'status', {
    active: 'Active',
    pending: 'Pending',
    failed: 'Failed',
  });
  instance.addResources('en', 'cart', { total: 'Total: {{amount}}' });
  return instance;
}

describe('t.dynamic — loose-typed escape hatch', () => {
  it('resolves a runtime-computed key with the same semantics as t()', () => {
    const instance = makeInstance();
    const { t } = createTranslations(instance, 'en');

    const state = 'active';
    // Typed `t()` requires a literal TranslationKey; `t.dynamic` accepts any string.
    expect(t.dynamic(`status.${state}` as string)).toBe('Active');
  });

  it('supports fallback strings', () => {
    const instance = makeInstance();
    const { t } = createTranslations(instance, 'en');
    expect(t.dynamic('status.unknown', 'Unknown')).toBe('Unknown');
  });

  it('supports interpolation params', () => {
    const instance = makeInstance();
    const { t } = createTranslations(instance, 'en');
    expect(t.dynamic('cart.total', { amount: '9.99' })).toBe('Total: 9.99');
  });

  it('supports params + fallback together', () => {
    const instance = makeInstance();
    const { t } = createTranslations(instance, 'en');
    expect(t.dynamic('cart.missing', { amount: '5' }, '{{amount}} EUR')).toBe('5 EUR');
  });

  it('exists on namespaced translator too', () => {
    const instance = makeInstance();
    const translations = createTranslations(instance, 'en');
    const ns = translations.namespace('status');
    expect(typeof ns.t.dynamic).toBe('function');
    expect(ns.t.dynamic('active')).toBe('Active');
  });

  it('exists on forLocale translator too', () => {
    const instance = makeInstance();
    const translations = createTranslations(instance, 'en');
    const bg = translations.forLocale('en'); // no bg in fixture — use en for test
    expect(typeof bg.t.dynamic).toBe('function');
    expect(bg.t.dynamic('status.active')).toBe('Active');
  });
});
