import { describe, it, expect, beforeEach } from 'vitest';
import {
  setTranslations,
  mergeTranslations,
  compiledTranslate,
  compiledHasKey,
  clearTranslations,
} from '../../core/compiled-runtime';

beforeEach(() => {
  clearTranslations();
});

describe('compiledTranslate', () => {
  it('resolves a key from the flat map', () => {
    setTranslations(new Map([['shared.ok', 'OK']]));
    expect(compiledTranslate('shared.ok')).toBe('OK');
  });

  it('interpolates params', () => {
    setTranslations(new Map([['products.show.price', 'Price: {{amount}}']]));
    expect(compiledTranslate('products.show.price', { amount: 29.99 })).toBe('Price: 29.99');
  });

  it('returns fallback when key is missing', () => {
    setTranslations(new Map());
    expect(compiledTranslate('missing.key', undefined, 'Fallback')).toBe('Fallback');
  });

  it('interpolates params into fallback', () => {
    setTranslations(new Map());
    expect(compiledTranslate('missing.key', { n: 5 }, 'Found {{n}} items')).toBe('Found 5 items');
  });

  it('returns key when no fallback and key is missing', () => {
    setTranslations(new Map());
    expect(compiledTranslate('missing.key')).toBe('missing.key');
  });

  it('returns value without interpolation when no params', () => {
    setTranslations(new Map([['shared.ok', 'OK']]));
    expect(compiledTranslate('shared.ok', undefined, 'fallback')).toBe('OK');
  });

  it('trims whitespace in placeholders', () => {
    setTranslations(new Map([['key', 'Hello {{ name }}']]));
    expect(compiledTranslate('key', { name: 'World' })).toBe('Hello World');
  });

  it('leaves missing params as placeholders', () => {
    setTranslations(new Map([['key', 'Hello {{name}}']]));
    expect(compiledTranslate('key', {})).toBe('Hello {{name}}');
  });
});

describe('mergeTranslations', () => {
  it('merges new entries into existing map', () => {
    setTranslations(new Map([['shared.ok', 'OK']]));
    mergeTranslations(new Map([['products.show.title', 'Details']]));
    expect(compiledTranslate('shared.ok')).toBe('OK');
    expect(compiledTranslate('products.show.title')).toBe('Details');
  });

  it('overwrites existing entries', () => {
    setTranslations(new Map([['shared.ok', 'OK']]));
    mergeTranslations(new Map([['shared.ok', 'Okay']]));
    expect(compiledTranslate('shared.ok')).toBe('Okay');
  });
});

describe('compiledHasKey', () => {
  it('returns true for existing key', () => {
    setTranslations(new Map([['shared.ok', 'OK']]));
    expect(compiledHasKey('shared.ok')).toBe(true);
  });

  it('returns false for missing key', () => {
    setTranslations(new Map());
    expect(compiledHasKey('missing.key')).toBe(false);
  });
});
