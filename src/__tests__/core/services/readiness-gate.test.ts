import { describe, it, expect, vi } from 'vitest';
import { createReadinessGate } from '../../../core/services/readiness-gate';

describe('createReadinessGate', () => {
  it('starts ready with a zero pending count', () => {
    const gate = createReadinessGate();
    expect(gate.ready).toBe(true);
    expect(gate.pendingCount).toBe(0);
  });

  it('register() flips ready to false and bumps pendingCount', () => {
    const gate = createReadinessGate();
    gate.register();
    expect(gate.ready).toBe(false);
    expect(gate.pendingCount).toBe(1);
  });

  it('release restores ready + pendingCount', () => {
    const gate = createReadinessGate();
    const release = gate.register();
    expect(gate.ready).toBe(false);
    release();
    expect(gate.ready).toBe(true);
    expect(gate.pendingCount).toBe(0);
  });

  it('tracks concurrent registrations and only flips ready on the final release', () => {
    const gate = createReadinessGate();
    const r1 = gate.register();
    const r2 = gate.register();
    const r3 = gate.register();
    expect(gate.pendingCount).toBe(3);
    expect(gate.ready).toBe(false);

    r1();
    expect(gate.pendingCount).toBe(2);
    expect(gate.ready).toBe(false);

    r2();
    expect(gate.pendingCount).toBe(1);
    expect(gate.ready).toBe(false);

    r3();
    expect(gate.pendingCount).toBe(0);
    expect(gate.ready).toBe(true);
  });

  it('double-release is idempotent', () => {
    const gate = createReadinessGate();
    const release = gate.register();
    release();
    release(); // no-op
    release(); // still no-op
    expect(gate.pendingCount).toBe(0);
    expect(gate.ready).toBe(true);
  });

  it('whenReady() resolves immediately when already ready', async () => {
    const gate = createReadinessGate();
    await expect(gate.whenReady()).resolves.toBeUndefined();
  });

  it('whenReady() resolves after the final release', async () => {
    const gate = createReadinessGate();
    const release = gate.register();
    let resolved = false;
    const promise = gate.whenReady().then(() => { resolved = true; });
    // Not yet.
    await Promise.resolve();
    expect(resolved).toBe(false);

    release();
    await promise;
    expect(resolved).toBe(true);
  });

  it('multiple whenReady() callers all resolve on the same transition', async () => {
    const gate = createReadinessGate();
    const release = gate.register();
    const a = gate.whenReady();
    const b = gate.whenReady();
    const c = gate.whenReady();
    release();
    await expect(Promise.all([a, b, c])).resolves.toEqual([undefined, undefined, undefined]);
  });

  it('subscribe fires on register() and on the final release() transition', () => {
    const gate = createReadinessGate();
    const listener = vi.fn();
    gate.subscribe(listener);

    const release = gate.register();
    expect(listener).toHaveBeenCalledWith(false);

    release();
    expect(listener).toHaveBeenLastCalledWith(true);
  });

  it('subscribe returns an unsubscribe function', () => {
    const gate = createReadinessGate();
    const listener = vi.fn();
    const unsub = gate.subscribe(listener);
    unsub();

    gate.register()();
    expect(listener).not.toHaveBeenCalled();
  });

  it('reset() clears pending, flips ready, notifies listeners, and resolves whenReady callers', async () => {
    const gate = createReadinessGate();
    gate.register();
    gate.register();
    const listener = vi.fn();
    gate.subscribe(listener);

    let whenReadyResolved = false;
    const whenReady = gate.whenReady().then(() => { whenReadyResolved = true; });

    gate.reset();

    expect(gate.pendingCount).toBe(0);
    expect(gate.ready).toBe(true);
    expect(listener).toHaveBeenCalledWith(true);
    await whenReady;
    expect(whenReadyResolved).toBe(true);
  });

  it('reset() is a no-op when the gate is already ready', () => {
    const gate = createReadinessGate();
    const listener = vi.fn();
    gate.subscribe(listener);
    gate.reset();
    expect(listener).not.toHaveBeenCalled();
  });

  it('a listener that mutates state during notify does not corrupt iteration', () => {
    // The snapshot-based notify guarantees that once a listener starts
    // firing, every registered listener at that moment sees the event.
    // A listener that triggers a nested notify (via register/reset) still
    // gets its siblings called — we don't require a specific call count
    // (reentrant notifies may call listeners multiple times) but we do
    // require no listener is silently dropped and no exception is raised.
    const gate = createReadinessGate();
    const calls: Record<string, number> = { a: 0, b: 0, c: 0 };
    let reentered = false;

    gate.subscribe(() => {
      calls.a += 1;
      if (!reentered) {
        reentered = true;
        gate.register(); // trigger a nested notify from inside a listener
      }
    });
    gate.subscribe(() => { calls.b += 1; });
    gate.subscribe(() => { calls.c += 1; });

    expect(() => gate.register()).not.toThrow();

    // All three listeners fired at least once.
    expect(calls.a).toBeGreaterThanOrEqual(1);
    expect(calls.b).toBeGreaterThanOrEqual(1);
    expect(calls.c).toBeGreaterThanOrEqual(1);
  });

  it('releasing a stale token (pre-reset) is a no-op', () => {
    const gate = createReadinessGate();
    const stale = gate.register();
    gate.reset();

    // This release refers to a token no longer tracked; it must not take the
    // pending count negative or fire spurious listeners.
    const listener = vi.fn();
    gate.subscribe(listener);
    stale();

    expect(gate.pendingCount).toBe(0);
    expect(gate.ready).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });
});
