import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApp, defineComponent, h, nextTick, type Ref } from 'vue';
import { createI18n } from '../../core/createI18n';
import { createI18nPlugin, useGate } from '../../vue';
import type { I18nInstance } from '../../core/types';

const originalFetch = globalThis.fetch;

function mountWithGate(
  instance: I18nInstance,
): { ready: Ref<boolean>; pendingCount: Ref<number>; destroy: () => void } {
  const captured: Partial<{ ready: Ref<boolean>; pendingCount: Ref<number> }> = {};
  const TestComponent = defineComponent({
    setup() {
      const { ready, pendingCount } = useGate();
      captured.ready = ready;
      captured.pendingCount = pendingCount;
      return () => h('div');
    },
  });
  const app = createApp(TestComponent);
  app.use(createI18nPlugin(instance));
  const root = document.createElement('div');
  app.mount(root);
  return {
    ready: captured.ready!,
    pendingCount: captured.pendingCount!,
    destroy() { app.unmount(); },
  };
}

describe('Vue useGate', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws when used outside the i18n plugin', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const TestComponent = defineComponent({
      setup() { useGate(); return () => h('div'); },
    });
    const app = createApp(TestComponent);
    const root = document.createElement('div');
    expect(() => app.mount(root)).toThrow(/useGate\(\) must be used in a component with the i18n plugin installed/);
    spy.mockRestore();
  });

  it('starts ready with zero pending', () => {
    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });

    const { ready, pendingCount, destroy } = mountWithGate(instance);
    expect(ready.value).toBe(true);
    expect(pendingCount.value).toBe(0);
    destroy();
  });

  it('reactively updates on scope load/settle', async () => {
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

    const { ready, pendingCount, destroy } = mountWithGate(instance);
    await nextTick();

    const loadPromise = instance.loadScope('en', 'products.index');
    await nextTick();

    expect(ready.value).toBe(false);
    expect(pendingCount.value).toBe(1);

    resolveFetch({
      ok: true,
      json: () => Promise.resolve({ products: { index: { heading: 'All' } } }),
    } as Response);
    await loadPromise;
    await nextTick();

    expect(ready.value).toBe(true);
    expect(pendingCount.value).toBe(0);
    destroy();
  });
});
