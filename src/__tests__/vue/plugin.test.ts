import { describe, it, expect, afterEach } from 'vitest';
import { createApp, defineComponent, h } from 'vue';
import { createI18n } from '../../core/createI18n';
import { createI18nPlugin, useI18n } from '../../vue';

function createTestInstance() {
  return createI18n({
    locale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    localesDir: '/locales',
  });
}

describe('createI18nPlugin', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__I18N_RESOURCES__;
  });

  it('returns a Vue plugin object with install method', () => {
    const instance = createTestInstance();
    const plugin = createI18nPlugin(instance);
    expect(plugin).toHaveProperty('install');
    expect(typeof plugin.install).toBe('function');
  });

  it('plugin can be installed on a Vue app without errors', () => {
    const instance = createTestInstance();
    const plugin = createI18nPlugin(instance);
    const app = createApp(defineComponent({ render: () => h('div') }));
    expect(() => app.use(plugin)).not.toThrow();
  });

  it('auto-hydrates from window.__I18N_RESOURCES__', () => {
    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });

    (window as unknown as Record<string, unknown>).__I18N_RESOURCES__ = {
      locale: 'en',
      resources: { shared: { ok: 'OK from server' } },
    };

    const plugin = createI18nPlugin(instance);
    const app = createApp(defineComponent({ render: () => h('div') }));
    app.use(plugin);

    expect(instance.translate('en', 'shared.ok')).toBe('OK from server');
    expect((window as unknown as Record<string, unknown>).__I18N_RESOURCES__).toBeUndefined();
  });

  it('multiple components share the same i18n instance', () => {
    const instance = createI18n({
      locale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      localesDir: '/locales',
    });
    instance.addResources('en', 'shared', { ok: 'OK', greeting: 'Hello' });

    const plugin = createI18nPlugin(instance);

    // First component
    const tFns: Array<(key: string) => string> = [];

    const ComponentA = defineComponent({
      setup() {
        const { t } = useI18n();
        tFns.push(t as (key: string) => string);
        return () => h('div');
      },
    });

    const ComponentB = defineComponent({
      setup() {
        const { t } = useI18n();
        tFns.push(t as (key: string) => string);
        return () => h('div');
      },
    });

    // Mount ComponentA with the plugin
    const appA = createApp(ComponentA);
    appA.use(plugin);
    const rootA = document.createElement('div');
    appA.mount(rootA);

    // Mount ComponentB with the same plugin instance
    const appB = createApp(ComponentB);
    appB.use(plugin);
    const rootB = document.createElement('div');
    appB.mount(rootB);

    expect(tFns).toHaveLength(2);

    // Both components resolve the same translations from the shared instance
    expect(tFns[0]('shared.ok')).toBe('OK');
    expect(tFns[1]('shared.ok')).toBe('OK');
    expect(tFns[0]('shared.greeting')).toBe('Hello');
    expect(tFns[1]('shared.greeting')).toBe('Hello');

    // Adding a resource after mount is reflected by both components
    // (they share the same underlying instance)
    instance.addResources('en', 'shared', { ok: 'OK', greeting: 'Hello', bye: 'Bye' });
    expect(tFns[0]('shared.bye')).toBe('Bye');
    expect(tFns[1]('shared.bye')).toBe('Bye');
  });
});
