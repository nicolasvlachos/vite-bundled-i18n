import { useEffect, useState, useMemo, type ReactNode } from 'react';
import { I18nContext } from './context';
import { setGlobalInstance } from '../core/t';
import type { I18nInstance, NestedTranslations } from '../core/types';

/**
 * Props for the {@link I18nProvider} component.
 */
interface I18nProviderProps {
  /** The i18n instance returned by `createI18n()`. */
  instance: I18nInstance;
  /** Child components that will have access to translations. */
  children: ReactNode;
  /**
   * Pre-loaded translations from SSR. When provided, the provider adds these
   * resources to the store immediately and skips dictionary fetching.
   * Format: Record<namespace, NestedTranslations>
   * Example: { shared: { ok: 'OK' }, global: { appName: 'Store' } }
   */
  serverResources?: Record<string, NestedTranslations>;
}

/**
 * React context provider for translations.
 *
 * On mount, it sets the global i18n instance and loads all dictionary
 * bundles (one HTTP request per named dictionary, in declaration order).
 * Re-renders children when dictionaries finish loading and when the
 * locale changes.
 *
 * @example
 * ```tsx
 * import { createI18n } from 'vite-bundled-i18n';
 * import { I18nProvider } from 'vite-bundled-i18n/react';
 *
 * const i18n = createI18n({ ... });
 *
 * function App() {
 *   return (
 *     <I18nProvider instance={i18n}>
 *       <Router />
 *     </I18nProvider>
 *   );
 * }
 * ```
 */
interface WindowWithI18n extends Window {
  __I18N_RESOURCES__?: {
    locale: string;
    resources: Record<string, NestedTranslations>;
  };
}

export function I18nProvider({ instance, children, serverResources }: I18nProviderProps) {
  const [hydrated] = useState(() => {
    if (serverResources) {
      return true;
    }
    if (typeof window !== 'undefined' && (window as WindowWithI18n).__I18N_RESOURCES__) {
      return true;
    }
    return false;
  });

  const [version, setVersion] = useState(() => {
    if (serverResources) {
      const locale = instance.getLocale();
      for (const [namespace, data] of Object.entries(serverResources)) {
        instance.addResources(locale, namespace, data);
      }
      return 1;
    }

    // Auto-hydrate from server-injected global
    const win = typeof window !== 'undefined' ? (window as WindowWithI18n) : undefined;
    if (win?.__I18N_RESOURCES__) {
      const serverData = win.__I18N_RESOURCES__;
      for (const [namespace, data] of Object.entries(serverData.resources)) {
        instance.addResources(serverData.locale, namespace, data);
      }
      delete win.__I18N_RESOURCES__;
      return 1;
    }

    return 0;
  });

  useEffect(() => {
    setGlobalInstance(instance);

    const unsub = instance.onLocaleChange(() => {
      setVersion((v) => v + 1);
    });

    if (!hydrated) {
      const hasDicts = instance.getDictionaryNames().length > 0;
      if (hasDicts) {
        instance.loadAllDictionaries(instance.getLocale()).then(() => {
          setVersion((v) => v + 1);
        });
      }
    }

    return unsub;
  }, [instance, hydrated]);

  const contextValue = useMemo(
    () => ({ instance, version }),
    [instance, version],
  );

  return (
    <I18nContext.Provider value={contextValue}>
      {children}
    </I18nContext.Provider>
  );
}
