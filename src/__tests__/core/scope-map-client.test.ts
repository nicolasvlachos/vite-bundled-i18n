import { describe, it, expect, vi } from 'vitest';
import { createScopeMapClient } from '../../core/scope-map-client';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const SAMPLE = {
  version: 1,
  defaultLocale: 'en',
  pages: {
    'giftcards/show': { scopes: ['giftcards.show'], dictionaries: ['global'] },
    'cart/index': { scopes: ['cart.index', 'cart.summary'], dictionaries: ['global'] },
  },
};

describe('createScopeMapClient', () => {
  it('defaults to /__i18n/scope-map.json and returns scopes after load()', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SAMPLE));
    const client = createScopeMapClient({ fetchImpl });

    expect(client.isLoaded()).toBe(false);
    expect(await client.get('giftcards/show')).toEqual(['giftcards.show']);
    expect(fetchImpl).toHaveBeenCalledWith('/__i18n/scope-map.json');
    expect(client.isLoaded()).toBe(true);
  });

  it('default URL honors the plugin-injected __VITE_I18N_BASE__ for subdirectory deploys', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SAMPLE));
    (globalThis as typeof globalThis & { __VITE_I18N_BASE__?: string }).__VITE_I18N_BASE__ = '/admin/__i18n';
    try {
      const client = createScopeMapClient({ fetchImpl });
      await client.load();
      expect(fetchImpl).toHaveBeenCalledWith('/admin/__i18n/scope-map.json');
    } finally {
      delete (globalThis as typeof globalThis & { __VITE_I18N_BASE__?: string }).__VITE_I18N_BASE__;
    }
  });

  it('trims a trailing slash on __VITE_I18N_BASE__ before appending scope-map.json', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SAMPLE));
    (globalThis as typeof globalThis & { __VITE_I18N_BASE__?: string }).__VITE_I18N_BASE__ = '/admin/__i18n/';
    try {
      const client = createScopeMapClient({ fetchImpl });
      await client.load();
      expect(fetchImpl).toHaveBeenCalledWith('/admin/__i18n/scope-map.json');
    } finally {
      delete (globalThis as typeof globalThis & { __VITE_I18N_BASE__?: string }).__VITE_I18N_BASE__;
    }
  });

  it('respects options.url', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SAMPLE));
    const client = createScopeMapClient({ fetchImpl, url: '/custom/scope-map.json' });
    await client.load();
    expect(fetchImpl).toHaveBeenCalledWith('/custom/scope-map.json');
  });

  it('respects options.resolveUrl (dynamic resolution)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SAMPLE));
    const urls: string[] = [];
    const client = createScopeMapClient({
      fetchImpl,
      resolveUrl: () => {
        const url = `/tenant-${urls.length}/scope-map.json`;
        urls.push(url);
        return url;
      },
    });
    await client.load();
    expect(fetchImpl).toHaveBeenLastCalledWith('/tenant-0/scope-map.json');
  });

  it('resolveUrl wins over url when both are provided', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SAMPLE));
    const client = createScopeMapClient({
      fetchImpl,
      url: '/static.json',
      resolveUrl: () => '/dynamic.json',
    });
    await client.load();
    expect(fetchImpl).toHaveBeenCalledWith('/dynamic.json');
  });

  it('get() on an unknown page id returns an empty array', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SAMPLE));
    const client = createScopeMapClient({ fetchImpl });
    expect(await client.get('nonexistent/page')).toEqual([]);
  });

  it('getSync() returns null before load(), scopes after', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SAMPLE));
    const client = createScopeMapClient({ fetchImpl });
    expect(client.getSync('giftcards/show')).toBeNull();
    await client.load();
    expect(client.getSync('giftcards/show')).toEqual(['giftcards.show']);
    expect(client.getSync('unknown')).toEqual([]);
  });

  it('deduplicates concurrent load() calls — one fetch for 10 callers', async () => {
    let resolveFetch!: (r: Response) => void;
    const fetchImpl = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    );
    const client = createScopeMapClient({ fetchImpl });

    const calls = Array.from({ length: 10 }, () => client.load());
    resolveFetch(jsonResponse(SAMPLE));
    await Promise.all(calls);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(client.isLoaded()).toBe(true);
  });

  it('load() after a successful load is a no-op', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SAMPLE));
    const client = createScopeMapClient({ fetchImpl });
    await client.load();
    await client.load();
    await client.load();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('invalidate() clears the cache so the next load() re-fetches', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SAMPLE));
    const client = createScopeMapClient({ fetchImpl });
    await client.load();
    expect(client.isLoaded()).toBe(true);

    client.invalidate();
    expect(client.isLoaded()).toBe(false);

    await client.load();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('invalidate() while a fetch is in flight prevents the stale response from populating the cache', async () => {
    let resolveFirst!: (r: Response) => void;
    const fetchImpl = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((r) => { resolveFirst = r; }))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse({
        ...SAMPLE,
        pages: { 'fresh/page': { scopes: ['fresh'], dictionaries: [] } },
      })));
    const client = createScopeMapClient({ fetchImpl });

    const stalePromise = client.load();
    client.invalidate();
    // The stale in-flight resolves after invalidation.
    resolveFirst(jsonResponse(SAMPLE));
    await stalePromise;

    // Cache must NOT have been populated with the stale response.
    expect(client.isLoaded()).toBe(false);

    // Next load() fires a fresh fetch.
    await client.load();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(client.getSync('fresh/page')).toEqual(['fresh']);
    // Stale page ids are absent from the fresh cache — `getSync` returns []
    // (unknown id in loaded cache), not null (which would mean "not loaded").
    expect(client.getSync('giftcards/show')).toEqual([]);
  });

  it('throws a clear error on non-OK HTTP response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    const client = createScopeMapClient({ fetchImpl, url: '/x.json' });
    await expect(client.load()).rejects.toThrow(/HTTP 500.*\/x\.json/);
  });

  it('clears in-flight on failure so retries start fresh', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse(SAMPLE));
    const client = createScopeMapClient({ fetchImpl });

    await expect(client.load()).rejects.toThrow(/network down/);
    expect(client.isLoaded()).toBe(false);

    await client.load();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(client.isLoaded()).toBe(true);
  });
});
