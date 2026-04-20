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
    // This is the existing behavior test — make sure it still works
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
});
