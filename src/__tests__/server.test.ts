import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initServerI18n } from '../server';

const baseConfig = {
  locale: 'en',
  defaultLocale: 'en',
  supportedLocales: ['en', 'bg'],
  localesDir: '/locales',
  dictionaries: {
    global: { keys: ['shared'] },
  },
} as const;

describe('initServerI18n', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns translations, scriptTag, and instance', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((url) => {
      const urlStr = String(url);
      if (urlStr.includes('/_dict/global')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ shared: { ok: 'OK' } }),
        } as Response);
      }
      if (urlStr.includes('/products.show.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ products: { show: { title: 'Details' } } }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    });

    const result = await initServerI18n(baseConfig, 'products.show');

    expect(result.translations.get('shared.ok')).toBe('OK');
    expect(result.translations.get('products.show.title')).toBe('Details');
    expect(result.instance.getLocale()).toBe('en');
  });

  it('scriptTag contains valid serialized resources', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ shared: { ok: 'OK' } }),
    } as Response);

    const { scriptTag } = await initServerI18n(baseConfig);

    expect(scriptTag).toContain('<script>');
    expect(scriptTag).toContain('window.__I18N_RESOURCES__=');
    expect(scriptTag).toContain('</script>');

    // Extract and parse the JSON payload
    const jsonStr = scriptTag
      .replace('<script>window.__I18N_RESOURCES__=', '')
      .replace('</script>', '')
      .replace(/\\u003c/g, '<');
    const parsed = JSON.parse(jsonStr);
    expect(parsed.locale).toBe('en');
    expect(parsed.resources.shared.ok).toBe('OK');
    expect(parsed.dictionaries).toEqual(['global']);
  });

  it('serializes hydrated scope metadata when a scope is provided', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((url) => {
      const urlStr = String(url);
      if (urlStr.includes('/_dict/global')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ shared: { ok: 'OK' } }),
        } as Response);
      }
      if (urlStr.includes('/products.show.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ products: { show: { title: 'Details' } } }),
        } as Response);
      }
      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    });

    const { scriptTag } = await initServerI18n(baseConfig, 'products.show');
    const jsonStr = scriptTag
      .replace('<script>window.__I18N_RESOURCES__=', '')
      .replace('</script>', '')
      .replace(/\\u003c/g, '<');
    const parsed = JSON.parse(jsonStr);

    expect(parsed.scopes).toEqual(['products.show']);
    expect(parsed.dictionaries).toEqual(['global']);
  });

  it('scriptTag escapes angle brackets for XSS safety', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ shared: { xss: '</script><script>alert(1)</script>' } }),
    } as Response);

    const { scriptTag } = await initServerI18n(baseConfig);

    expect(scriptTag).not.toContain('</script><script>');
    expect(scriptTag).toContain('\\u003c');
  });

  it('uses custom locale when provided', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ shared: { ok: 'Добре' } }),
    } as Response);

    const result = await initServerI18n(baseConfig, undefined, 'bg');
    expect(result.translations.locale).toBe('bg');
  });

  it('works without scope (dictionaries only)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ shared: { ok: 'OK' } }),
    } as Response);

    const result = await initServerI18n(baseConfig);
    expect(result.translations.get('shared.ok')).toBe('OK');
    expect(result.scriptTag).toContain('shared');
  });
});
