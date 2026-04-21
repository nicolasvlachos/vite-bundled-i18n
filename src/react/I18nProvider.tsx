import { useEffect, useState, useMemo, type ReactNode } from 'react';
import { I18nContext } from './context';
import { setGlobalInstance } from '../core/t';
import type { I18nInstance, NestedTranslations } from '../core/types';

/**
 * Props for the {@link I18nProvider} component.
 */
export interface I18nProviderProps {
  /** The i18n instance returned by `createI18n()`. */
  instance: I18nInstance;
  /** Child components that will have access to translations. */
  children: ReactNode;
  /**
   * Pre-loaded translations from SSR. When provided, the provider adds these
   * resources to the store immediately and skips dictionary fetching.
   */
  serverResources?: Record<string, NestedTranslations>;
  /**
   * Rendered while dictionaries are loading on init. Default: renders children
   * immediately (dictionaries load in background).
   * Set to `null` for blank screen, or `<Spinner />` for a loading indicator.
   * Once dictionaries are loaded, this is never shown again.
   */
  fallback?: ReactNode;
  /**
   * Scopes to eagerly preload on mount (alongside dictionaries).
   * Use for small apps where you want all translations available immediately,
   * or to prefetch scopes for pages the user is likely to visit.
   */
  preloadScopes?: string[];
  /**
   * If true, render children before dictionaries finish loading.
   * Dictionary keys will return fallback strings until loaded.
   * Default: false (children wait for dictionaries).
   */
  eager?: boolean;
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

export function I18nProvider({
  instance,
  children,
  serverResources,
  fallback,
  preloadScopes,
  eager = false,
}: I18nProviderProps) {
  // Hydrate from SSR data synchronously (before first render)
  const [hydrated] = useState(() => {
    if (serverResources) {
      const locale = instance.getLocale();
      for (const [namespace, data] of Object.entries(serverResources)) {
        instance.addResources(locale, namespace, data);
      }
      return true;
    }

    const win = typeof window !== 'undefined' ? (window as WindowWithI18n) : undefined;
    if (win?.__I18N_RESOURCES__) {
      const serverData = win.__I18N_RESOURCES__;
      for (const [namespace, data] of Object.entries(serverData.resources)) {
        instance.addResources(serverData.locale, namespace, data);
      }
      delete win.__I18N_RESOURCES__;
      return true;
    }

    return false;
  });

  // Track whether dictionaries have been loaded (Phase 1)
  const [dictsReady, setDictsReady] = useState(() => {
    if (hydrated) return true;
    // No dictionaries configured → ready immediately
    const dictNames = instance.getDictionaryNames();
    if (dictNames.length === 0) return true;
    // All dictionary namespaces already in cache (e.g. added via addResources) → ready
    const locale = instance.getLocale();
    const dictNs = instance.getDictionaryNamespaces();
    return dictNs.length > 0 && dictNs.every(ns => instance.isNamespaceLoaded(locale, ns));
  });

  const [version, setVersion] = useState(hydrated ? 1 : 0);

  useEffect(() => {
    setGlobalInstance(instance);

    const unsub = instance.onLocaleChange(() => {
      setVersion((v) => v + 1);
    });

    const locale = instance.getLocale();
    const promises: Promise<void>[] = [];

    // Phase 1: Load dictionaries (if not hydrated and not already cached)
    if (!hydrated && !dictsReady) {
      if (instance.getDictionaryNames().length > 0) {
        promises.push(instance.loadAllDictionaries(locale));
      }
    }

    // Eagerly preload scopes (runs regardless of dict state)
    if (preloadScopes && preloadScopes.length > 0) {
      for (const scope of preloadScopes) {
        if (!instance.isScopeLoaded(locale, scope)) {
          promises.push(instance.loadScope(locale, scope));
        }
      }
    }

    if (promises.length > 0) {
      Promise.all(promises).then(() => {
        setDictsReady(true);
        setVersion((v) => v + 1);
      });
    }

    return unsub;
  }, [instance, hydrated, preloadScopes]);

  const contextValue = useMemo(
    () => ({ instance, version }),
    [instance, version],
  );

  // Gate rendering until dictionaries are ready (unless eager mode)
  const showChildren = eager || dictsReady;

  return (
    <I18nContext.Provider value={contextValue}>
      {showChildren ? children : (fallback ?? null)}
    </I18nContext.Provider>
  );
}
