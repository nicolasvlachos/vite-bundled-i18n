/**
 * Testing helpers for apps that use vite-bundled-i18n.
 *
 * Provides a synchronous `createTestI18n()` that bypasses the fetch layer
 * and the readiness gate — no network, no pending promises, no waiting for
 * `ready` transitions. Drop the returned instance into
 * `<I18nTestProvider>` (React), `app.use(createI18nTestPlugin(instance))`
 * (Vue), or call it directly from a unit test.
 *
 * Not recommended for production. The point is deterministic tests.
 */
import { createElement, type ReactElement, type ReactNode } from 'react';
import type { Plugin as VuePlugin } from 'vue';
import { createI18n } from './core/createI18n';
import { I18nContext } from './react/context';
import { createI18nPlugin } from './vue';
import type { I18nInstance, NestedTranslations } from './core/types';

export interface CreateTestI18nOptions {
  /**
   * Seed translations, keyed by namespace. Shape matches a locale JSON file.
   *
   * ```ts
   * translations: {
   *   shared: { ok: 'OK' },
   *   products: { show: { title: 'Details' } },
   * }
   * ```
   */
  translations: Record<string, NestedTranslations>;
  /** Active locale. Default: `'en'`. */
  locale?: string;
  /** Fallback locale. Default: same as `locale`. */
  defaultLocale?: string;
  /** Supported locales. Default: `[locale]`. */
  supportedLocales?: string[];
  /**
   * When `true` (default), missing keys fall through to the key string —
   * matches the usual dev behavior. Set `false` to have `translate()`
   * throw instead, turning missing-key bugs into test failures.
   */
  passthroughMissing?: boolean;
}

/**
 * Create a synchronous, network-free {@link I18nInstance} for tests.
 *
 * Seed translations are installed via `addResources`. No fetches happen.
 * The readiness gate starts (and stays) at `ready: true` — `GateBoundary`
 * / `useGate` consumers render immediately.
 */
export function createTestI18n(options: CreateTestI18nOptions): I18nInstance {
  const locale = options.locale ?? 'en';
  const defaultLocale = options.defaultLocale ?? locale;
  const supportedLocales = options.supportedLocales ?? [locale];

  const instance = createI18n({
    locale,
    defaultLocale,
    supportedLocales,
    localesDir: '/locales', // unused — nothing fetches in test mode
  });

  for (const [namespace, data] of Object.entries(options.translations)) {
    instance.addResources(locale, namespace, data);
  }

  if (options.passthroughMissing === false) {
    const original = instance.translate;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (instance as any).translate = (
      loc: string,
      key: string,
      params?: Record<string, unknown>,
      fallback?: string,
    ) => {
      if (!instance.hasKey(loc, key) && fallback === undefined) {
        throw new Error(
          `vite-bundled-i18n (test): Missing translation for "${key}" in locale "${loc}". ` +
            `Seed it in createTestI18n({ translations: { ... } }) or pass passthroughMissing: true.`,
        );
      }
      return original(loc, key as never, params, fallback);
    };
  }

  return instance;
}

/**
 * React test provider. Mounts the context directly with `dictsReady: true`
 * so consumers render without waiting for an async hydration cycle.
 *
 * ```tsx
 * const i18n = createTestI18n({ translations: { ... } });
 * render(
 *   <I18nTestProvider instance={i18n}>
 *     <MyComponent />
 *   </I18nTestProvider>,
 * );
 * ```
 */
export function I18nTestProvider(props: {
  instance: I18nInstance;
  children: ReactNode;
}): ReactElement {
  return createElement(
    I18nContext.Provider,
    { value: { instance: props.instance, version: 0, dictsReady: true } },
    props.children,
  );
}

/**
 * Vue test plugin. Alias of `createI18nPlugin` under a name that's
 * unambiguous in test imports. Same runtime behavior as the prod plugin —
 * the paired `createTestI18n` is what skips the async surface.
 */
export function createI18nTestPlugin(instance: I18nInstance): VuePlugin {
  return createI18nPlugin(instance);
}
