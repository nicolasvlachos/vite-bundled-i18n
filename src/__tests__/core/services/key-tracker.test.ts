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
    });
    expect(entries[1]).toEqual({
      key: 'shared.ok',
      namespace: 'shared',
      locale: 'en',
      resolvedFrom: 'fallback-locale',
      scope: undefined,
    });
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
