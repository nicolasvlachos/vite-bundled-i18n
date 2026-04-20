import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchNamespace, fetchBundle, buildLoadPath, buildBundlePath } from '../../core/fetcher';

describe('buildLoadPath', () => {
  it('builds a path from localesDir, locale, and namespace', () => {
    expect(buildLoadPath('/locales', 'en', 'products')).toBe('/locales/en/products.json');
  });

  it('handles trailing slash in localesDir', () => {
    expect(buildLoadPath('/locales/', 'bg', 'shared')).toBe('/locales/bg/shared.json');
  });
});

describe('buildBundlePath', () => {
  it('builds a bundle path', () => {
    expect(buildBundlePath('en', 'products.show')).toBe('/__i18n/en/products.show.json');
  });

  it('builds a dictionary bundle path', () => {
    expect(buildBundlePath('en', '_dict/global')).toBe('/__i18n/en/_dict/global.json');
  });
});

describe('fetchNamespace', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches and parses a JSON namespace file', async () => {
    const mockData = { ok: 'OK', cancel: 'Cancel' };
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    } as Response);

    const result = await fetchNamespace('/locales', 'en', 'shared');
    expect(result).toEqual(mockData);
    expect(globalThis.fetch).toHaveBeenCalledWith('/locales/en/shared.json');
  });

  it('throws on non-ok response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response);

    await expect(fetchNamespace('/locales', 'en', 'missing')).rejects.toThrow();
  });

  it('throws on network error', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Network error'));

    await expect(fetchNamespace('/locales', 'en', 'shared')).rejects.toThrow('Network error');
  });

  it('passes RequestInit to fetch when provided', async () => {
    const mockData = { ok: 'OK' };
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    } as Response);

    await fetchNamespace('/locales', 'en', 'shared', {
      credentials: 'include',
      headers: { 'X-CSRF-TOKEN': 'abc123' },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith('/locales/en/shared.json', {
      credentials: 'include',
      headers: { 'X-CSRF-TOKEN': 'abc123' },
    });
  });
});

describe('fetchBundle', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches and parses a bundle', async () => {
    const mockBundle = { shared: { ok: 'OK' } };
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockBundle),
    } as Response);

    const result = await fetchBundle('en', '_dict/global');
    expect(result).toEqual(mockBundle);
    expect(globalThis.fetch).toHaveBeenCalledWith('/__i18n/en/_dict/global.json');
  });

  it('passes RequestInit to fetch when provided', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);

    await fetchBundle('en', 'products.show', { cache: 'no-store' });

    expect(globalThis.fetch).toHaveBeenCalledWith('/__i18n/en/products.show.json', {
      cache: 'no-store',
    });
  });
});
