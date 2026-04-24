import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  flattenNamespace,
  preResolveFallbacks,
  generateCompiledModule,
  compileAll,
} from '../../extractor/compiler';
import type { ProjectAnalysis } from '../../extractor/walker-types';
import type { ExtractedKey } from '../../extractor/types';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-compiler-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(rel: string, content: string) {
  const full = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function makeKey(key: string): ExtractedKey {
  return { key, dynamic: false, line: 1, column: 0 };
}

describe('flattenNamespace', () => {
  it('flattens nested object to dot-separated entries', () => {
    const result = flattenNamespace('products', {
      show: { title: 'Details', price: 'Price: {{amount}}' },
      index: { heading: 'All' },
    });
    expect(result).toEqual(new Map([
      ['products.show.title', 'Details'],
      ['products.show.price', 'Price: {{amount}}'],
      ['products.index.heading', 'All'],
    ]));
  });

  it('handles flat namespace', () => {
    const result = flattenNamespace('shared', { ok: 'OK', cancel: 'Cancel' });
    expect(result).toEqual(new Map([
      ['shared.ok', 'OK'],
      ['shared.cancel', 'Cancel'],
    ]));
  });
});

describe('preResolveFallbacks', () => {
  it('fills missing keys from default locale', () => {
    const primary = new Map([['shared.ok', 'Добре']]);
    const fallback = new Map([['shared.ok', 'OK'], ['shared.cancel', 'Cancel']]);
    const result = preResolveFallbacks(primary, fallback);
    expect(result.get('shared.ok')).toBe('Добре');
    expect(result.get('shared.cancel')).toBe('Cancel');
  });

  it('returns primary unchanged when no keys are missing', () => {
    const primary = new Map([['shared.ok', 'OK']]);
    const fallback = new Map([['shared.ok', 'OK']]);
    const result = preResolveFallbacks(primary, fallback);
    expect(result).toEqual(primary);
  });
});

describe('generateCompiledModule', () => {
  it('generates a JS module with a flat Map', () => {
    const entries = new Map([
      ['shared.ok', 'OK'],
      ['products.show.title', 'Details'],
    ]);
    const output = generateCompiledModule(entries);
    expect(output).toContain("new Map(");
    expect(output).toContain("'shared.ok'");
    expect(output).toContain("'OK'");
    expect(output).toContain("export default");
  });

  it('escapes single quotes in values', () => {
    const entries = new Map([["key", "It's a test"]]);
    const output = generateCompiledModule(entries);
    expect(output).toContain("It\\'s a test");
  });
});

describe('compileAll', () => {
  it('generates compiled modules for each route and locale', () => {
    writeFile('locales/en/shared.json', JSON.stringify({ ok: 'OK', cancel: 'Cancel' }));
    writeFile('locales/en/products.json', JSON.stringify({
      show: { title: 'Details', price: 'Price: {{amount}}' },
    }));
    writeFile('locales/bg/shared.json', JSON.stringify({ ok: 'Добре' }));
    writeFile('locales/bg/products.json', JSON.stringify({
      show: { title: 'Детайли', price: 'Цена: {{amount}}' },
    }));

    const analysis: ProjectAnalysis = {
      routes: [{
        entryPoint: '/src/pages/ProductsPage.tsx',
        routeId: 'ProductsPage',
        scopes: ['products.show'],
        keys: [
          makeKey('shared.ok'),
          makeKey('products.show.title'),
          makeKey('products.show.price'),
        ],
        files: [],
      }],
      availableNamespaces: ['shared', 'products'],
      allKeys: [],
      sharedNamespaces: ['shared'],
    };

    const outDir = path.join(tmpDir, 'compiled');
    compileAll(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en', 'bg'],
      defaultLocale: 'en',
      outDir,
      dictionaries: { global: { keys: ['shared'] } },
    });

    // Scope modules exist
    expect(fs.existsSync(path.join(outDir, 'en', 'products.show.js'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'bg', 'products.show.js'))).toBe(true);

    // Dictionary modules exist
    expect(fs.existsSync(path.join(outDir, 'en', '_dict', 'global.js'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'bg', '_dict', 'global.js'))).toBe(true);

    // Manifest exists
    expect(fs.existsSync(path.join(outDir, 'manifest.js'))).toBe(true);

    // Check bg route has correct values (dictionary keys excluded)
    const bgModule = fs.readFileSync(path.join(outDir, 'bg', 'products.show.js'), 'utf-8');
    expect(bgModule).toContain('Детайли');
    // shared.ok is a dictionary key, so it should NOT be in route bundle
    expect(bgModule).not.toContain('shared.ok');

    // Check en route
    const enModule = fs.readFileSync(path.join(outDir, 'en', 'products.show.js'), 'utf-8');
    expect(enModule).toContain('Details');
    // shared.ok is a dictionary key, so it should NOT be in route bundle
    expect(enModule).not.toContain('shared.ok');
  });

  it('excludes dictionary keys from route bundles', () => {
    writeFile('locales/en/shared.json', JSON.stringify({ ok: 'OK', cancel: 'Cancel' }));
    writeFile('locales/en/products.json', JSON.stringify({
      show: { title: 'Details' },
    }));

    const analysis: ProjectAnalysis = {
      routes: [{
        entryPoint: '/src/pages/ProductsPage.tsx',
        routeId: 'ProductsPage',
        scopes: ['products.show'],
        keys: [
          makeKey('shared.ok'),         // dictionary key — should be excluded
          makeKey('products.show.title'), // route key — should be included
        ],
        files: [],
      }],
      availableNamespaces: ['shared', 'products'],
      allKeys: [],
      sharedNamespaces: ['shared'],
    };

    const outDir = path.join(tmpDir, 'compiled');
    compileAll(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en'],
      defaultLocale: 'en',
      outDir,
      dictionaries: { global: { keys: ['shared'] } },
    });

    const routeModule = fs.readFileSync(path.join(outDir, 'en', 'products.show.js'), 'utf-8');

    // Route bundle should NOT contain shared.ok (it's in dictionaries)
    expect(routeModule).not.toContain('shared.ok');
    // Route bundle SHOULD contain products.show.title
    expect(routeModule).toContain('products.show.title');

    // Dictionary module SHOULD contain shared.ok
    const dictModule = fs.readFileSync(path.join(outDir, 'en', '_dict', 'global.js'), 'utf-8');
    expect(dictModule).toContain('shared.ok');
  });

  it('includes cross-namespace extras in compiled scope modules when flag is on', () => {
    writeFile('locales/en/giftcards.json', JSON.stringify({
      show: { title: 'Gift card', subtitle: 'Redeem now' },
    }));
    writeFile('locales/en/vendors.json', JSON.stringify({
      compact: { name: 'Vendor', logo: 'Logo' },
      full: { bio: 'Long bio' },
    }));

    const analysis: ProjectAnalysis = {
      routes: [{
        entryPoint: '/src/pages/giftcards/show.tsx',
        routeId: 'giftcards-show',
        scopes: ['giftcards.show'],
        keys: [
          makeKey('giftcards.show.title'),
          makeKey('vendors.compact.name'),
        ],
        files: [],
      }],
      availableNamespaces: ['giftcards', 'vendors'],
      allKeys: [],
      sharedNamespaces: [],
    };

    const outDir = path.join(tmpDir, 'compiled');
    compileAll(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en'],
      defaultLocale: 'en',
      outDir,
      crossNamespacePacking: true,
    });

    const mod = fs.readFileSync(path.join(outDir, 'en', 'giftcards.show.js'), 'utf-8');
    expect(mod).toContain("'giftcards.show.title'");
    expect(mod).toContain("'vendors.compact.name'");
    // Tree-shaken: other keys in the extras namespace are not shipped.
    expect(mod).not.toContain("'vendors.compact.logo'");
    expect(mod).not.toContain("'vendors.full.bio'");
    // Own-namespace tree-shaking still applies.
    expect(mod).not.toContain("'giftcards.show.subtitle'");
  });

  it('omits cross-namespace extras from compiled scope modules when flag is off', () => {
    writeFile('locales/en/giftcards.json', JSON.stringify({
      show: { title: 'Gift card' },
    }));
    writeFile('locales/en/vendors.json', JSON.stringify({
      compact: { name: 'Vendor' },
    }));

    const analysis: ProjectAnalysis = {
      routes: [{
        entryPoint: '/src/pages/giftcards/show.tsx',
        routeId: 'giftcards-show',
        scopes: ['giftcards.show'],
        keys: [
          makeKey('giftcards.show.title'),
          makeKey('vendors.compact.name'),
        ],
        files: [],
      }],
      availableNamespaces: ['giftcards', 'vendors'],
      allKeys: [],
      sharedNamespaces: [],
    };

    const outDir = path.join(tmpDir, 'compiled');
    compileAll(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en'],
      defaultLocale: 'en',
      outDir,
    });

    const mod = fs.readFileSync(path.join(outDir, 'en', 'giftcards.show.js'), 'utf-8');
    expect(mod).toContain("'giftcards.show.title'");
    expect(mod).not.toContain("'vendors.compact.name'");
  });

  it('skips extras whose namespace is owned by a dictionary', () => {
    writeFile('locales/en/giftcards.json', JSON.stringify({
      show: { title: 'Gift card' },
    }));
    writeFile('locales/en/shared.json', JSON.stringify({ ok: 'OK' }));

    const analysis: ProjectAnalysis = {
      routes: [{
        entryPoint: '/src/pages/giftcards/show.tsx',
        routeId: 'giftcards-show',
        scopes: ['giftcards.show'],
        keys: [
          makeKey('giftcards.show.title'),
          makeKey('shared.ok'),
        ],
        files: [],
      }],
      availableNamespaces: ['giftcards', 'shared'],
      allKeys: [],
      sharedNamespaces: [],
    };

    const outDir = path.join(tmpDir, 'compiled');
    compileAll(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en'],
      defaultLocale: 'en',
      outDir,
      crossNamespacePacking: true,
      dictionaries: { global: { include: ['shared.*'] } },
    });

    const mod = fs.readFileSync(path.join(outDir, 'en', 'giftcards.show.js'), 'utf-8');
    expect(mod).toContain("'giftcards.show.title'");
    // Already in the dictionary — don't duplicate into the scope module.
    expect(mod).not.toContain("'shared.ok'");
  });
});
