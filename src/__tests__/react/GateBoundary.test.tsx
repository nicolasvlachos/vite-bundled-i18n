import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import { I18nProvider } from '../../react/I18nProvider';
import { GateBoundary } from '../../react/GateBoundary';
import { useGate } from '../../react/useGate';
import { createI18n } from '../../core/createI18n';

describe('useGate', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns ready=true and pendingCount=0 when idle', async () => {
    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });

    function Probe() {
      const { ready, pendingCount } = useGate();
      return (
        <>
          <span data-testid="ready">{String(ready)}</span>
          <span data-testid="count">{String(pendingCount)}</span>
        </>
      );
    }

    render(
      <I18nProvider instance={instance}>
        <Probe />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('ready').textContent).toBe('true');
      expect(screen.getByTestId('count').textContent).toBe('0');
    });
  });

  it('re-renders when the gate transitions', async () => {
    let resolveFetch!: (r: Response) => void;
    globalThis.fetch = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    );

    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });

    function Probe() {
      const { ready } = useGate();
      return <span data-testid="ready">{String(ready)}</span>;
    }

    render(
      <I18nProvider instance={instance}>
        <Probe />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('ready').textContent).toBe('true');
    });

    await act(async () => {
      void instance.loadScope('en', 'products.index');
    });

    await waitFor(() => {
      expect(screen.getByTestId('ready').textContent).toBe('false');
    });

    await act(async () => {
      resolveFetch(new Response(JSON.stringify({ products: { index: { heading: 'Hi' } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('ready').textContent).toBe('true');
    });
  });

  it('throws a helpful error when used outside <I18nProvider>', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Probe() {
      useGate();
      return null;
    }
    expect(() => render(<Probe />)).toThrow(/useGate\(\) must be used within an <I18nProvider>/);
    spy.mockRestore();
  });
});

describe('GateBoundary (overlay mode)', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('always mounts children and overlays the fallback while not ready', async () => {
    let resolveFetch!: (r: Response) => void;
    globalThis.fetch = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    );

    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });

    render(
      <I18nProvider instance={instance}>
        <GateBoundary fallback={<span data-testid="overlay">Loading</span>}>
          <span data-testid="child">content</span>
        </GateBoundary>
      </I18nProvider>,
    );

    // Idle — child visible, overlay hidden.
    await waitFor(() => {
      expect(screen.getByTestId('child')).toBeDefined();
      expect(screen.queryByTestId('overlay')).toBeNull();
    });

    // Start a load — overlay appears but child stays mounted.
    await act(async () => { void instance.loadScope('en', 'products.index'); });
    await waitFor(() => {
      expect(screen.getByTestId('child')).toBeDefined();
      expect(screen.getByTestId('overlay')).toBeDefined();
    });

    // Resolve — overlay disappears.
    await act(async () => {
      resolveFetch(new Response(JSON.stringify({ products: { index: { heading: 'Hi' } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('overlay')).toBeNull();
    });
  });
});

describe('GateBoundary (suspense mode)', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('suspends rendering when suspense={true} and the gate is pending', async () => {
    let resolveFetch!: (r: Response) => void;
    globalThis.fetch = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    );

    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });

    // Register BEFORE render so the initial render suspends.
    const promise = instance.loadScope('en', 'products.index');

    render(
      <I18nProvider instance={instance}>
        <Suspense fallback={<span data-testid="suspended">Loading</span>}>
          <GateBoundary suspense>
            <span data-testid="child">content</span>
          </GateBoundary>
        </Suspense>
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('suspended')).toBeDefined();
      expect(screen.queryByTestId('child')).toBeNull();
    });

    await act(async () => {
      resolveFetch(new Response(JSON.stringify({ products: { index: { heading: 'Hi' } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
      await promise;
    });

    await waitFor(() => {
      expect(screen.getByTestId('child')).toBeDefined();
    });
  });
});
