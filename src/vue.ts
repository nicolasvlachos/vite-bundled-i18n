import {
  inject,
  ref,
  onMounted,
  onUnmounted,
  type Plugin,
  type InjectionKey,
  type Ref,
} from 'vue';
import { createTranslations } from './core/getTranslations';
import type {
  I18nInstance,
  NestedTranslations,
  TFunction,
  TryTFunction,
  RequireTFunction,
  HasKeyFunction,
  Translations,
} from './core/types';

const I18N_INJECTION_KEY: InjectionKey<I18nInstance> = Symbol('vite-bundled-i18n');

/**
 * Creates a Vue plugin that provides the i18n instance to all components.
 */
export function createI18nPlugin(instance: I18nInstance): Plugin {
  return {
    install(app) {
      // Auto-hydrate from server-injected global
      const win = typeof window !== 'undefined'
        ? (window as Window & {
          __I18N_RESOURCES__?: {
            locale: string;
            resources: Record<string, NestedTranslations>;
            scopes?: string[];
            dictionaries?: string[];
          };
        })
        : undefined;
      if (win?.__I18N_RESOURCES__) {
        const serverData = win.__I18N_RESOURCES__;
        for (const [namespace, data] of Object.entries(serverData.resources)) {
          instance.addResources(serverData.locale, namespace, data);
        }
        for (const scope of serverData.scopes ?? []) {
          instance.markScopeLoaded(serverData.locale, scope);
        }
        for (const dictionary of serverData.dictionaries ?? []) {
          instance.markDictionaryLoaded(serverData.locale, dictionary);
        }
        delete win.__I18N_RESOURCES__;
      }

      app.provide(I18N_INJECTION_KEY, instance);
    },
  };
}

export interface UseI18nReturn {
  t: TFunction;
  get: TFunction;
  has: HasKeyFunction;
  exists: HasKeyFunction;
  tryGet: TryTFunction;
  require: RequireTFunction;
  translations: Ref<Translations>;
  ready: Ref<boolean>;
  locale: Ref<string>;
}

/**
 * Vue composable for accessing translations.
 *
 * Without a scope, accesses dictionary translations only.
 * With a scope, loads the scope bundle and dictionaries.
 */
export function useI18n(scope?: string): UseI18nReturn {
  const injected = inject(I18N_INJECTION_KEY);

  if (!injected) {
    throw new Error(
      'vite-bundled-i18n: useI18n() must be used in a component with the i18n plugin installed. ' +
        'Call app.use(createI18nPlugin(instance)) before mounting.',
    );
  }

  const instance: I18nInstance = injected;

  // Tag translate() calls from this component with the scope so the devtools
  // panel can filter misses from previous routes.
  instance.setActiveScope(scope);

  const locale = ref(instance.getLocale());
  const hasDicts = instance.getDictionaryNames().length > 0;
  const ready = ref(computeReady());

  function makeTranslations() {
    return createTranslations(instance, locale.value);
  }

  const translations = ref(makeTranslations()) as Ref<Translations>;

  function refresh() {
    translations.value = makeTranslations();
  }

  let unsubLocale: (() => void) | undefined;
  let unsubResources: (() => void) | undefined;

  onMounted(() => {
    unsubLocale = instance.onLocaleChange((newLocale) => {
      locale.value = newLocale;
      ready.value = computeReady();
      refresh();
    });
    unsubResources = instance.onResourcesChange(() => {
      ready.value = computeReady();
      refresh();
    });

    const promises: Promise<void>[] = [];

    if (hasDicts) {
      promises.push(instance.loadAllDictionaries(locale.value));
    }
    if (scope) {
      promises.push(instance.loadScope(locale.value, scope));
    }

    if (promises.length > 0) {
      Promise.all(promises).then(() => {
        ready.value = computeReady();
        refresh();
      });
    }
  });

  onUnmounted(() => {
    unsubLocale?.();
    unsubResources?.();
  });

  const t: TFunction = ((key: string, ...args: unknown[]) => {
    return instance.translate(locale.value, key, ...(args as [Record<string, unknown>?, string?]));
  }) as TFunction;

  const has: HasKeyFunction = (key: string) => {
    return instance.hasKey(locale.value, key);
  };

  const tryGet: TryTFunction = ((key: string, ...args: unknown[]) => {
    return instance.tryTranslate(locale.value, key, ...(args as [Record<string, unknown>?]));
  }) as TryTFunction;

  const require_: RequireTFunction = ((key: string, ...args: unknown[]) => {
    const result = instance.tryTranslate(locale.value, key, ...(args as [Record<string, unknown>?]));
    if (result === undefined) {
      throw new Error(`vite-bundled-i18n: Missing required translation key "${key}"`);
    }
    return result;
  }) as RequireTFunction;

  function computeReady(): boolean {
    const dictReady = !hasDicts
      || instance.getDictionaryNames().every((name) => instance.getLoadedDictionaries(locale.value).includes(name));
    const scopeReady = !scope || instance.isScopeLoaded(locale.value, scope);
    return dictReady && scopeReady;
  }

  return {
    t,
    get: t,
    has,
    exists: has,
    tryGet,
    require: require_,
    translations,
    ready,
    locale,
  };
}

// Core API re-exports
export { createI18n } from './core/createI18n';
export { defineI18nConfig } from './core/config';
export { defineI18nData, i18nKey } from './core/data';
export { t, hasKey, scopedT, setGlobalInstance } from './core/t';
export { getTranslations } from './core/getTranslations';
export { mountI18nDevtools } from './devtools/mountDevtools';

// Types
export type {
  I18nSharedConfig,
} from './core/config';
export type {
  NestedTranslations,
  I18nConfig,
  I18nInstance,
  DictionaryConfig,
  CacheConfig,
  CompiledConfig,
  I18nKeyMap,
  TranslationKey,
  TFunction,
  ScopedTFunction,
  KeyUsageEntry,
} from './core/types';
export type {
  I18nDevtoolsHandle,
  I18nDevtoolsOptions,
} from './devtools/mountDevtools';
