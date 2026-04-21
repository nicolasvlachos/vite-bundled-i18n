// src/__tests__/react/I18nProvider.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createI18n } from '../../core/createI18n';
import { I18nProvider } from '../../react/I18nProvider';
import { useContext } from 'react';
import { I18nContext } from '../../react/context';
import type { I18nInstance } from '../../core/types';

function ContextReader() {
  const ctx = useContext(I18nContext);
  return <span data-testid="has-context">{ctx?.instance ? 'yes' : 'no'}</span>;
}

describe('I18nProvider', () => {
  let instance: I18nInstance;

  beforeEach(() => {
    instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en', 'bg'],
      localesDir: '/locales',
      dictionaries: {
        global: { keys: ['shared', 'global'] },
      },
    });
    instance.addResources('en', 'shared', { ok: 'OK', cancel: 'Cancel' });
    instance.addResources('en', 'global', { appName: 'My Store' });
  });

  it('renders children', () => {
    render(
      <I18nProvider instance={instance}>
        <span>Hello</span>
      </I18nProvider>,
    );
    expect(screen.getByText('Hello')).toBeDefined();
  });

  it('provides the i18n instance via context', () => {
    render(
      <I18nProvider instance={instance}>
        <ContextReader />
      </I18nProvider>,
    );
    expect(screen.getByTestId('has-context').textContent).toBe('yes');
  });

  it('uses serverResources instead of fetching dictionaries', () => {
    const serverInstance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
      dictionaries: { global: { keys: ['shared'] } },
    });
    // Don't add resources manually — they come from serverResources

    const serverResources = {
      shared: { ok: 'OK from server', cancel: 'Cancel from server' },
      global: { appName: 'Server Store' },
    };

    function Consumer() {
      const ctx = useContext(I18nContext);
      if (!ctx) return null;
      const value = ctx.instance.translate('en', 'shared.ok');
      return <span data-testid="value">{value}</span>;
    }

    render(
      <I18nProvider instance={serverInstance} serverResources={serverResources}>
        <Consumer />
      </I18nProvider>,
    );

    expect(screen.getByTestId('value').textContent).toBe('OK from server');
  });

  it('auto-hydrates from window.__I18N_RESOURCES__ when no serverResources prop', () => {
    // Set up window global
    (window as unknown as Record<string, unknown>).__I18N_RESOURCES__ = {
      locale: 'en',
      resources: { shared: { ok: 'OK from server' } },
    };

    const autoInstance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });

    function Consumer() {
      const ctx = useContext(I18nContext);
      if (!ctx) return null;
      const value = ctx.instance.translate('en', 'shared.ok');
      return <span data-testid="auto-value">{value}</span>;
    }

    render(
      <I18nProvider instance={autoInstance}>
        <Consumer />
      </I18nProvider>,
    );

    expect(screen.getByTestId('auto-value').textContent).toBe('OK from server');
    expect((window as unknown as Record<string, unknown>).__I18N_RESOURCES__).toBeUndefined();

    // Clean up in case test fails
    delete (window as unknown as Record<string, unknown>).__I18N_RESOURCES__;
  });

  it('still loads dictionaries when serverResources is not provided', () => {
    const plainInstance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });
    plainInstance.addResources('en', 'shared', { ok: 'OK' });

    render(
      <I18nProvider instance={plainInstance}>
        <ContextReader />
      </I18nProvider>,
    );

    expect(screen.getByTestId('has-context').textContent).toBe('yes');
  });

  // --- Provider gating tests ---

  it('1. gate blocks children and shows fallback during dictionary loading', async () => {
    const { vi } = await import('vitest');
    let resolveFetch!: (v: Response) => void;
    globalThis.fetch = vi.fn().mockReturnValue(
      new Promise<Response>(resolve => { resolveFetch = resolve; })
    );

    const gatedInstance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
      dictionaries: { global: { include: ['shared.*'], priority: 1 } },
    });

    render(
      <I18nProvider instance={gatedInstance} fallback={<div data-testid="loading">LOADING</div>}>
        <span data-testid="child">CHILD</span>
      </I18nProvider>,
    );

    // Children must NOT render — fallback must show
    expect(screen.queryByTestId('child')).toBeNull();
    expect(screen.getByTestId('loading').textContent).toBe('LOADING');

    // Resolve the dictionary fetch
    resolveFetch(new Response(JSON.stringify({ shared: { ok: 'OK' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    // Wait for state update
    await screen.findByTestId('child');
    expect(screen.getByTestId('child').textContent).toBe('CHILD');
    expect(screen.queryByTestId('loading')).toBeNull();

    globalThis.fetch = vi.fn();
  });

  it('2. provider remount with cached data renders immediately (no flash)', async () => {
    const { vi } = await import('vitest');
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ shared: { ok: 'OK' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const persistentInstance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
      dictionaries: { global: { include: ['shared.*'], priority: 1 } },
    });

    // First mount — loads dictionaries
    const { unmount } = render(
      <I18nProvider instance={persistentInstance} fallback={<div>LOADING</div>}>
        <span data-testid="child">CHILD</span>
      </I18nProvider>,
    );
    await screen.findByTestId('child');
    unmount();

    // Second mount — data is cached, should render immediately
    render(
      <I18nProvider instance={persistentInstance} fallback={<div data-testid="loading2">LOADING</div>}>
        <span data-testid="child2">CHILD2</span>
      </I18nProvider>,
    );

    // Must be immediate — no fallback
    expect(screen.getByTestId('child2').textContent).toBe('CHILD2');
    expect(screen.queryByTestId('loading2')).toBeNull();

    globalThis.fetch = vi.fn();
  });

  it('3. preloadScopes makes scope available immediately on navigation', async () => {
    const { vi } = await import('vitest');
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ quizzes: { index: { title: 'Quizzes' } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const preloadInstance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });

    render(
      <I18nProvider instance={preloadInstance} preloadScopes={['quizzes.index']}>
        <span data-testid="child">OK</span>
      </I18nProvider>,
    );

    await screen.findByTestId('child');

    // Scope should now be cached
    expect(preloadInstance.isScopeLoaded('en', 'quizzes.index')).toBe(true);

    globalThis.fetch = vi.fn();
  });

  it('4. changeLocale loads new data before notifying (no flash)', async () => {
    const { vi } = await import('vitest');
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ shared: { ok: 'OK' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const localeInstance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en', 'bg'],
      localesDir: '/locales',
      dictionaries: { global: { include: ['shared.*'], priority: 1 } },
    });

    function Consumer() {
      const ctx = useContext(I18nContext);
      return <span data-testid="locale">{ctx?.instance.getLocale()}</span>;
    }

    render(
      <I18nProvider instance={localeInstance} fallback={<div>LOADING</div>}>
        <Consumer />
      </I18nProvider>,
    );

    await screen.findByTestId('locale');

    // Switch locale — changeLocale awaits all refetches before notifying
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ shared: { ok: 'Добре' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await localeInstance.changeLocale('bg');

    // By the time onLocaleChange fires, BG data is already loaded
    expect(localeInstance.translate('bg', 'shared.ok')).toBe('Добре');

    globalThis.fetch = vi.fn();
  });

  it('5. eager: true renders children immediately during loading', async () => {
    const { vi } = await import('vitest');
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves

    const eagerInstance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
      dictionaries: { global: { include: ['shared.*'], priority: 1 } },
    });

    render(
      <I18nProvider instance={eagerInstance} eager fallback={<div data-testid="fb">FB</div>}>
        <span data-testid="eager-child">EAGER</span>
      </I18nProvider>,
    );

    // Children render immediately — fallback is NOT shown
    expect(screen.getByTestId('eager-child').textContent).toBe('EAGER');
    expect(screen.queryByTestId('fb')).toBeNull();

    globalThis.fetch = vi.fn();
  });

  it('6. no double-fetch on remount with cached data', async () => {
    const { vi } = await import('vitest');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ shared: { ok: 'OK' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    globalThis.fetch = fetchMock;

    const cacheInstance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
      dictionaries: { global: { include: ['shared.*'], priority: 1 } },
    });

    // First mount
    const { unmount } = render(
      <I18nProvider instance={cacheInstance} fallback={<div>L</div>}>
        <span>C</span>
      </I18nProvider>,
    );
    await screen.findByText('C');
    const fetchCountAfterFirst = fetchMock.mock.calls.length;
    unmount();

    // Second mount — should NOT fetch again
    render(
      <I18nProvider instance={cacheInstance} fallback={<div>L</div>}>
        <span>C2</span>
      </I18nProvider>,
    );
    expect(screen.getByText('C2')).toBeDefined();
    expect(fetchMock.mock.calls.length).toBe(fetchCountAfterFirst);

    globalThis.fetch = vi.fn();
  });

  it('7. fallback=null, fallback=undefined, and no fallback all render nothing during loading', async () => {
    const { vi } = await import('vitest');
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves

    const mkInstance = () => createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
      dictionaries: { global: { include: ['shared.*'], priority: 1 } },
    });

    // fallback={null}
    const { container: c1 } = render(
      <I18nProvider instance={mkInstance()} fallback={null}>
        <span>SHOULD NOT SHOW</span>
      </I18nProvider>,
    );
    expect(c1.innerHTML).toBe('');

    // fallback={undefined}
    const { container: c2 } = render(
      <I18nProvider instance={mkInstance()} fallback={undefined}>
        <span>SHOULD NOT SHOW</span>
      </I18nProvider>,
    );
    expect(c2.innerHTML).toBe('');

    // no fallback prop
    const { container: c3 } = render(
      <I18nProvider instance={mkInstance()}>
        <span>SHOULD NOT SHOW</span>
      </I18nProvider>,
    );
    expect(c3.innerHTML).toBe('');

    globalThis.fetch = vi.fn();
  });
});
