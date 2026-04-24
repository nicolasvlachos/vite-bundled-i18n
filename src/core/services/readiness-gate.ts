/**
 * Framework-agnostic readiness primitive. Keeps a refcount of outstanding
 * async operations (typically {@link I18nInstance.loadScope} calls); exposes
 * a boolean `ready`, a pending count, a promise gate, and a subscription
 * for UI layers.
 *
 * The gate is the single source of truth for "is i18n idle right now?".
 * React (`<GateBoundary>` / `useGate()`) and Vue (`useGate()`) adapters
 * both wrap this — neither layer keeps its own counter.
 *
 * Contract:
 * - `register()` returns a one-shot release function. Double-release is
 *   idempotent; no negative counts.
 * - `whenReady()` resolves immediately when already ready, otherwise on
 *   the next transition to ready.
 * - `subscribe()` fires on every pending-count change (including
 *   transitions through intermediate counts). Listeners receive the
 *   current `ready` boolean.
 * - `reset()` forcibly zeroes the pending set and notifies. Stale release
 *   tokens from before the reset are no-ops.
 */
export interface ReadinessGate {
  /**
   * Increment the pending count. Returns a release function that
   * decrements it. Release is idempotent — safe to call more than once.
   */
  register(): () => void;

  /**
   * Resolve when the gate is (or becomes) ready. Resolves in a microtask
   * when already ready; otherwise on the next transition to pendingCount=0.
   */
  whenReady(): Promise<void>;

  /**
   * Subscribe to readiness-state changes. The listener is invoked with
   * the current `ready` boolean on every pending-count transition.
   * Returns an unsubscribe function.
   */
  subscribe(listener: (ready: boolean) => void): () => void;

  /** `true` when pendingCount is 0. */
  readonly ready: boolean;

  /** Number of outstanding registrations. */
  readonly pendingCount: number;

  /**
   * Clear all pending registrations and force the gate into the ready
   * state. Pre-existing release tokens become no-ops (they won't produce
   * negative counts or spurious notifications). Subscribers are notified
   * and any pending {@link whenReady} promises resolve.
   *
   * Intended for locale-change cleanup and test teardown.
   */
  reset(): void;
}

/**
 * Create a new readiness gate instance. Typically instantiated once per
 * `I18nInstance`.
 */
export function createReadinessGate(): ReadinessGate {
  const pending = new Set<symbol>();
  const listeners = new Set<(ready: boolean) => void>();
  let readyResolvers: Array<() => void> = [];

  function flushReady(): void {
    const toResolve = readyResolvers;
    readyResolvers = [];
    for (const resolve of toResolve) resolve();
  }

  function notify(): void {
    const isReady = pending.size === 0;
    // Snapshot the listener set before invoking so a listener that calls
    // subscribe/unsubscribe/register/reset during its own invocation
    // doesn't corrupt the iteration.
    for (const listener of [...listeners]) {
      try { listener(isReady); } catch { /* a buggy listener must not take down the gate */ }
    }
    if (isReady) flushReady();
  }

  return {
    register() {
      const token = Symbol();
      pending.add(token);
      notify();

      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (!pending.has(token)) return;
        pending.delete(token);
        notify();
      };
    },

    whenReady() {
      if (pending.size === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        readyResolvers.push(resolve);
      });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    get ready() { return pending.size === 0; },
    get pendingCount() { return pending.size; },

    reset() {
      if (pending.size === 0) return;
      pending.clear();
      notify();
    },
  };
}
