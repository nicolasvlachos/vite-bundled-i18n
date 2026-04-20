// src/__tests__/react/useI18n.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useContext } from 'react';
import { createI18n } from '../../core/createI18n';
import { I18nProvider } from '../../react/I18nProvider';
import { I18nContext } from '../../react/context';
import { useI18n } from '../../react/useI18n';
import type { I18nInstance } from '../../core/types';

let instance: I18nInstance;

beforeEach(() => {
  instance = createI18n({
    locale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'bg'],
    localesDir: '/locales',
    dictionaries: {
      global: { keys: ['shared'] },
    },
  });
  instance.addResources('en', 'shared', { ok: 'OK', cancel: 'Cancel' });
  instance.addResources('en', 'products', {
    show: { title: 'Product Details', price: 'Price: {{amount}}' },
  });
  instance.addResources('bg', 'shared', { ok: 'Добре' });
});

function DictionaryConsumer() {
  const { t, get, has, exists, tryGet, translations, ready, locale } = useI18n();
  if (!ready) return <span>loading</span>;
  return (
    <div>
      <span data-testid="value">{t('shared.ok', 'OK')}</span>
      <span data-testid="value-get">{get('shared.ok', 'OK')}</span>
      <span data-testid="has">{String(has('shared.ok'))}</span>
      <span data-testid="exists">{String(exists('shared.ok'))}</span>
      <span data-testid="try-get">{tryGet('shared.ok') ?? 'none'}</span>
      <span data-testid="translations-value">{translations.get('shared.ok', 'OK')}</span>
      <span data-testid="locale">{locale}</span>
    </div>
  );
}

function BundleConsumer({ scope }: { scope: string }) {
  const { t, ready } = useI18n(scope);
  if (!ready) return <span>loading</span>;
  return <span data-testid="value">{t('products.show.title', 'Product Details')}</span>;
}

function ParamsConsumer() {
  const { t, ready } = useI18n('products.show');
  if (!ready) return <span>loading</span>;
  return <span data-testid="value">{t('products.show.price', { amount: 42 }, 'Price: {{amount}}')}</span>;
}

function MissingKeyConsumer() {
  const { ready } = useI18n();
  const ctx = useContext(I18nContext);
  if (!ready) return <span>loading</span>;
  const value = ctx?.instance.translate(ctx.instance.getLocale(), 'nonexistent.key', undefined, 'Fallback') ?? '';
  return <span data-testid="value">{value}</span>;
}

describe('useI18n', () => {
  it('throws when used outside I18nProvider', () => {
    function BadComponent() {
      useI18n();
      return null;
    }
    // Suppress React error boundary console output
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<BadComponent />)).toThrow();
    spy.mockRestore();
  });

  it('returns t, ready, and locale without scope', () => {
    render(
      <I18nProvider instance={instance}>
        <DictionaryConsumer />
      </I18nProvider>,
    );
    expect(screen.getByTestId('value').textContent).toBe('OK');
    expect(screen.getByTestId('value-get').textContent).toBe('OK');
    expect(screen.getByTestId('has').textContent).toBe('true');
    expect(screen.getByTestId('exists').textContent).toBe('true');
    expect(screen.getByTestId('try-get').textContent).toBe('OK');
    expect(screen.getByTestId('translations-value').textContent).toBe('OK');
    expect(screen.getByTestId('locale').textContent).toBe('en');
  });

  it('loads namespace and resolves keys with scope', async () => {
    render(
      <I18nProvider instance={instance}>
        <BundleConsumer scope="products.show" />
      </I18nProvider>,
    );
    const el = await screen.findByTestId('value');
    expect(el.textContent).toBe('Product Details');
  });

  it('handles t() with params and fallback', async () => {
    render(
      <I18nProvider instance={instance}>
        <ParamsConsumer />
      </I18nProvider>,
    );
    const el = await screen.findByTestId('value');
    expect(el.textContent).toBe('Price: 42');
  });

  it('returns fallback for missing keys', () => {
    render(
      <I18nProvider instance={instance}>
        <MissingKeyConsumer />
      </I18nProvider>,
    );
    expect(screen.getByTestId('value').textContent).toBe('Fallback');
  });

  it('exposes translator aliases and require()', () => {
    function AliasConsumer() {
      const { t, get, translations, require: requireTranslation } = useI18n();
      return (
        <div>
          <span data-testid="same-ref">{String(t === get)}</span>
          <span data-testid="same-ref-object">{String(t === translations.t)}</span>
          <span data-testid="required">{requireTranslation('shared.ok')}</span>
        </div>
      );
    }

    render(
      <I18nProvider instance={instance}>
        <AliasConsumer />
      </I18nProvider>,
    );

    expect(screen.getByTestId('same-ref').textContent).toBe('true');
    expect(screen.getByTestId('same-ref-object').textContent).toBe('true');
    expect(screen.getByTestId('required').textContent).toBe('OK');
  });

  it('returns undefined from tryGet for unresolved keys', () => {
    function TryGetConsumer() {
      const { tryGet } = useI18n();
      return <span data-testid="value">{tryGet('shared.missing') ?? 'undefined'}</span>;
    }

    render(
      <I18nProvider instance={instance}>
        <TryGetConsumer />
      </I18nProvider>,
    );

    expect(screen.getByTestId('value').textContent).toBe('undefined');
  });
});
