/**
 * Regression test for the v0.7.1 lean-bundle cross-scope bug.
 *
 * Consumer-reported scenario, exactly:
 *
 *   1. User lands on /protocols. Plugin packs `protocols.index`'s lean
 *      bundle. The page imports a `<VoucherSuggestionCard>`, so the
 *      response cross-namespace-packs `vouchers.suggestions.*` (and
 *      ONLY that subset of vouchers).
 *   2. Runtime stores the response, marks namespace `vouchers` as
 *      having data.
 *   3. User clicks a `<Link>` to /vouchers. Component calls
 *      `loadScope('vouchers.voucher-groups.index')`. The lean response
 *      for THAT scope would contain `vouchers.voucher-groups.*`,
 *      `vouchers.pages.*`, etc.
 *   4. Pre-v0.7.1 bug: runtime sees namespace `vouchers` has data →
 *      short-circuits the fetch → store still has only
 *      `vouchers.suggestions.*` → every other `vouchers.*` key
 *      returns missing.
 *   5. Post-v0.7.1 fix: runtime always fetches when the scope hasn't
 *      been explicitly marked loaded; the store deep-merges; both
 *      slices coexist; B's keys resolve.
 *
 * The fix removed two namespace-presence-as-scope-completeness checks
 * (one in `bundle-loader.ts:loadScope`, one in
 * `cache-manager.ts:isScopeLoaded`). This test exercises the full
 * runtime path through `createI18n` so a regression to either site
 * would re-fail it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createI18n } from '../../core/createI18n';

describe('bug: lean-bundle cross-scope namespace dedup (v0.7.1 fix)', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { __VITE_I18N_DEV__?: boolean }).__VITE_I18N_DEV__ = true;
    vi.spyOn(globalThis, 'fetch').mockReset();
  });

  it('two scopes sharing a namespace: second scope still loads its keys after first scope brought a slice in via cross-ns pack', async () => {
    // Mock /_scope/protocols.json — primary protocols + cross-ns vouchers slice (suggestions only).
    // Mock /_scope/vouchers.json — the union of vouchers.* across all vouchers scopes.
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/_scope/protocols.json')) {
        return new Response(JSON.stringify({
          protocols: { index: { title: 'Protocols' } },
          // Cross-namespace pack — only the suggestions slice of vouchers.
          vouchers: { suggestions: { card: { headline: 'Suggested' } } },
        }), { status: 200 });
      }
      if (url.endsWith('/_scope/vouchers.json')) {
        return new Response(JSON.stringify({
          vouchers: {
            'voucher-groups': { index: { title: 'Voucher groups', empty: 'No groups yet' } },
            pages: { dashboard: { title: 'Dashboard' } },
            // Suggestions also present (the union endpoint includes everything).
            suggestions: { card: { headline: 'Suggested' } },
          },
        }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });

    const i18n = createI18n({
      locale: 'en',
      supportedLocales: ['en'],
      defaultLocale: 'en',
      localesDir: '/locales',
      addMissing: false,
    });

    // STEP 1: simulate landing on /protocols.
    await i18n.loadScope('en', 'protocols.index');

    // First fetch happened, vouchers slice landed in the store.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/__i18n/en/_scope/protocols.json');
    expect(i18n.translate('en', 'vouchers.suggestions.card.headline')).toBe('Suggested');

    // STEP 2: pre-fix bug check — sibling scope must NOT be considered
    // loaded just because the namespace has data.
    expect(i18n.isScopeLoaded('en', 'vouchers.voucher-groups.index')).toBe(false);

    // STEP 3: navigate to /vouchers — loadScope for the unrelated scope
    // in the same namespace.
    await i18n.loadScope('en', 'vouchers.voucher-groups.index');

    // Pre-fix this fetch was SKIPPED. Post-fix it fires.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith('/__i18n/en/_scope/vouchers.json');

    // STEP 4: the actual user-visible symptom — every voucher-groups
    // key resolves, AND the original suggestions slice survived (deep
    // merge, not overwrite).
    expect(i18n.translate('en', 'vouchers.voucher-groups.index.title')).toBe('Voucher groups');
    expect(i18n.translate('en', 'vouchers.voucher-groups.index.empty')).toBe('No groups yet');
    expect(i18n.translate('en', 'vouchers.pages.dashboard.title')).toBe('Dashboard');
    // The original suggestions slice is preserved by the deep-merge in mergeTranslations.
    expect(i18n.translate('en', 'vouchers.suggestions.card.headline')).toBe('Suggested');
    // And the original protocols data is untouched.
    expect(i18n.translate('en', 'protocols.index.title')).toBe('Protocols');

    // Both scopes now correctly report loaded.
    expect(i18n.isScopeLoaded('en', 'protocols.index')).toBe(true);
    expect(i18n.isScopeLoaded('en', 'vouchers.voucher-groups.index')).toBe(true);
  });

  it('back-to-back loadScope of the SAME scope still dedupes (no regression to over-fetching)', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ products: { index: { title: 'Products' } } }),
      { status: 200 },
    ));

    const i18n = createI18n({
      locale: 'en',
      supportedLocales: ['en'],
      defaultLocale: 'en',
      localesDir: '/locales',
      addMissing: false,
    });

    await i18n.loadScope('en', 'products.index');
    await i18n.loadScope('en', 'products.index');
    await i18n.loadScope('en', 'products.index');

    // Only the first call should have fired a fetch — `loadedScopes`
    // dedup is intact.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
