import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createTestI18n, I18nTestProvider } from '../testing';
import { useI18n } from '../react/useI18n';
import { useGate } from '../react/useGate';

describe('createTestI18n', () => {
  it('creates a ready-by-default instance with seeded translations', () => {
    const i18n = createTestI18n({
      translations: {
        shared: { ok: 'OK' },
        products: { show: { title: 'Details' } },
      },
    });

    expect(i18n.translate('en', 'shared.ok')).toBe('OK');
    expect(i18n.translate('en', 'products.show.title')).toBe('Details');
    expect(i18n.gate.ready).toBe(true);
  });

  it('honors custom locale / defaultLocale / supportedLocales', () => {
    const i18n = createTestI18n({
      locale: 'bg',
      defaultLocale: 'en',
      supportedLocales: ['en', 'bg'],
      translations: { shared: { ok: 'Добре' } },
    });
    expect(i18n.getLocale()).toBe('bg');
    expect(i18n.config.defaultLocale).toBe('en');
    expect(i18n.config.supportedLocales).toEqual(['en', 'bg']);
  });

  it('passthroughMissing=false throws on missing keys', () => {
    const i18n = createTestI18n({
      translations: { shared: { ok: 'OK' } },
      passthroughMissing: false,
    });
    expect(() => i18n.translate('en', 'nonexistent.key')).toThrow(
      /Missing translation for "nonexistent\.key"/,
    );
  });

  it('passthroughMissing=false still honors explicit fallbacks', () => {
    const i18n = createTestI18n({
      translations: { shared: { ok: 'OK' } },
      passthroughMissing: false,
    });
    expect(i18n.translate('en', 'nonexistent.key', undefined, 'Fallback')).toBe('Fallback');
  });

  it('default passthroughMissing=true degrades to the key string', () => {
    const i18n = createTestI18n({ translations: { shared: { ok: 'OK' } } });
    expect(i18n.translate('en', 'nonexistent.key')).toBe('nonexistent.key');
  });
});

describe('I18nTestProvider', () => {
  it('mounts the context with dictsReady=true so consumers render immediately', () => {
    const i18n = createTestI18n({ translations: { shared: { greet: 'Hello' } } });

    function Probe() {
      const { t, ready } = useI18n();
      return (
        <>
          <span data-testid="ready">{String(ready)}</span>
          <span data-testid="text">{t('shared.greet', 'Hello')}</span>
        </>
      );
    }

    render(
      <I18nTestProvider instance={i18n}>
        <Probe />
      </I18nTestProvider>,
    );

    expect(screen.getByTestId('ready').textContent).toBe('true');
    expect(screen.getByTestId('text').textContent).toBe('Hello');
  });

  it('exposes the gate to useGate consumers', () => {
    const i18n = createTestI18n({ translations: {} });

    function Probe() {
      const { ready, pendingCount } = useGate();
      return (
        <>
          <span data-testid="gate-ready">{String(ready)}</span>
          <span data-testid="gate-count">{String(pendingCount)}</span>
        </>
      );
    }

    render(
      <I18nTestProvider instance={i18n}>
        <Probe />
      </I18nTestProvider>,
    );

    expect(screen.getByTestId('gate-ready').textContent).toBe('true');
    expect(screen.getByTestId('gate-count').textContent).toBe('0');
  });
});
