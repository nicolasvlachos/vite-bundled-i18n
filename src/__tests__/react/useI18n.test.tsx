// src/__tests__/react/useI18n.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { useContext } from 'react';
import { createI18n } from '../../core/createI18n';
import { I18nProvider } from '../../react/I18nProvider';
import { I18nContext } from '../../react/context';
import { useI18n } from '../../react/useI18n';
import type { I18nInstance } from '../../core/types';

let instance: I18nInstance;
const originalFetch = globalThis.fetch;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

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
  instance.markScopeLoaded('en', 'products.show');
  instance.addResources('bg', 'shared', { ok: 'Добре' });
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
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

  it('re-renders when an uncached scope finishes loading', async () => {
    const fetchDeferred = deferred<Response>();
    globalThis.fetch = vi.fn().mockReturnValue(fetchDeferred.promise);

    const uncachedInstance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });

    function ScopeConsumer() {
      const { t, ready } = useI18n('quizzes.index');
      return <span data-testid="value">{ready ? t('quizzes.index.title', 'Quizzes') : 'loading'}</span>;
    }

    render(
      <I18nProvider instance={uncachedInstance}>
        <ScopeConsumer />
      </I18nProvider>,
    );

    expect(screen.getByTestId('value').textContent).toBe('loading');

    fetchDeferred.resolve(jsonResponse({
      quizzes: { index: { title: 'Quizzes' } },
    }));

    await waitFor(() => {
      expect(screen.getByTestId('value').textContent).toBe('Quizzes');
    });
  });

  it('returns ready immediately for a cached scope', () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const cachedInstance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });
    cachedInstance.addResources('en', 'quizzes', {
      index: { title: 'Quizzes' },
    });
    cachedInstance.markScopeLoaded('en', 'quizzes.index');

    function ScopeConsumer() {
      const { t, ready } = useI18n('quizzes.index');
      return <span data-testid="value">{ready ? t('quizzes.index.title', 'Quizzes') : 'loading'}</span>;
    }

    render(
      <I18nProvider instance={cachedInstance}>
        <ScopeConsumer />
      </I18nProvider>,
    );

    expect(screen.getByTestId('value').textContent).toBe('Quizzes');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders cached scope translations immediately after remount', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      quizzes: { index: { title: 'Quizzes' } },
    }));
    globalThis.fetch = fetchMock;

    const cachedInstance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });

    function ScopeConsumer() {
      const { t, ready } = useI18n('quizzes.index');
      return <span data-testid="value">{ready ? t('quizzes.index.title', 'Quizzes') : 'loading'}</span>;
    }

    const { unmount } = render(
      <I18nProvider instance={cachedInstance}>
        <ScopeConsumer />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('value').textContent).toBe('Quizzes');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();

    render(
      <I18nProvider instance={cachedInstance}>
        <ScopeConsumer />
      </I18nProvider>,
    );

    expect(screen.getByTestId('value').textContent).toBe('Quizzes');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent scope loads across multiple consumers', async () => {
    const fetchDeferred = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(fetchDeferred.promise);
    globalThis.fetch = fetchMock;

    const dedupeInstance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });

    function ScopeConsumer({ testId }: { testId: string }) {
      const { t, ready } = useI18n('quizzes.show');
      return <span data-testid={testId}>{ready ? t('quizzes.show.title', 'Quiz') : 'loading'}</span>;
    }

    render(
      <I18nProvider instance={dedupeInstance}>
        <ScopeConsumer testId="first" />
        <ScopeConsumer testId="second" />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    fetchDeferred.resolve(jsonResponse({
      quizzes: { show: { title: 'Quiz' } },
    }));

    await waitFor(() => {
      expect(screen.getByTestId('first').textContent).toBe('Quiz');
      expect(screen.getByTestId('second').textContent).toBe('Quiz');
    });
  });

  it('re-fetches when the scope prop changes', async () => {
    const fetchMock = vi.fn((url: string | URL | Request) => {
      const value = String(url);
      if (value.includes('/quizzes.index.json')) {
        return Promise.resolve(jsonResponse({ quizzes: { index: { title: 'Index' } } }));
      }
      if (value.includes('/quizzes.show.json')) {
        return Promise.resolve(jsonResponse({ quizzes: { show: { title: 'Show' } } }));
      }
      return Promise.reject(new Error(`Unexpected URL: ${value}`));
    });
    globalThis.fetch = fetchMock;

    const scopedInstance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });

    function ScopeConsumer({ scope }: { scope: 'quizzes.index' | 'quizzes.show' }) {
      const { t, ready } = useI18n(scope);
      const key = scope === 'quizzes.index' ? 'quizzes.index.title' : 'quizzes.show.title';
      return <span data-testid="value">{ready ? t(key, 'Fallback') : 'loading'}</span>;
    }

    const { rerender } = render(
      <I18nProvider instance={scopedInstance}>
        <ScopeConsumer scope="quizzes.index" />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('value').textContent).toBe('Index');
    });

    rerender(
      <I18nProvider instance={scopedInstance}>
        <ScopeConsumer scope="quizzes.show" />
      </I18nProvider>,
    );

    expect(screen.getByTestId('value').textContent).toBe('loading');

    await waitFor(() => {
      expect(screen.getByTestId('value').textContent).toBe('Show');
    });
  });

  it('ignores stale scope completions after the locale changes', async () => {
    const enFetch = deferred<Response>();
    const bgFetch = deferred<Response>();
    const fetchMock = vi.fn((url: string | URL | Request) => {
      const value = String(url);
      if (value.includes('/en/quizzes.index.json')) {
        return enFetch.promise;
      }
      if (value.includes('/bg/quizzes.index.json')) {
        return bgFetch.promise;
      }
      return Promise.reject(new Error(`Unexpected URL: ${value}`));
    });
    globalThis.fetch = fetchMock;

    const raceInstance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en', 'bg'],
      localesDir: '/locales',
    });

    function ScopeConsumer() {
      const { t, ready, locale } = useI18n('quizzes.index');
      return (
        <span data-testid="value">
          {ready ? `${locale}:${t('quizzes.index.title', 'Fallback')}` : 'loading'}
        </span>
      );
    }

    render(
      <I18nProvider instance={raceInstance}>
        <ScopeConsumer />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/__i18n/en/quizzes.index.json');
    });

    await act(async () => {
      await raceInstance.changeLocale('bg');
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/__i18n/bg/quizzes.index.json');
    });

    enFetch.resolve(jsonResponse({
      quizzes: { index: { title: 'English Quiz' } },
    }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('value').textContent).toBe('loading');

    bgFetch.resolve(jsonResponse({
      quizzes: { index: { title: 'Български тест' } },
    }));

    await waitFor(() => {
      expect(screen.getByTestId('value').textContent).toBe('bg:Български тест');
    });
  });
});
