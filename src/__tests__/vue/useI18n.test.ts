import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { createI18n } from '../../core/createI18n';
import { createI18nPlugin, useI18n } from '../../vue';
import type { I18nInstance } from '../../core/types';

const originalFetch = globalThis.fetch;

function mockFetch() {
  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    const urlStr = String(url);
    if (urlStr.includes('/_dict/global')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ shared: { ok: 'OK', cancel: 'Cancel' } }),
      } as Response);
    }
    if (urlStr.includes('/products.show.json')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ products: { show: { title: 'Details' } } }),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
  });
}

function mountWithPlugin(instance: I18nInstance, setup: () => Record<string, unknown>) {
  const results: Record<string, unknown> = {};
  const TestComponent = defineComponent({
    setup() {
      const setupResult = setup();
      Object.assign(results, setupResult);
      return () => h('div');
    },
  });

  const app = createApp(TestComponent);
  app.use(createI18nPlugin(instance));

  const root = document.createElement('div');
  app.mount(root);

  return { results, app, root };
}

describe('useI18n', () => {
  beforeEach(() => {
    mockFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws when used without plugin', () => {
    const TestComponent = defineComponent({
      setup() {
        useI18n();
        return () => h('div');
      },
    });

    const app = createApp(TestComponent);
    const root = document.createElement('div');

    // Vue wraps setup errors — check for our message in the console
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => app.mount(root)).toThrow();
    consoleSpy.mockRestore();
  });

  it('returns t function and locale', () => {
    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });
    instance.addResources('en', 'shared', { ok: 'OK' });

    const { results } = mountWithPlugin(instance, () => {
      const { t, locale } = useI18n();
      return { t, locale: locale.value };
    });

    expect(results.locale).toBe('en');
    expect(typeof results.t).toBe('function');
  });

  it('t() resolves keys from loaded resources', () => {
    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });
    instance.addResources('en', 'shared', { ok: 'OK', cancel: 'Cancel' });

    let tFn: ((key: string) => string) | undefined;
    mountWithPlugin(instance, () => {
      const { t } = useI18n();
      tFn = t as (key: string) => string;
      return {};
    });

    expect(tFn!('shared.ok')).toBe('OK');
    expect(tFn!('shared.cancel')).toBe('Cancel');
  });

  it('ready is true when no scope provided and no dictionaries', () => {
    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });

    let readyVal: boolean | undefined;
    mountWithPlugin(instance, () => {
      const { ready } = useI18n();
      readyVal = ready.value;
      return {};
    });

    expect(readyVal).toBe(true);
  });

  it('scope loading with async fetch — ready starts false and becomes true after scope loads', async () => {
    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });

    // Use a container object so we can observe the ref after mount
    const captured: { ready?: ReturnType<typeof ref<boolean>> } = {};

    mountWithPlugin(instance, () => {
      const { ready } = useI18n('products.show');
      captured.ready = ready;
      return {};
    });

    // Immediately after mount (before onMounted async resolves) ready should be false
    expect(captured.ready!.value).toBe(false);

    // Wait for fetch promise to resolve and Vue to process updates
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();

    expect(captured.ready!.value).toBe(true);

    // Verify fetch was called with the scope URL
    const fetchCalls = (vi.mocked(globalThis.fetch) as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => String(c[0]),
    );
    expect(fetchCalls.some((url) => url.includes('/products.show.json'))).toBe(true);
  });

  it('dictionary loading — dictionaries are fetched and translations become available', async () => {
    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
      dictionaries: {
        global: { keys: ['shared'] },
      },
    });

    let tFn: ((key: string, fallback?: string) => string) | undefined;
    const captured: { ready?: ReturnType<typeof ref<boolean>> } = {};

    mountWithPlugin(instance, () => {
      const { t, ready } = useI18n();
      tFn = t as (key: string, fallback?: string) => string;
      captured.ready = ready;
      return {};
    });

    // Before dictionaries load, ready is false
    expect(captured.ready!.value).toBe(false);

    // Wait for dictionary fetch to resolve
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();

    expect(captured.ready!.value).toBe(true);

    // Translation should now be available from the mocked dictionary response
    expect(tFn!('shared.ok')).toBe('OK');
    expect(tFn!('shared.cancel')).toBe('Cancel');

    const fetchCalls = (vi.mocked(globalThis.fetch) as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => String(c[0]),
    );
    expect(fetchCalls.some((url) => url.includes('/_dict/global'))).toBe(true);
  });

  it('multiple t() calls resolve different namespaces after loading dictionaries and scope', async () => {
    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
      dictionaries: {
        global: { keys: ['shared'] },
      },
    });

    let tFn: ((key: string, fallback?: string) => string) | undefined;
    const captured: { ready?: ReturnType<typeof ref<boolean>> } = {};

    mountWithPlugin(instance, () => {
      const { t, ready } = useI18n('products.show');
      tFn = t as (key: string, fallback?: string) => string;
      captured.ready = ready;
      return {};
    });

    await new Promise((r) => setTimeout(r, 0));
    await nextTick();

    expect(captured.ready!.value).toBe(true);

    // Dictionary namespace
    expect(tFn!('shared.ok')).toBe('OK');
    // Scope namespace
    expect(tFn!('products.show.title')).toBe('Details');
  });

  it('tryGet returns undefined for missing keys', () => {
    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });
    instance.addResources('en', 'shared', { ok: 'OK' });

    let tryGetFn: ((key: string) => string | undefined) | undefined;
    mountWithPlugin(instance, () => {
      const { tryGet } = useI18n();
      tryGetFn = tryGet as (key: string) => string | undefined;
      return {};
    });

    expect(tryGetFn!('shared.nonexistent')).toBeUndefined();
    expect(tryGetFn!('missing.key')).toBeUndefined();
    // Existing key should still resolve
    expect(tryGetFn!('shared.ok')).toBe('OK');
  });

  it('require throws for missing keys', () => {
    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });
    instance.addResources('en', 'shared', { ok: 'OK' });

    let requireFn: ((key: string) => string) | undefined;
    mountWithPlugin(instance, () => {
      const { require: req } = useI18n();
      requireFn = req as (key: string) => string;
      return {};
    });

    expect(() => requireFn!('shared.nonexistent')).toThrow(
      /Missing required translation key/,
    );
    // Existing key should not throw
    expect(() => requireFn!('shared.ok')).not.toThrow();
    expect(requireFn!('shared.ok')).toBe('OK');
  });

  it('has/exists returns true for loaded keys and false for missing keys', () => {
    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });
    instance.addResources('en', 'shared', { ok: 'OK', cancel: 'Cancel' });

    let hasFn: ((key: string) => boolean) | undefined;
    let existsFn: ((key: string) => boolean) | undefined;
    mountWithPlugin(instance, () => {
      const { has, exists } = useI18n();
      hasFn = has;
      existsFn = exists;
      return {};
    });

    expect(hasFn!('shared.ok')).toBe(true);
    expect(hasFn!('shared.cancel')).toBe(true);
    expect(hasFn!('shared.missing')).toBe(false);
    expect(hasFn!('nonexistent.key')).toBe(false);

    // exists is an alias for has
    expect(existsFn!('shared.ok')).toBe(true);
    expect(existsFn!('shared.missing')).toBe(false);
  });

  it('exposes t.dynamic so runtime-computed keys resolve in Vue components', () => {
    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });
    instance.addResources('en', 'status', {
      active: 'Active',
      pending: 'Pending',
    });

    let dynamicFn: ((key: string) => string) | undefined;
    mountWithPlugin(instance, () => {
      const { t } = useI18n();
      dynamicFn = t.dynamic;
      return {};
    });

    expect(typeof dynamicFn).toBe('function');
    const state = 'active';
    expect(dynamicFn!(`status.${state}`)).toBe('Active');
    expect(dynamicFn!('status.missing', 'Unknown')).toBe('Unknown');
  });
});
