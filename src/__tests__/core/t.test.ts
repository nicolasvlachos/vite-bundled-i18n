import { describe, it, expect, beforeEach } from 'vitest';
import { createI18n } from '../../core/createI18n';
import {
  setGlobalInstance,
  getGlobalTranslations,
  t,
  hasKey,
  scopedT,
  resolveArgs,
} from '../../core/t';
import type { I18nInstance } from '../../core/types';

let instance: I18nInstance;

beforeEach(() => {
  instance = createI18n({
    locale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'bg'],
    localesDir: '/locales',
  });
  instance.addResources('en', 'products', {
    show: { title: 'Product Details', price: 'Price: {{amount}}' },
  });
  instance.addResources('en', 'shared', { ok: 'OK', cancel: 'Cancel' });
  instance.addResources('bg', 'shared', { ok: 'Добре' });
  setGlobalInstance(instance);
});

describe('resolveArgs', () => {
  it('handles key only', () => {
    expect(resolveArgs(['shared.ok'])).toEqual({
      key: 'shared.ok',
      params: undefined,
      fallback: undefined,
    });
  });

  it('detects string second arg as fallback', () => {
    expect(resolveArgs(['shared.ok', 'OK'])).toEqual({
      key: 'shared.ok',
      params: undefined,
      fallback: 'OK',
    });
  });

  it('detects object second arg as params', () => {
    expect(resolveArgs(['key', { n: 1 }])).toEqual({
      key: 'key',
      params: { n: 1 },
      fallback: undefined,
    });
  });

  it('handles params + fallback', () => {
    expect(resolveArgs(['key', { n: 1 }, 'Fallback'])).toEqual({
      key: 'key',
      params: { n: 1 },
      fallback: 'Fallback',
    });
  });

  it('treats null second arg as no params/fallback', () => {
    const result = resolveArgs(['key', null as unknown as string]);
    expect(result).toEqual({ key: 'key', params: undefined, fallback: undefined });
  });

  it('treats undefined second arg as no params/fallback', () => {
    const result = resolveArgs(['key', undefined as unknown as string]);
    expect(result).toEqual({ key: 'key', params: undefined, fallback: undefined });
  });

  it('rejects arrays as params — treats as no params', () => {
    const result = resolveArgs(['key', ['a', 'b'] as unknown as Record<string, unknown>]);
    expect(result).toEqual({ key: 'key', params: undefined, fallback: undefined });
  });

  it('accepts empty object as valid params', () => {
    expect(resolveArgs(['key', {}])).toEqual({
      key: 'key',
      params: {},
      fallback: undefined,
    });
  });
});

describe('global t()', () => {
  it('resolves a key', () => {
    expect(t('shared.ok')).toBe('OK');
  });

  it('resolves with fallback for missing key', () => {
    expect(instance.translate('en', 'missing.key', undefined, 'Default')).toBe('Default');
  });

  it('resolves with params', () => {
    expect(t('products.show.price', { amount: 42 })).toBe('Price: 42');
  });

  it('resolves with params and fallback', () => {
    expect(
      t('products.show.price', { amount: 42 }, 'Price: {{amount}}'),
    ).toBe('Price: 42');
  });

  it('throws when no global instance is set', () => {
    setGlobalInstance(null as unknown as I18nInstance);
    expect(() => t('shared.ok')).toThrow();
  });

  it('exposes normalized global translator object', () => {
    const translations = getGlobalTranslations();
    expect(translations.t('shared.ok')).toBe('OK');
    expect(translations.get('shared.ok')).toBe('OK');
    expect(translations.has('shared.ok')).toBe(true);
    expect(translations.tryGet('shared.missing')).toBeUndefined();
  });

  it('global translator tracks locale at call time', async () => {
    await instance.changeLocale('bg');
    const translations = getGlobalTranslations();
    expect(translations.locale).toBe('bg');
    expect(translations.t('shared.ok')).toBe('Добре');
  });
});

describe('hasKey (global)', () => {
  it('returns true for existing key', () => {
    expect(hasKey('shared.ok')).toBe(true);
  });

  it('returns false for missing key', () => {
    expect(hasKey('shared.missing')).toBe(false);
  });
});

describe('scopedT', () => {
  it('creates a translator bound to a language and namespace', () => {
    const translate = scopedT('en', 'products');
    expect(translate('show.title')).toBe('Product Details');
  });

  it('creates a translator with a key prefix', () => {
    const translate = scopedT('en', 'products', 'show');
    expect(translate('title')).toBe('Product Details');
  });

  it('resolves against a specific locale', () => {
    const translate = scopedT('bg', 'shared');
    expect(translate('ok')).toBe('Добре');
  });

  it('falls back when key is missing in target locale', () => {
    const translate = scopedT('bg', 'shared');
    expect(translate('cancel')).toBe('Cancel');
  });
});
