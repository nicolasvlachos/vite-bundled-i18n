import { useContext, type ReactElement, type ReactNode } from 'react';
import { I18nContext } from './context';
import { useGate } from './useGate';

/**
 * Props for {@link GateBoundary}.
 */
export interface GateBoundaryProps {
  /** Children are always mounted; the fallback overlays when not ready. */
  children: ReactNode;
  /** Shown (in addition to children) while the gate reports not ready. */
  fallback?: ReactNode;
  /**
   * When `true`, suspend rendering via React Suspense instead of
   * overlaying a fallback. Throws a promise during render until the gate
   * is ready. Requires an ancestor `<Suspense>` boundary.
   *
   * @default false
   */
  suspense?: boolean;
}

/**
 * Readiness gate boundary. Wraps a subtree and reacts to outstanding
 * i18n scope loads via {@link useGate}.
 *
 * Default mode (`suspense: false`): children are **always mounted**. The
 * fallback renders alongside them whenever `gate.ready` is false. This
 * avoids the mount/unmount flash on every navigation — the tree you care
 * about stays stable and only the overlay toggles.
 *
 * Suspense mode (`suspense: true`): suspends render by throwing the gate's
 * `whenReady()` promise. React shows the nearest `<Suspense fallback>`.
 *
 * ```tsx
 * // Overlay fallback (default)
 * <GateBoundary fallback={<LoadingBar />}>
 *   <App />
 * </GateBoundary>
 *
 * // Suspense-native
 * <Suspense fallback={<LoadingBar />}>
 *   <GateBoundary suspense>
 *     <App />
 *   </GateBoundary>
 * </Suspense>
 * ```
 */
export function GateBoundary({
  children,
  fallback = null,
  suspense = false,
}: GateBoundaryProps): ReactElement {
  // Hooks must be called unconditionally — read context up-front; the
  // useGate call below already guaranteed presence via its own null check.
  const ctx = useContext(I18nContext);
  const { ready } = useGate();

  if (suspense && !ready) {
    throw ctx!.instance.gate.whenReady();
  }

  return (
    <>
      {!ready && fallback}
      {children}
    </>
  );
}
