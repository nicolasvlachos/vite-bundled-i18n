import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  pruneNamespace,
  flattenKeys,
  generateBundles,
} from '../../extractor/bundle-generator';
import type { ProjectAnalysis } from '../../extractor/walker-types';
import type { ExtractedKey } from '../../extractor/types';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-bundle-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeLocale(locale: string, namespace: string, data: object) {
  const dir = path.join(tmpDir, 'locales', locale);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${namespace}.json`),
    JSON.stringify(data),
  );
}

function makeKey(key: string, overrides?: Partial<ExtractedKey>): ExtractedKey {
  return { key, dynamic: false, line: 1, column: 0, ...overrides };
}

// ─── pruneNamespace ───────────────────────────────────────────────

describe('pruneNamespace', () => {
  it('keeps only used keys and prunes unused ones', () => {
    const full = {
      show: {
        title: 'Details',
        price: 'Price',
        description: 'Desc',
        tabs: { a: '1', b: '2' },
      },
      index: { heading: 'All', empty: 'None' },
    };
    const result = pruneNamespace(full, ['show.title', 'show.price']);
    expect(result).toEqual({ show: { title: 'Details', price: 'Price' } });
  });

  it('handles deeply nested paths', () => {
    const full = {
      a: { b: { c: { d: 'deep' }, e: 'shallow' } },
    };
    const result = pruneNamespace(full, ['a.b.c.d']);
    expect(result).toEqual({ a: { b: { c: { d: 'deep' } } } });
  });
});

describe('pruneNamespace with dynamic prefix', () => {
  it('includes entire subtree under the prefix', () => {
    const full = {
      tabs: { overview: 'Overview', specs: 'Specs', reviews: 'Reviews' },
      title: 'Product',
    };
    // When a dynamic key has a static prefix like "tabs", the walker
    // passes "tabs" as the sub-key, which resolves to the whole subtree.
    const result = pruneNamespace(full, ['tabs']);
    expect(result).toEqual({
      tabs: { overview: 'Overview', specs: 'Specs', reviews: 'Reviews' },
    });
  });
});

// ─── flattenKeys ──────────────────────────────────────────────────

describe('flattenKeys', () => {
  it('correctly flattens nested objects', () => {
    const data = {
      a: { b: 'v1', c: { d: 'v2' } },
      e: 'v3',
    };
    const keys = flattenKeys(data);
    expect(keys.sort()).toEqual(['a.b', 'a.c.d', 'e'].sort());
  });

  it('handles flat objects', () => {
    const keys = flattenKeys({ x: 1, y: 2 });
    expect(keys.sort()).toEqual(['x', 'y']);
  });

  it('returns empty array for empty object', () => {
    expect(flattenKeys({})).toEqual([]);
  });
});

// ─── generateBundles ──────────────────────────────────────────────

describe('generateBundles', () => {
  const outDir = () => path.join(tmpDir, 'out');

  function makeAnalysis(overrides?: Partial<ProjectAnalysis>): ProjectAnalysis {
    return {
      routes: [],
      availableNamespaces: [],
      allKeys: [],
      sharedNamespaces: [],
      ...overrides,
    };
  }

  it('generates tree-shaken route bundles for each locale', () => {
    // Set up locale files
    writeLocale('en', 'products', {
      show: { title: 'Details', price: 'Price', description: 'Desc' },
      index: { heading: 'All' },
    });

    const analysis = makeAnalysis({
      routes: [
        {
          entryPoint: '/app/pages/products/show.tsx',
          routeId: 'products-show',
          scopes: ['products'],
          keys: [
            makeKey('products.show.title'),
            makeKey('products.show.price'),
          ],
          files: ['/app/pages/products/show.tsx'],
        },
      ],
      availableNamespaces: ['products'],
    });

    const bundles = generateBundles(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en'],
      outDir: outDir(),
    });

    expect(bundles).toHaveLength(1);
    expect(bundles[0].name).toBe('products');
    expect(bundles[0].locale).toBe('en');

    const written = JSON.parse(
      fs.readFileSync(bundles[0].filePath, 'utf-8'),
    );
    expect(written).toEqual({
      products: { show: { title: 'Details', price: 'Price' } },
    });
    // description and index.heading should be pruned
    expect(written.products.show.description).toBeUndefined();
    expect(written.products.index).toBeUndefined();
  });

  it('generates dictionary bundles for shared namespaces', () => {
    writeLocale('en', 'shared', {
      ok: 'OK',
      cancel: 'Cancel',
      save: 'Save',
      delete: 'Delete',
    });

    const analysis = makeAnalysis({
      routes: [
        {
          entryPoint: '/app/pages/a.tsx',
          routeId: 'a',
          scopes: ['shared'],
          keys: [makeKey('shared.ok'), makeKey('shared.cancel')],
          files: ['/app/pages/a.tsx'],
        },
        {
          entryPoint: '/app/pages/b.tsx',
          routeId: 'b',
          scopes: ['shared'],
          keys: [makeKey('shared.ok'), makeKey('shared.save')],
          files: ['/app/pages/b.tsx'],
        },
      ],
      availableNamespaces: ['shared'],
      sharedNamespaces: ['shared'],
    });

    const bundles = generateBundles(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en'],
      outDir: outDir(),
    });

    // Should have 2 route bundles + 1 dictionary bundle
    const dictBundle = bundles.find((b) => b.name === '_dict/shared');
    expect(dictBundle).toBeDefined();

    const written = JSON.parse(
      fs.readFileSync(dictBundle!.filePath, 'utf-8'),
    );
    // Should contain union of all routes' shared keys: ok, cancel, save
    expect(written).toEqual({ ok: 'OK', cancel: 'Cancel', save: 'Save' });
    // "delete" should be pruned
    expect(written.delete).toBeUndefined();
  });

  it('reports correct keyCount and prunedCount', () => {
    writeLocale('en', 'nav', {
      home: 'Home',
      about: 'About',
      contact: 'Contact',
      help: 'Help',
    });

    const analysis = makeAnalysis({
      routes: [
        {
          entryPoint: '/app/pages/index.tsx',
          routeId: 'index',
          scopes: ['nav'],
          keys: [makeKey('nav.home')],
          files: ['/app/pages/index.tsx'],
        },
      ],
      availableNamespaces: ['nav'],
    });

    const bundles = generateBundles(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en'],
      outDir: outDir(),
    });

    expect(bundles).toHaveLength(1);
    expect(bundles[0].keyCount).toBe(1);
    expect(bundles[0].prunedCount).toBe(3);
  });

  it('handles multiple locales', () => {
    writeLocale('en', 'common', { greeting: 'Hello' });
    writeLocale('fr', 'common', { greeting: 'Bonjour' });

    const analysis = makeAnalysis({
      routes: [
        {
          entryPoint: '/app/pages/home.tsx',
          routeId: 'home',
          scopes: ['common'],
          keys: [makeKey('common.greeting')],
          files: ['/app/pages/home.tsx'],
        },
      ],
      availableNamespaces: ['common'],
    });

    const bundles = generateBundles(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en', 'fr'],
      outDir: outDir(),
    });

    expect(bundles).toHaveLength(2);

    const enBundle = bundles.find((b) => b.locale === 'en')!;
    const frBundle = bundles.find((b) => b.locale === 'fr')!;

    const enData = JSON.parse(fs.readFileSync(enBundle.filePath, 'utf-8'));
    const frData = JSON.parse(fs.readFileSync(frBundle.filePath, 'utf-8'));

    expect(enData).toEqual({ common: { greeting: 'Hello' } });
    expect(frData).toEqual({ common: { greeting: 'Bonjour' } });
  });

  it('excludes shared namespace keys from route bundles', () => {
    writeLocale('en', 'shared', { ok: 'OK', cancel: 'Cancel' });
    writeLocale('en', 'products', {
      show: { title: 'Details', price: 'Price' },
      index: { heading: 'All' },
    });

    const analysis = makeAnalysis({
      routes: [
        {
          entryPoint: '/app/pages/products/show.tsx',
          routeId: 'products-show',
          scopes: ['products'],
          keys: [
            makeKey('shared.ok'),         // shared/dictionary key — should be excluded from route bundle
            makeKey('products.show.title'),
            makeKey('products.show.price'),
          ],
          files: ['/app/pages/products/show.tsx'],
        },
      ],
      availableNamespaces: ['shared', 'products'],
      sharedNamespaces: ['shared'],
    });

    const bundles = generateBundles(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en'],
      outDir: outDir(),
    });

    // Route bundle should exist
    const routeBundle = bundles.find((b) => b.name === 'products');
    expect(routeBundle).toBeDefined();

    const routeData = JSON.parse(
      fs.readFileSync(routeBundle!.filePath, 'utf-8'),
    );

    // Route bundle should NOT contain the shared namespace
    expect(routeData.shared).toBeUndefined();
    // Route bundle SHOULD contain the products namespace
    expect(routeData.products).toEqual({ show: { title: 'Details', price: 'Price' } });

    // Dictionary bundle should still contain shared keys
    const dictBundle = bundles.find((b) => b.name === '_dict/shared');
    expect(dictBundle).toBeDefined();

    const dictData = JSON.parse(
      fs.readFileSync(dictBundle!.filePath, 'utf-8'),
    );
    expect(dictData.ok).toBe('OK');
  });

  it('emits empty scope bundle when dictionaries own all keys (prevents 404)', () => {
    writeLocale('en', 'feedback', {
      index: { title: 'Feedback', submit: 'Submit' },
    });

    const analysis = makeAnalysis({
      routes: [
        {
          entryPoint: '/app/pages/feedback/index.tsx',
          routeId: 'feedback-index',
          scopes: ['feedback'],
          keys: [
            makeKey('feedback.index.title'),
            makeKey('feedback.index.submit'),
          ],
          files: ['/app/pages/feedback/index.tsx'],
        },
      ],
      availableNamespaces: ['feedback'],
    });

    const bundles = generateBundles(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en'],
      outDir: outDir(),
      dictionaries: {
        feedbackDict: {
          include: ['feedback.*'],
        },
      },
    });

    // Scope bundle is emitted (as {}) so fetch succeeds and ready becomes true
    const scopeBundle = bundles.find((b) => b.name === 'feedback');
    expect(scopeBundle).toBeDefined();
    expect(scopeBundle!.keyCount).toBe(0);

    // File exists on disk with empty JSON
    const scopeFilePath = path.join(outDir(), 'en', 'feedback.json');
    expect(fs.existsSync(scopeFilePath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(scopeFilePath, 'utf-8'));
    expect(content).toEqual({});

    // Dictionary bundle has the actual keys
    const dictBundle = bundles.find((b) => b.name === '_dict/feedbackDict');
    expect(dictBundle).toBeDefined();
  });

  it('dictionary bundles include ALL namespace keys matching patterns (no tree-shaking)', () => {
    // Dictionaries are the "preload everything" layer — no extraction-based pruning.
    // include: ['feedback.*'] means ALL keys from feedback.json go into the bundle.
    writeLocale('en', 'feedback', {
      validation: {
        required: 'Required',
        minLength: 'Too short',
        maxLength: 'Too long',
        pattern: 'Invalid format',
        email: 'Invalid email',
      },
      success: 'Success!',
      error: 'Error!',
    });

    const analysis = makeAnalysis({
      routes: [
        {
          entryPoint: '/app/pages/contact.tsx',
          routeId: 'contact',
          scopes: ['feedback'],
          keys: [
            makeKey('feedback.validation.required'),
            makeKey('feedback.validation.email'),
          ],
          files: ['/app/pages/contact.tsx'],
        },
      ],
      availableNamespaces: ['feedback'],
    });

    const bundles = generateBundles(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en'],
      outDir: outDir(),
      dictionaries: {
        feedbackDict: {
          include: ['feedback.*'],
        },
      },
    });

    const dictBundle = bundles.find((b) => b.name === '_dict/feedbackDict');
    expect(dictBundle).toBeDefined();

    const written = JSON.parse(
      fs.readFileSync(dictBundle!.filePath, 'utf-8'),
    );

    // ALL keys from the namespace are included — not just extracted ones
    expect(written).toEqual({
      feedback: {
        validation: {
          required: 'Required',
          minLength: 'Too short',
          maxLength: 'Too long',
          pattern: 'Invalid format',
          email: 'Invalid email',
        },
        success: 'Success!',
        error: 'Error!',
      },
    });

    expect(dictBundle!.keyCount).toBe(7);
  });

  it('dictionary exclude patterns still filter keys from the full namespace', () => {
    // exclude carves out sub-paths from the full namespace dump
    writeLocale('en', 'ui', {
      button: { save: 'Save', cancel: 'Cancel', delete: 'Delete', reset: 'Reset' },
      label: { name: 'Name', email: 'Email', phone: 'Phone' },
    });

    const analysis = makeAnalysis({
      routes: [
        {
          entryPoint: '/app/pages/form.tsx',
          routeId: 'form',
          scopes: ['ui'],
          keys: [makeKey('ui.button.save')],
          files: ['/app/pages/form.tsx'],
        },
      ],
      availableNamespaces: ['ui'],
    });

    const bundles = generateBundles(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en'],
      outDir: outDir(),
      dictionaries: {
        uiDict: {
          include: ['ui.*'],
          exclude: ['ui.label.*'],
        },
      },
    });

    const dictBundle = bundles.find((b) => b.name === '_dict/uiDict');
    expect(dictBundle).toBeDefined();

    const written = JSON.parse(
      fs.readFileSync(dictBundle!.filePath, 'utf-8'),
    );

    // All button keys included, all label keys excluded
    expect(written).toEqual({
      ui: {
        button: { save: 'Save', cancel: 'Cancel', delete: 'Delete', reset: 'Reset' },
      },
    });
  });

  // ─── crossNamespacePacking ────────────────────────────────────────

  it('inlines cross-namespace keys into scope bundles when crossNamespacePacking is on', () => {
    writeLocale('en', 'giftcards', {
      show: { title: 'Gift card', subtitle: 'Redeem now' },
      index: { heading: 'All cards' },
    });
    writeLocale('en', 'vendors', {
      compact: { name: 'Vendor', logo: 'Logo' },
      full: { bio: 'Long bio' },
    });
    writeLocale('en', 'activity', {
      types: { redeem: 'Redeemed', issue: 'Issued', expire: 'Expired' },
    });

    const analysis = makeAnalysis({
      routes: [
        {
          entryPoint: '/app/pages/giftcards/show.tsx',
          routeId: 'giftcards-show',
          scopes: ['giftcards.show'],
          keys: [
            makeKey('giftcards.show.title'),
            makeKey('vendors.compact.name'),
            makeKey('activity.types.redeem'),
          ],
          files: ['/app/pages/giftcards/show.tsx'],
        },
      ],
      availableNamespaces: ['giftcards', 'vendors', 'activity'],
    });

    const bundles = generateBundles(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en'],
      outDir: outDir(),
      crossNamespacePacking: true,
    });

    const scopeBundle = bundles.find((b) => b.name === 'giftcards.show')!;
    const written = JSON.parse(fs.readFileSync(scopeBundle.filePath, 'utf-8'));

    expect(written).toEqual({
      giftcards: { show: { title: 'Gift card' } },
      vendors: { compact: { name: 'Vendor' } },
      activity: { types: { redeem: 'Redeemed' } },
    });
    // Tree-shaking still holds per-namespace: unused keys dropped.
    expect(written.giftcards.show.subtitle).toBeUndefined();
    expect(written.vendors.compact.logo).toBeUndefined();
    expect(written.activity.types.issue).toBeUndefined();
  });

  it('skips extras for namespaces already owned by a dictionary', () => {
    writeLocale('en', 'giftcards', { show: { title: 'Gift card' } });
    writeLocale('en', 'shared', { ok: 'OK', cancel: 'Cancel' });

    const analysis = makeAnalysis({
      routes: [
        {
          entryPoint: '/app/pages/giftcards/show.tsx',
          routeId: 'giftcards-show',
          scopes: ['giftcards.show'],
          keys: [
            makeKey('giftcards.show.title'),
            makeKey('shared.ok'),
          ],
          files: ['/app/pages/giftcards/show.tsx'],
        },
      ],
      availableNamespaces: ['giftcards', 'shared'],
    });

    const bundles = generateBundles(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en'],
      outDir: outDir(),
      crossNamespacePacking: true,
      dictionaries: {
        global: { include: ['shared.*'] },
      },
    });

    const scopeBundle = bundles.find((b) => b.name === 'giftcards.show')!;
    const written = JSON.parse(fs.readFileSync(scopeBundle.filePath, 'utf-8'));

    expect(written.giftcards).toEqual({ show: { title: 'Gift card' } });
    // The dictionary already ships shared.* — don't duplicate it into every scope.
    expect(written.shared).toBeUndefined();
  });

  it('does not populate extras when crossNamespacePacking is off', () => {
    writeLocale('en', 'giftcards', { show: { title: 'Gift card' } });
    writeLocale('en', 'vendors', { compact: { name: 'Vendor' } });

    const analysis = makeAnalysis({
      routes: [
        {
          entryPoint: '/app/pages/giftcards/show.tsx',
          routeId: 'giftcards-show',
          scopes: ['giftcards.show'],
          keys: [
            makeKey('giftcards.show.title'),
            makeKey('vendors.compact.name'),
          ],
          files: ['/app/pages/giftcards/show.tsx'],
        },
      ],
      availableNamespaces: ['giftcards', 'vendors'],
    });

    const bundles = generateBundles(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en'],
      outDir: outDir(),
    });

    const scopeBundle = bundles.find((b) => b.name === 'giftcards.show')!;
    const written = JSON.parse(fs.readFileSync(scopeBundle.filePath, 'utf-8'));
    expect(written.vendors).toBeUndefined();
  });
});
