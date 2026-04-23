import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { createI18n } from '../../core/createI18n';
import { I18nProvider } from '../../react/I18nProvider';
import { I18nContext } from '../../react/context';
import { DevToolbar } from '../../react/DevToolbar';
import { useI18n } from '../../react/useI18n';
import type { I18nInstance } from '../../core/types';

function TestApp() {
  const { t } = useI18n();
  // Use instance.translate directly for invalid keys — it accepts string,
  // unlike t() which is constrained to TranslationKey when types are generated.
  const ctx = useContext(I18nContext);
  const missingValue = ctx?.instance.translate(ctx.instance.getLocale(), 'missing.key') ?? '';
  return (
    <div>
      <span>{t('shared.ok', 'OK')}</span>
      <span>{missingValue}</span>
      <DevToolbar />
    </div>
  );
}

describe('DevToolbar', () => {
  let instance: I18nInstance;

  beforeEach(() => {
    instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });
    instance.addResources('en', 'shared', { ok: 'OK' });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the toggle button', () => {
    render(
      <I18nProvider instance={instance}>
        <TestApp />
      </I18nProvider>,
    );
    const btn = screen.getByTestId('i18n-toolbar-toggle');
    expect(btn).toBeDefined();
  });

  it('shows key usage when expanded', () => {
    render(
      <I18nProvider instance={instance}>
        <TestApp />
      </I18nProvider>,
    );

    const btn = screen.getByTestId('i18n-toolbar-toggle');
    fireEvent.click(btn);

    return waitFor(() => {
      const panel = screen.getByTestId('i18n-toolbar-panel');
      expect(panel).toBeDefined();
      expect(panel.textContent).toContain('shared.ok');
    });
  });

  it('shows current locale', async () => {
    render(
      <I18nProvider instance={instance}>
        <TestApp />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByTestId('i18n-toolbar-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('i18n-toolbar-panel').textContent).toContain('en');
    });
  });

  it('shows missing keys', async () => {
    render(
      <I18nProvider instance={instance}>
        <TestApp />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByTestId('i18n-toolbar-toggle'));
    const panel = await screen.findByTestId('i18n-toolbar-panel');
    expect(panel.textContent).toContain('missing.key');
    expect(panel.textContent).toContain('Missing');
  });

  it('shows resolution groups', async () => {
    render(
      <I18nProvider instance={instance}>
        <TestApp />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByTestId('i18n-toolbar-toggle'));
    const panel = await screen.findByTestId('i18n-toolbar-panel');
    expect(panel.textContent).toContain('Primary');
  });

  it('displays key count on the toggle button', () => {
    render(
      <I18nProvider instance={instance}>
        <TestApp />
      </I18nProvider>,
    );

    const btn = screen.getByTestId('i18n-toolbar-toggle');
    // Should show the number of unique keys
    expect(btn.textContent).toMatch(/\d+/);
  });

  it('toggles panel open and closed', async () => {
    render(
      <I18nProvider instance={instance}>
        <TestApp />
      </I18nProvider>,
    );

    const btn = screen.getByTestId('i18n-toolbar-toggle');

    // Initially no panel
    expect(screen.queryByTestId('i18n-toolbar-panel')).toBeNull();

    // Open
    fireEvent.click(btn);
    await screen.findByTestId('i18n-toolbar-panel');

    // Close
    fireEvent.click(btn);
    expect(screen.queryByTestId('i18n-toolbar-panel')).toBeNull();
  });

  it('returns null outside provider', () => {
    const { container } = render(<DevToolbar />);
    expect(container.innerHTML).toBe('');
  });
});
