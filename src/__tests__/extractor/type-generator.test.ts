import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  extractPlaceholders,
  flattenToKeyPaths,
  flattenToLeafValues,
  generateTypes,
} from '../../extractor/type-generator';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-types-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(rel: string, content: string) {
  const full = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('flattenToKeyPaths', () => {
  it('flattens a nested object to dot paths', () => {
    const result = flattenToKeyPaths({ show: { title: 'X', price: 'Y' }, ok: 'Z' });
    expect(result).toEqual(['show.title', 'show.price', 'ok']);
  });

  it('handles deeply nested objects', () => {
    const result = flattenToKeyPaths({ a: { b: { c: 'val' } } });
    expect(result).toEqual(['a.b.c']);
  });

  it('returns empty array for empty object', () => {
    expect(flattenToKeyPaths({})).toEqual([]);
  });
});

describe('flattenToLeafValues', () => {
  it('flattens nested objects to leaf values', () => {
    const result = flattenToLeafValues({ show: { title: 'X' }, ok: 'Z' });
    expect(Array.from(result.entries())).toEqual([
      ['show.title', 'X'],
      ['ok', 'Z'],
    ]);
  });
});

describe('extractPlaceholders', () => {
  it('extracts placeholder names and deduplicates them', () => {
    expect(extractPlaceholders('Price: {{amount}} / {{ amount }}')).toEqual(['amount']);
  });

  it('returns an empty array when no placeholders exist', () => {
    expect(extractPlaceholders('Hello world')).toEqual([]);
  });
});

describe('generateTypes', () => {
  it('generates TypeScript declarations from locale files', () => {
    writeFile('locales/en/shared.json', JSON.stringify({ ok: 'OK', cancel: 'Cancel' }));
    writeFile('locales/en/products.json', JSON.stringify({
      show: { title: 'Details', price: 'Price' },
      index: { heading: 'All' }
    }));

    const output = generateTypes(path.join(tmpDir, 'locales'), 'en');

    // TranslationKey should contain all fully qualified keys
    expect(output).toContain("'products.show.title'");
    expect(output).toContain("'products.show.price'");
    expect(output).toContain("'products.index.heading'");
    expect(output).toContain("'shared.ok'");
    expect(output).toContain("'shared.cancel'");

    // Namespace union
    expect(output).toContain("'products'");
    expect(output).toContain("'shared'");

    // NamespaceKeyPaths conditional type
    expect(output).toContain("'show.title'");
    expect(output).toContain("'ok'");

    // Header comment
    expect(output).toContain('Auto-generated');

    // Params map augmentation
    expect(output).toContain('interface I18nParamsMap');
    expect(output).toContain("'products.show.price': {};");
  });

  it('handles empty locales directory', () => {
    fs.mkdirSync(path.join(tmpDir, 'locales/en'), { recursive: true });
    const output = generateTypes(path.join(tmpDir, 'locales'), 'en');
    expect(output).toContain('TranslationKey');
    expect(output).toContain('never'); // no keys
  });

  it('handles single namespace', () => {
    writeFile('locales/en/shared.json', JSON.stringify({ ok: 'OK' }));
    const output = generateTypes(path.join(tmpDir, 'locales'), 'en');
    expect(output).toContain("'shared.ok'");
    expect(output).toContain("type Namespace = 'shared'");
  });

  it('emits placeholder params map entries', () => {
    writeFile('locales/en/products.json', JSON.stringify({
      show: { price: 'Price: {{amount}}', eta: 'Arrives {{ date }}' },
    }));

    const output = generateTypes(path.join(tmpDir, 'locales'), 'en');

    expect(output).toContain("'products.show.price': { amount: Primitive };");
    expect(output).toContain("'products.show.eta': { date: Primitive };");
  });
});

describe('nested type generation', () => {
  it('generates I18nNestedKeys interface', () => {
    writeFile('locales/en/shared.json', JSON.stringify({ ok: 'OK', cancel: 'Cancel' }));
    writeFile('locales/en/products.json', JSON.stringify({
      show: { title: 'Details', price: 'Price' },
      index: { heading: 'All' }
    }));

    const output = generateTypes(path.join(tmpDir, 'locales'), 'en');
    expect(output).toContain('interface I18nNestedKeys');
  });

  it('contains nested structure for namespaces', () => {
    writeFile('locales/en/shared.json', JSON.stringify({ ok: 'OK', cancel: 'Cancel' }));
    writeFile('locales/en/products.json', JSON.stringify({
      show: { title: 'Details', price: 'Price' },
      index: { heading: 'All' }
    }));

    const output = generateTypes(path.join(tmpDir, 'locales'), 'en');
    // The test locales should have at least one namespace with nested keys
    // Check for the nested syntax pattern
    expect(output).toMatch(/'[a-z]+': \{/); // nested object
    expect(output).toMatch(/'[a-z]+': true;/); // leaf value
  });

  it('generates PathsOf helper type', () => {
    writeFile('locales/en/shared.json', JSON.stringify({ ok: 'OK' }));

    const output = generateTypes(path.join(tmpDir, 'locales'), 'en');
    expect(output).toContain('type DotPrefix<');
    expect(output).toContain('type PathsOf<');
  });

  it('generates empty I18nNestedKeys when no keys exist', () => {
    // Use a path with no JSON files
    const output = generateTypes('/nonexistent/path', 'en');
    expect(output).toContain('interface I18nNestedKeys {}');
  });
});

describe('scope type generation', () => {
  it('generates I18nScopeMap with provided scopes', () => {
    writeFile('locales/en/shared.json', JSON.stringify({ ok: 'OK' }));
    const localesDir = path.join(tmpDir, 'locales');
    const output = generateTypes(localesDir, 'en', ['products.index', 'products.show', 'admin.dashboard']);
    expect(output).toContain("'admin.dashboard': true;");
    expect(output).toContain("'products.index': true;");
    expect(output).toContain("'products.show': true;");
    expect(output).toContain('interface I18nScopeMap');
  });

  it('generates empty scope map comment when no scopes provided', () => {
    writeFile('locales/en/shared.json', JSON.stringify({ ok: 'OK' }));
    const localesDir = path.join(tmpDir, 'locales');
    const output = generateTypes(localesDir, 'en');
    expect(output).toContain('// No scopes found');
  });
});
