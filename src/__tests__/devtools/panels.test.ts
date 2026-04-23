import { describe, it, expect } from 'vitest';
import { renderFootprintPanel } from '../../devtools/panels/footprint';
import { renderBundlesPanel } from '../../devtools/panels/bundles';
import type { BundlesPanelData } from '../../devtools/panels/bundles';
import { renderInspectorPanel } from '../../devtools/panels/inspector';
import type { KeyUsageEntry } from '../../core/types';

/* ------------------------------------------------------------------ */
/*  Footprint panel                                                    */
/* ------------------------------------------------------------------ */

const testStore = {
  shared: { ok: 'OK', cancel: 'Cancel' },
  cart: { title: 'Your Cart' },
};

describe('footprint panel', () => {
  it('renders keys with their resolved values and highlights missing', () => {
    const usage: KeyUsageEntry[] = [
      { key: 'shared.ok', namespace: 'shared', locale: 'en', resolvedFrom: 'primary' },
      { key: 'shared.cancel', namespace: 'shared', locale: 'en', resolvedFrom: 'fallback-locale' },
      { key: 'cart.title', namespace: 'cart', locale: 'en', resolvedFrom: 'key-as-value' },
    ];

    const html = renderFootprintPanel('en', 'checkout', usage, testStore);

    // Shows resolved count and missing count
    expect(html).toContain('1 resolved');
    expect(html).toContain('1 missing');

    // Missing keys section
    expect(html).toContain('Missing');
    expect(html).toContain('cart.title');

    // Shows actual key values
    expect(html).toContain('OK');
    expect(html).toContain('Cancel');
  });

  it('groups keys by namespace with key counts', () => {
    const usage: KeyUsageEntry[] = [
      { key: 'shared.ok', namespace: 'shared', locale: 'en', resolvedFrom: 'primary' },
      { key: 'shared.cancel', namespace: 'shared', locale: 'en', resolvedFrom: 'primary' },
      { key: 'cart.title', namespace: 'cart', locale: 'en', resolvedFrom: 'primary' },
    ];

    const html = renderFootprintPanel('en', undefined, usage, testStore);

    expect(html).toContain('shared');
    expect(html).toContain('cart');
    expect(html).toContain('2 keys');
    expect(html).toContain('1 key');
  });

  it('handles empty usage', () => {
    const html = renderFootprintPanel('en', undefined, [], {});

    expect(html).toContain('No key usage recorded yet');
    expect(html).not.toContain('Missing');
  });
});

/* ------------------------------------------------------------------ */
/*  Bundles panel                                                      */
/* ------------------------------------------------------------------ */

describe('bundles panel', () => {
  const baseData: BundlesPanelData = {
    loadedDictionaries: ['common'],
    loadedScopes: ['checkout'],
    loadedNamespaces: ['shared', 'cart', 'checkout'],
    cacheStats: {
      totalLocales: 2,
      totalNamespaces: 5,
      approxTotalBytes: 4096,
      pinnedNamespaces: 1,
      loadedScopes: 1,
      loadedDictionaries: 1,
    },
    residentKeyCount: 150,
    namespaceDetails: [
      { namespace: 'shared', source: 'dictionary', pinned: true, approxBytes: 1024, keyCount: 50 },
      { namespace: 'cart', source: 'scope', pinned: false, approxBytes: 512, keyCount: 30 },
      { namespace: 'checkout', source: 'manual', pinned: false, approxBytes: 256, keyCount: 20 },
    ],
    store: { shared: { ok: 'OK' }, cart: { title: 'Cart' }, checkout: { step: 'Step' } },
  };

  it('renders dictionaries and scopes with key counts', () => {
    const html = renderBundlesPanel(baseData);

    expect(html).toContain('common');
    expect(html).toContain('checkout');
    expect(html).toContain('Dictionaries');
    expect(html).toContain('Scopes');
  });

  it('renders namespace details with source and size', () => {
    const html = renderBundlesPanel(baseData);

    expect(html).toContain('Namespaces');
    expect(html).toContain('shared');
    expect(html).toContain('1.0 KB');
    expect(html).toContain('512 B');
    expect(html).toContain('PINNED');
  });

  it('renders summary stats', () => {
    const html = renderBundlesPanel(baseData);

    expect(html).toContain('150 keys');
    expect(html).toContain('3 namespaces');
  });

  it('handles empty state', () => {
    const emptyData: BundlesPanelData = {
      loadedDictionaries: [],
      loadedScopes: [],
      loadedNamespaces: [],
      cacheStats: {
        totalLocales: 0,
        totalNamespaces: 0,
        approxTotalBytes: 0,
        pinnedNamespaces: 0,
        loadedScopes: 0,
        loadedDictionaries: 0,
      },
      residentKeyCount: 0,
      namespaceDetails: [],
      store: {},
    };

    const html = renderBundlesPanel(emptyData);
    expect(html).toContain('0 keys');
  });
});

/* ------------------------------------------------------------------ */
/*  Inspector panel                                                    */
/* ------------------------------------------------------------------ */

describe('inspector panel', () => {
  it('renders namespace data as JSON with key counts', () => {
    const store = {
      shared: { ok: 'OK', cancel: 'Cancel' },
      cart: { title: 'Your Cart', items: { one: '1 item' } },
    };

    const html = renderInspectorPanel(['shared', 'cart'], store);

    expect(html).toContain('shared');
    expect(html).toContain('cart');
    expect(html).toContain('2 keys'); // shared has 2 leaf keys
    expect(html).toContain('&quot;OK&quot;');
    expect(html).toContain('<pre');
  });

  it('renders empty state when no namespaces', () => {
    const html = renderInspectorPanel([], {});
    expect(html).toContain('No namespaces loaded.');
  });
});
