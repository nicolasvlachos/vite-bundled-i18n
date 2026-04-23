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

  const { instance, version, dictsReady } = ctx;
  const locale = instance.getLocale();
  const scopeReady = !scope || instance.isScopeLoaded(locale, scope);
  const [, setScopeVersion] = useState(0);

  // Load scope bundle if needed — one HTTP request per scope
  useEffect(() => {
    if (!scope || scopeReady) return;

    let cancelled = false;
    const requestLocale = locale;

    instance.loadScope(requestLocale, scope).then(() => {
      if (!cancelled && instance.getLocale() === requestLocale) {
        setScopeVersion((v) => v + 1);
      }
    });

    return () => { cancelled = true; };
  }, [scope, scopeReady, locale, instance]);

  // Suppress missing-key warnings for this scope while it's loading.
  // addLoadingScope is idempotent (Set.add) and safe to call during render —
  // this ensures t() calls in useMemo during the same render cycle are covered.
  // The cleanup runs in an effect since effects fire after paint.
  if (scope && !scopeReady) {
    instance.addLoadingScope(scope);
  }

  useEffect(() => {
    if (!scope || scopeReady) {
      // Scope loaded or no scope — remove from loading set
      if (scope) instance.removeLoadingScope(scope);
      return;
    }
    return () => { instance.removeLoadingScope(scope); };
  }, [scope, scopeReady, instance]);

  const ready = dictsReady && scopeReady;

  // Re-create the translator object whenever locale or loaded resources change.
  const translations = useMemo(
    () => createTranslations(instance, locale),
    // version is not read directly here, but it must participate so the
    // translator object is recreated after dictionary loads and scope-ready
    // transitions, including cache hits on remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instance, locale, version, scopeReady],
  );

  return {
    t: translations.t,
    get: translations.get,
    has: translations.has,
    exists: translations.exists,
    tryGet: translations.tryGet,
    require: translations.require,
    translations,
    ready,
    locale,
  };
}
