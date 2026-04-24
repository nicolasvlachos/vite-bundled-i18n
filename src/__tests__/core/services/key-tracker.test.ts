import { describe, it, expect, vi } from 'vitest';
import { createKeyTracker } from '../../../core/services/key-tracker';

describe('createKeyTracker', () => {
  it('records usage entries in dev mode', () => {
    const tracker = createKeyTracker(true);

    tracker.recordUsage('products.title', 'products', 'en', 'primary', 'products');
    tracker.recordUsage('shared.ok', 'shared', 'en', 'fallback-locale');

    const entries = tracker.getKeyUsage();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      key: 'products.title',
      namespace: 'products',
      locale: 'en',
      resolvedFrom: 'primary',
      scope: 'products',
      epoch: 0,
    });
    expect(entries[1]).toEqual({
      key: 'shared.ok',
      namespace: 'shared',
      locale: 'en',
      resolvedFrom: 'fallback-locale',
      scope: undefined,
      epoch: 0,
    });
  });

  it('tags recorded entries with the current epoch', () => {
    const tracker = createKeyTracker(true);

    tracker.recordUsage('a.x', 'a', 'en', 'primary');
    tracker.bumpEpoch();
    tracker.recordUsage('a.y', 'a', 'en', 'primary');

    const entries = tracker.getKeyUsage();
    expect(entries.map((e) => e.epoch)).toEqual([0, 1]);
    expect(tracker.getEpoch()).toBe(1);
  });

  it('reset() clears entries and bumps epoch', () => {
    const tracker = createKeyTracker(true);

    tracker.recordUsage('a.x', 'a', 'en', 'primary');
    tracker.recordUsage('a.y', 'a', 'en', 'key-as-value');
    expect(tracker.getKeyUsage()).toHaveLength(2);

    tracker.reset();
    expect(tracker.getKeyUsage()).toEqual([]);
    expect(tracker.getEpoch()).toBe(1);

    // warnedKeys dedup set is cleared — previously-warned keys fire again.
    const warn = vi.fn();
    tracker.warnMissing('a.y', 'en', warn);
    tracker.warnMissing('a.y', 'en', warn);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('disabled tracker reports epoch 0 and reset is a no-op', () => {
    const tracker = createKeyTracker(false);
    expect(tracker.getEpoch()).toBe(0);
    tracker.bumpEpoch();
    tracker.reset();
    expect(tracker.getEpoch()).toBe(0);
  });

  it('is a complete no-op when disabled', () => {
    const tracker = createKeyTracker(false);

    tracker.recordUsage('products.title', 'products', 'en', 'primary');
    expect(tracker.getKeyUsage()).toEqual([]);

    const warn = vi.fn();
    tracker.warnMissing('products.title', 'en', warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it('caps entries and drops oldest 20% when full', () => {
    const max = 10;
    const tracker = createKeyTracker(true, max);

    for (let i = 0; i < max; i++) {
      tracker.recordUsage(`key-${i}`, 'ns', 'en', 'primary');
    }
    expect(tracker.getKeyUsage()).toHaveLength(max);

    // Adding one more triggers the eviction of the oldest 20% (2 entries)
    tracker.recordUsage('key-overflow', 'ns', 'en', 'primary');

    const entries = tracker.getKeyUsage();
    // 10 - 2 (dropped) + 1 (new) = 9
    expect(entries).toHaveLength(9);
    // The first two entries (key-0, key-1) should have been dropped
    expect(entries[0].key).toBe('key-2');
    expect(entries[entries.length - 1].key).toBe('key-overflow');
  });

  it('deduplicates missing key warnings', () => {
    const tracker = createKeyTracker(true);
    const warn = vi.fn();

    tracker.warnMissing('products.title', 'en', warn);
    tracker.warnMissing('products.title', 'en', warn);
    tracker.warnMissing('products.title', 'fr', warn);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('products.title'),
    );
  });

  it('returns empty array when no entries recorded', () => {
    const tracker = createKeyTracker(true);
    expect(tracker.getKeyUsage()).toEqual([]);
  });

  it('uses console.warn when no warn function is provided', () => {
    const tracker = createKeyTracker(true);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    tracker.warnMissing('missing.key', 'en');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('missing.key'),
    );
    spy.mockRestore();
  });
});
