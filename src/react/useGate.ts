import { useContext, useSyncExternalStore } from 'react';
import { I18nContext } from './context';

/**
 * React hook exposing the i18n readiness gate. Returns the current
 * `ready` boolean and `pendingCount` — both reactive via
 * `useSyncExternalStore`.
 *
 * `ready` flips to `false` the moment any `loadScope()` call starts and
 * back to `true` when every outstanding call settles. Consumers typically
 * read this to decide whether to render a loading overlay.
 *
 * ```tsx
 * const { ready, pendingCount } = useGate();
 * if (!ready) return <Spinner label={`Loading ${pendingCount} scope(s)…`} />;
 * ```
 *
 * Must be used within an `<I18nProvider>`.
 */
export function useGate(): { ready: boolean; pendingCount: number } {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error(
      'vite-bundled-i18n: useGate() must be used within an <I18nProvider>. ' +
        'Wrap your app with <I18nProvider instance={...}>.',
    );
  }

  const { gate } = ctx.instance;

  const ready = useSyncExternalStore(
    gate.subscribe,
    () => gate.ready,
    () => gate.ready,
  );
  const pendingCount = useSyncExternalStore(
    gate.subscribe,
    () => gate.pendingCount,
    () => gate.pendingCount,
  );

  return { ready, pendingCount };
}
