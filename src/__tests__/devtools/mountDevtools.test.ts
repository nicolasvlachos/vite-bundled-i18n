import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { createI18n } from '../../core/createI18n';
import { mountI18nDevtools, type I18nDevtoolsHandle } from '../../devtools/mountDevtools';

describe('mountI18nDevtools', () => {
  let handle: I18nDevtoolsHandle | undefined;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    handle?.destroy();
    handle = undefined;
    document.body.innerHTML = '';
  });

  it('mounts a dev drawer with runtime and route diagnostics', () => {
    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
      dictionaries: {
        global: { include: ['shared.*'] },
      },
    });
    instance.addResources('en', 'shared', { ok: 'OK', cancel: 'Cancel' });
    instance.addResources('en', 'products', {
      index: { heading: 'All Products' },
    });
    instance.markDictionaryLoaded('en', 'global');
    instance.markScopeLoaded('en', 'products.index');

    instance.translate('en', 'shared.ok');
    instance.translate('en', 'products.index.heading');

    handle = mountI18nDevtools(instance, {
      getCurrentPath: () => '/products',
      getCurrentScope: () => 'products.index',
    });

    fireEvent.click(screen.getByTestId('i18n-toolbar-toggle'));

    const panel = screen.getByTestId('i18n-toolbar-panel');

    // Footprint panel: key usage entries
    expect(panel.textContent).toContain('shared.ok');
    expect(panel.textContent).toContain('products.index.heading');

    // Bundles panel: loaded dictionaries and scopes
    expect(panel.textContent).toContain('global');
    expect(panel.textContent).toContain('products.index');
  });
});
