import { describe, it, expect } from 'vitest';
import { resolveKey, inferNamespace, extractSubkey } from '../../core/resolver';
import type { NestedTranslations } from '../../core/types';

describe('inferNamespace', () => {
  it('extracts the first segment as the namespace', () => {
    expect(inferNamespace('products.show.title')).toBe('products');
  });

  it('handles single-segment keys', () => {
    expect(inferNamespace('checkout')).toBe('checkout');
  });

  it('handles deeply nested keys', () => {
    expect(inferNamespace('admin.users.list.heading')).toBe('admin');
  });
});

describe('extractSubkey', () => {
  it('extracts everything after the first segment', () => {
    expect(extractSubkey('products.show.title')).toBe('show.title');
  });

  it('handles two-segment keys', () => {
    expect(extractSubkey('shared.ok')).toBe('ok');
  });

  it('returns empty string for single-segment keys', () => {
    expect(extractSubkey('checkout')).toBe('');
  });
});

describe('resolveKey', () => {
  const translations: NestedTranslations = {
    show: {
      title: 'Product Details',
      price: 'Price: {{amount}}',
      nested: {
        deep: 'Deep value',
      },
    },
    index: {
      heading: 'All Products',
    },
  };

  it('resolves a top-level key', () => {
    const flat: NestedTranslations = { ok: 'OK' };
    expect(resolveKey(flat, 'ok')).toBe('OK');
  });

  it('resolves a nested key via dot-path', () => {
    expect(resolveKey(translations, 'show.title')).toBe('Product Details');
  });

  it('resolves a deeply nested key', () => {
    expect(resolveKey(translations, 'show.nested.deep')).toBe('Deep value');
  });

  it('returns undefined for a missing key', () => {
    expect(resolveKey(translations, 'show.missing')).toBeUndefined();
  });

  it('returns undefined for a missing intermediate segment', () => {
    expect(resolveKey(translations, 'nonexistent.title')).toBeUndefined();
  });

  it('returns undefined when the path resolves to an object (not a leaf)', () => {
    expect(resolveKey(translations, 'show')).toBeUndefined();
  });

  it('returns undefined for an empty key', () => {
    expect(resolveKey(translations, '')).toBeUndefined();
  });
});
