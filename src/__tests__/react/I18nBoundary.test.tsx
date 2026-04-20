import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../../react/I18nProvider';
import { I18nBoundary } from '../../react/I18nBoundary';
import { useI18n } from '../../react/useI18n';
import { createI18n } from '../../core/createI18n';

function TestConsumer() {
  const { t } = useI18n();
  return <span data-testid="content">{t('shared.ok', 'OK')}</span>;
}

describe('I18nBoundary', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('shows fallback while loading, then children when ready', async () => {
    let resolveFetch!: (value: Response) => void;
    globalThis.fetch = vi.fn().mockReturnValue(
      new Promise<Response>(resolve => { resolveFetch = resolve; })
    );

    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });
    instance.addResources('en', 'shared', { ok: 'OK' });

    render(
      <I18nProvider instance={instance}>
        <I18nBoundary scope="products.index" fallback={<span data-testid="loading">Loading</span>}>
          <TestConsumer />
        </I18nBoundary>
      </I18nProvider>,
    );

    expect(screen.getByTestId('loading')).toBeDefined();

    resolveFetch(new Response(JSON.stringify({ products: { index: { heading: 'Hi' } } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await waitFor(() => {
      expect(screen.getByTestId('content')).toBeDefined();
    });
  });

  it('renders children immediately when scope is already loaded', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ products: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });
    instance.addResources('en', 'shared', { ok: 'OK' });

    // Pre-load the scope
    await instance.loadScope('en', 'products.index');

    render(
      <I18nProvider instance={instance}>
        <I18nBoundary scope="products.index" fallback={<span data-testid="loading">Loading</span>}>
          <TestConsumer />
        </I18nBoundary>
      </I18nProvider>,
    );

    // Should show content immediately, not fallback
    expect(screen.getByTestId('content')).toBeDefined();
    expect(screen.queryByTestId('loading')).toBeNull();
  });

  it('renders children with no fallback when fallback prop is omitted', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });

    await instance.loadScope('en', 'my.scope');

    render(
      <I18nProvider instance={instance}>
        <I18nBoundary scope="my.scope">
          <span data-testid="child">Loaded</span>
        </I18nBoundary>
      </I18nProvider>,
    );

    expect(screen.getByTestId('child')).toBeDefined();
  });
});
