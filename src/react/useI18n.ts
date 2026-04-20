import { useContext, useEffect, useState, useMemo } from 'react';
import { I18nContext } from './context';
import { createTranslations } from '../core/getTranslations';
import type { UseI18nResult, ValidScope } from '../core/types';

/**
 * React hook for accessing translations.
 *
 * Can be called with or without a scope:
 *
 * **Without scope** — accesses only dictionary translations (shared, global, etc.).
 * Use this in layout components, navigation, footers, and other app-wide UI.
 *
 * **With scope** — triggers loading of the scope bundle (one HTTP request for all
 * namespaces that page needs). Use this in route/page components.
 *
 * Keys are always fully qualified (e.g., `'products.show.title'`), regardless of scope.
 *
 * @param scope - Optional bundle identifier (e.g., `'products.show'`).
 *   Triggers loading of the scope bundle via `/__i18n/{locale}/{scope}.json`.
 * @returns An object with `t` (translation function), `ready` (loading state),
 *   and `locale` (current locale code)
 * @throws If called outside of an `I18nProvider`
 *
 * @example
 * ```tsx
 * // Dictionary-only access
 * const { t, ready } = useI18n();
 * t('shared.ok', 'OK');
 *
 * // Bundle + dictionary access
 * const { t, ready } = useI18n('products.show');
 * t('products.show.title', 'Product Details');
 * t('shared.ok', 'OK'); // dictionaries still work
 * ```
 */
export function useI18n(scope?: ValidScope): UseI18nResult {
  const ctx = useContext(I18nContext);

  if (!ctx) {
    throw new Error(
      'vite-bundled-i18n: useI18n() must be used within an <I18nProvider>. ' +
        'Wrap your app with <I18nProvider instance={...}>.',
    );
  }

  const { instance, version } = ctx;
  const locale = instance.getLocale();
  const [scopeReady, setScopeReady] = useState(() => {
    if (!scope) return true;
    return instance.isScopeLoaded(locale, scope);
  });
  const [loadedScopeKey, setLoadedScopeKey] = useState<string | null>(null);

  // Load scope bundle if needed — one HTTP request per scope
  const scopeKey = scope ? `${locale}:${scope}` : null;
  useEffect(() => {
    if (!scopeKey || !scope) return;
    if (scopeKey === loadedScopeKey) return;

    let cancelled = false;
    instance.loadScope(locale, scope).then(() => {
      if (!cancelled) {
        setLoadedScopeKey(scopeKey);
        setScopeReady(true);
      }
    });

    return () => { cancelled = true; };
  }, [scopeKey, scope, locale, instance, loadedScopeKey]);

  // Re-create the translator object whenever locale or loaded resources change.
  const translations = useMemo(
    () => createTranslations(instance, locale),
    // version is not read directly here, but it must participate so the
    // translator object is recreated after dictionary/scope loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instance, locale, version],
  );

  return {
    t: translations.t,
    get: translations.get,
    has: translations.has,
    exists: translations.exists,
    tryGet: translations.tryGet,
    require: translations.require,
    translations,
    ready: scopeReady,
    locale,
  };
}
