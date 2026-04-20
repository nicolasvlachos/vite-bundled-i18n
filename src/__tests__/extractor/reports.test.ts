import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  flattenLocaleKeys,
  generateManifest,
  generateMissing,
  generateUnused,
  generateStats,
  generateReports,
  generateOverlapAnalysis,
  generateDictionaryOwnershipReport,
} from '../../extractor/reports';
import type { ProjectAnalysis } from '../../extractor/walker-types';
import type { ExtractedKey } from '../../extractor/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-reports-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeLocale(locale: string, namespace: string, data: object) {
  const dir = path.join(tmpDir, 'locales', locale);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${namespace}.json`), JSON.stringify(data));
}

function makeKey(key: string, overrides?: Partial<ExtractedKey>): ExtractedKey {
  return { key, dynamic: false, line: 1, column: 0, ...overrides };
}

/**
 * Minimal but realistic mock analysis:
 *  - Route 1: products/index  — uses products.index.heading, products.index.subheading, shared.ok
 *  - Route 2: products/show   — uses products.show.title, products.show.price, shared.ok
 *  - "products.show.discount" is used in code but NOT in the locale file  → missing
 *  - "products.index.empty" exists in locale file but NOT used in code    → unused
 */
function makeAnalysis(): ProjectAnalysis {
  const route1Keys: ExtractedKey[] = [
    makeKey('products.index.heading', { line: 5 }),
    makeKey('products.index.subheading', { line: 6 }),
    makeKey('shared.ok', { line: 10 }),
    makeKey('products.show.discount', { line: 12 }), // missing in locale
  ];

  const route2Keys: ExtractedKey[] = [
    makeKey('products.show.title', { line: 3 }),
    makeKey('products.show.price', { line: 4 }),
    makeKey('shared.ok', { line: 8 }),
  ];

  // allKeys = deduplicated union (shared.ok appears once)
  const allKeys: ExtractedKey[] = [
    ...route1Keys,
    makeKey('products.show.title', { line: 3 }),
    makeKey('products.show.price', { line: 4 }),
  ];

  return {
    routes: [
      {
        entryPoint: '/app/pages/products/index.tsx',
        routeId: 'products/index',
        scopes: ['products.index'],
        keys: route1Keys,
        files: [
          '/app/pages/products/index.tsx',
          '/app/components/SearchBar.tsx',
        ],
      },
      {
        entryPoint: '/app/pages/products/show.tsx',
        routeId: 'products/show',
        scopes: ['products.show'],
        keys: route2Keys,
        files: ['/app/pages/products/show.tsx'],
      },
    ],
    availableNamespaces: ['products', 'shared'],
    allKeys,
    sharedNamespaces: ['shared'],
  };
}

function writeFixtureLocales() {
  writeLocale('en', 'products', {
    index: {
      heading: 'All Products',
      subheading: 'Browse everything',
      empty: 'Nothing here', // unused in code
    },
    show: {
      title: 'Product Detail',
      price: '$0.00',
      // discount is intentionally absent → missing key
    },
  });
  writeLocale('en', 'shared', {
    ok: 'OK',
    cancel: 'Cancel', // unused in code
  });
}

// ─── flattenLocaleKeys ────────────────────────────────────────────────────────

describe('flattenLocaleKeys', () => {
  it('reads and flattens all namespace files for the default locale', () => {
    writeFixtureLocales();
    const map = flattenLocaleKeys(path.join(tmpDir, 'locales'), 'en');

    expect(map.has('products')).toBe(true);
    expect(map.has('shared')).toBe(true);

    const productKeys = map.get('products')!.sort();
    expect(productKeys).toEqual(
      ['index.heading', 'index.subheading', 'index.empty', 'show.title', 'show.price'].sort(),
    );

    const sharedKeys = map.get('shared')!.sort();
    expect(sharedKeys).toEqual(['ok', 'cancel'].sort());
  });

  it('returns an empty map when the locale directory does not exist', () => {
    const map = flattenLocaleKeys(path.join(tmpDir, 'locales'), 'xx');
    expect(map.size).toBe(0);
  });

  it('ignores non-JSON files in the locale directory', () => {
    const dir = path.join(tmpDir, 'locales', 'en');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), '# notes');
    fs.writeFileSync(path.join(dir, 'common.json'), JSON.stringify({ hello: 'Hi' }));

    const map = flattenLocaleKeys(path.join(tmpDir, 'locales'), 'en');
    expect(map.size).toBe(1);
    expect(map.get('common')).toEqual(['hello']);
  });
});

// ─── generateManifest ────────────────────────────────────────────────────────

describe('generateManifest', () => {
  it('maps each route to its scopes, key strings, and files', () => {
    const analysis = makeAnalysis();
    const manifest = generateManifest(analysis);

    expect(Object.keys(manifest).sort()).toEqual(
      ['products/index', 'products/show'].sort(),
    );

    const indexEntry = manifest['products/index'] as {
      scopes: string[];
      keys: string[];
      files: string[];
    };
    expect(indexEntry.scopes).toEqual(['products.index']);
    expect(indexEntry.keys).toContain('products.index.heading');
    expect(indexEntry.keys).toContain('shared.ok');
    expect(indexEntry.files).toContain('/app/pages/products/index.tsx');
  });

  it('keys in manifest are plain strings, not ExtractedKey objects', () => {
    const analysis = makeAnalysis();
    const manifest = generateManifest(analysis);
    const entry = manifest['products/show'] as { keys: unknown[] };
    for (const k of entry.keys) {
      expect(typeof k).toBe('string');
    }
  });

  it('returns empty manifest for empty analysis', () => {
    const analysis: ProjectAnalysis = {
      routes: [],
      availableNamespaces: [],
      allKeys: [],
      sharedNamespaces: [],
    };
    expect(generateManifest(analysis)).toEqual({});
  });
});

// ─── generateMissing ─────────────────────────────────────────────────────────

describe('generateMissing', () => {
  it('detects keys used in code but absent from translation files', () => {
    writeFixtureLocales();
    const analysis = makeAnalysis();
    const availableKeys = flattenLocaleKeys(path.join(tmpDir, 'locales'), 'en');

    const result = generateMissing(analysis, availableKeys);

    const missingKeys = result.keys.map((e) => e.key);
    expect(missingKeys).toContain('products.show.discount');
  });

  it('does not flag keys that exist in translation files', () => {
    writeFixtureLocales();
    const analysis = makeAnalysis();
    const availableKeys = flattenLocaleKeys(path.join(tmpDir, 'locales'), 'en');

    const result = generateMissing(analysis, availableKeys);

    const missingKeys = result.keys.map((e) => e.key);
    expect(missingKeys).not.toContain('products.index.heading');
    expect(missingKeys).not.toContain('shared.ok');
    expect(missingKeys).not.toContain('products.show.title');
  });

  it('skips dynamic keys', () => {
    const analysis: ProjectAnalysis = {
      routes: [],
      availableNamespaces: [],
      allKeys: [
        makeKey('products.show.tab', { dynamic: true, staticPrefix: 'products.show' }),
      ],
      sharedNamespaces: [],
    };
    const availableKeys = new Map<string, string[]>([['products', ['show.title']]]);

    const result = generateMissing(analysis, availableKeys);
    expect(result.keys).toHaveLength(0);
  });

  it('includes line number in missing entry', () => {
    writeFixtureLocales();
    const analysis = makeAnalysis();
    const availableKeys = flattenLocaleKeys(path.join(tmpDir, 'locales'), 'en');

    const result = generateMissing(analysis, availableKeys);
    const entry = result.keys.find((e) => e.key === 'products.show.discount');
    expect(entry).toBeDefined();
    expect(entry!.line).toBe(12);
  });

  it('includes summary when missing key count exceeds 50', () => {
    // Create an analysis with > 50 keys that are all missing
    const allKeys: ExtractedKey[] = [];
    for (let i = 0; i < 55; i++) {
      allKeys.push(makeKey(`ns.key${i}`, { line: i + 1 }));
    }

    const analysis: ProjectAnalysis = {
      routes: [
        {
          entryPoint: '/app/Page.tsx',
          routeId: 'page',
          scopes: ['ns'],
          keys: allKeys,
          files: ['/app/Page.tsx'],
        },
      ],
      availableNamespaces: ['ns'],
      allKeys,
      sharedNamespaces: [],
    };

    // Empty available keys means all 55 keys will be missing
    const availableKeys = new Map<string, string[]>();

    const result = generateMissing(analysis, availableKeys);

    expect(result.keys).toHaveLength(55);
    expect(result.summary).toBeDefined();
    expect(result.summary!.total).toBe(55);
    expect(result.summary!.hint).toContain('localesDir structure');
  });

  it('does not include summary when missing key count is 50 or fewer', () => {
    const allKeys: ExtractedKey[] = [];
    for (let i = 0; i < 50; i++) {
      allKeys.push(makeKey(`ns.key${i}`, { line: i + 1 }));
    }

    const analysis: ProjectAnalysis = {
      routes: [],
      availableNamespaces: ['ns'],
      allKeys,
      sharedNamespaces: [],
    };

    const availableKeys = new Map<string, string[]>();

    const result = generateMissing(analysis, availableKeys);

    expect(result.keys).toHaveLength(50);
    expect(result.summary).toBeUndefined();
  });

  it('reports empty keys array when nothing is missing', () => {
    const availableKeys = new Map<string, string[]>([
      ['products', ['index.heading']],
    ]);
    const analysis: ProjectAnalysis = {
      routes: [],
      availableNamespaces: ['products'],
      allKeys: [makeKey('products.index.heading')],
      sharedNamespaces: [],
    };

    const result = generateMissing(analysis, availableKeys);
    expect(result.keys).toHaveLength(0);
  });
});

// ─── generateUnused ──────────────────────────────────────────────────────────

describe('generateUnused', () => {
  it('detects keys in translation files not used in code', () => {
    writeFixtureLocales();
    const analysis = makeAnalysis();
    const availableKeys = flattenLocaleKeys(path.join(tmpDir, 'locales'), 'en');

    const result = generateUnused(analysis, availableKeys);

    const unusedKeys = result.keys.map((e) => e.key);
    expect(unusedKeys).toContain('products.index.empty');
    expect(unusedKeys).toContain('shared.cancel');
  });

  it('does not flag keys that are used in code', () => {
    writeFixtureLocales();
    const analysis = makeAnalysis();
    const availableKeys = flattenLocaleKeys(path.join(tmpDir, 'locales'), 'en');

    const result = generateUnused(analysis, availableKeys);

    const unusedKeys = result.keys.map((e) => e.key);
    expect(unusedKeys).not.toContain('products.index.heading');
    expect(unusedKeys).not.toContain('shared.ok');
  });

  it('includes namespace in each unused entry', () => {
    writeFixtureLocales();
    const analysis = makeAnalysis();
    const availableKeys = flattenLocaleKeys(path.join(tmpDir, 'locales'), 'en');

    const result = generateUnused(analysis, availableKeys);

    const cancelEntry = result.keys.find((e) => e.key === 'shared.cancel');
    expect(cancelEntry).toBeDefined();
    expect(cancelEntry!.namespace).toBe('shared');
  });

  it('returns empty keys array when all translation keys are used', () => {
    const availableKeys = new Map<string, string[]>([['products', ['show.title']]]);
    const analysis: ProjectAnalysis = {
      routes: [],
      availableNamespaces: ['products'],
      allKeys: [makeKey('products.show.title')],
      sharedNamespaces: [],
    };

    const result = generateUnused(analysis, availableKeys);
    expect(result.keys).toHaveLength(0);
  });
});

// ─── generateStats ───────────────────────────────────────────────────────────

describe('generateStats', () => {
  it('computes correct counts', () => {
    writeFixtureLocales();
    const analysis = makeAnalysis();
    const availableKeys = flattenLocaleKeys(path.join(tmpDir, 'locales'), 'en');

    const stats = generateStats(analysis, availableKeys) as {
      totalKeysInCode: number;
      totalKeysInFiles: number;
      usedKeys: number;
      missingKeys: number;
      unusedKeys: number;
      routes: number;
      namespaces: number;
      sharedNamespaces: string[];
      perRoute: Array<{
        routeId: string;
        usedKeys: number;
        availableKeys: number;
        prunedKeys: number;
      }>;
    };

    // products: 5 keys (index.heading, index.subheading, index.empty, show.title, show.price)
    // shared: 2 keys (ok, cancel)
    expect(stats.totalKeysInFiles).toBe(7);
    expect(stats.totalKeysInCode).toBe(analysis.allKeys.length);
    expect(stats.usedKeys).toBe(analysis.allKeys.length);

    // products.show.discount is missing
    expect(stats.missingKeys).toBe(1);

    // products.index.empty + shared.cancel are unused
    expect(stats.unusedKeys).toBe(2);

    expect(stats.routes).toBe(2);
    expect(stats.namespaces).toBe(2);
    expect(stats.sharedNamespaces).toEqual(['shared']);

    expect(stats.perRoute).toHaveLength(2);
    const indexStats = stats.perRoute.find((r) => r.routeId === 'products/index');
    expect(indexStats).toBeDefined();
    expect(indexStats!.availableKeys).toBe(7);
  });

  it('perRoute prunedKeys = availableKeys - usedKeys', () => {
    writeFixtureLocales();
    const analysis = makeAnalysis();
    const availableKeys = flattenLocaleKeys(path.join(tmpDir, 'locales'), 'en');

    const stats = generateStats(analysis, availableKeys) as {
      perRoute: Array<{ routeId: string; usedKeys: number; availableKeys: number; prunedKeys: number }>;
    };

    for (const entry of stats.perRoute) {
      expect(entry.prunedKeys).toBe(entry.availableKeys - entry.usedKeys);
    }
  });
});

// ─── generateReports ─────────────────────────────────────────────────────────

describe('generateReports', () => {
  it('writes all four JSON report files to outDir', () => {
    writeFixtureLocales();
    const analysis = makeAnalysis();
    const outDir = path.join(tmpDir, 'reports');

    generateReports(analysis, path.join(tmpDir, 'locales'), 'en', outDir);

    for (const name of ['manifest.json', 'missing.json', 'unused.json', 'stats.json', 'overlap.json', 'ownership.json']) {
      expect(fs.existsSync(path.join(outDir, name))).toBe(true);
    }
  });

  it('manifest.json contains correct route entries', () => {
    writeFixtureLocales();
    const analysis = makeAnalysis();
    const outDir = path.join(tmpDir, 'reports');

    generateReports(analysis, path.join(tmpDir, 'locales'), 'en', outDir);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf-8'),
    ) as Record<string, { scopes: string[]; keys: string[]; files: string[] }>;

    expect(Object.keys(manifest)).toContain('products/index');
    expect(manifest['products/index'].scopes).toEqual(['products.index']);
    expect(manifest['products/index'].keys).toContain('products.index.heading');
  });

  it('missing.json lists keys absent from translation files', () => {
    writeFixtureLocales();
    const analysis = makeAnalysis();
    const outDir = path.join(tmpDir, 'reports');

    generateReports(analysis, path.join(tmpDir, 'locales'), 'en', outDir);

    const missing = JSON.parse(
      fs.readFileSync(path.join(outDir, 'missing.json'), 'utf-8'),
    ) as { keys: Array<{ key: string }> };

    expect(missing.keys.map((e) => e.key)).toContain('products.show.discount');
  });

  it('unused.json lists translation keys not referenced in code', () => {
    writeFixtureLocales();
    const analysis = makeAnalysis();
    const outDir = path.join(tmpDir, 'reports');

    generateReports(analysis, path.join(tmpDir, 'locales'), 'en', outDir);

    const unused = JSON.parse(
      fs.readFileSync(path.join(outDir, 'unused.json'), 'utf-8'),
    ) as { keys: Array<{ key: string }> };

    expect(unused.keys.map((e) => e.key)).toContain('products.index.empty');
    expect(unused.keys.map((e) => e.key)).toContain('shared.cancel');
  });

  it('stats.json contains expected shape', () => {
    writeFixtureLocales();
    const analysis = makeAnalysis();
    const outDir = path.join(tmpDir, 'reports');

    generateReports(analysis, path.join(tmpDir, 'locales'), 'en', outDir);

    const stats = JSON.parse(
      fs.readFileSync(path.join(outDir, 'stats.json'), 'utf-8'),
    ) as Record<string, unknown>;

    expect(stats).toHaveProperty('totalKeysInCode');
    expect(stats).toHaveProperty('totalKeysInFiles');
    expect(stats).toHaveProperty('missingKeys');
    expect(stats).toHaveProperty('unusedKeys');
    expect(stats).toHaveProperty('routes');
    expect(stats).toHaveProperty('namespaces');
    expect(stats).toHaveProperty('sharedNamespaces');
    expect(stats).toHaveProperty('perRoute');
    expect(Array.isArray(stats.perRoute)).toBe(true);
    expect(stats).toHaveProperty('sharedKeysCount');
    expect(stats).toHaveProperty('dictionaryCandidates');
    expect(Array.isArray(stats.dictionaryCandidates)).toBe(true);
  });

  it('creates outDir when it does not exist', () => {
    writeFixtureLocales();
    const analysis = makeAnalysis();
    const outDir = path.join(tmpDir, 'deeply', 'nested', 'reports');

    expect(fs.existsSync(outDir)).toBe(false);
    generateReports(analysis, path.join(tmpDir, 'locales'), 'en', outDir);
    expect(fs.existsSync(outDir)).toBe(true);
  });

  it('overlap.json contains candidates and namespaceUsage', () => {
    writeFixtureLocales();
    const analysis = makeAnalysis();
    const outDir = path.join(tmpDir, 'reports');

    generateReports(analysis, path.join(tmpDir, 'locales'), 'en', outDir);

    const overlap = JSON.parse(
      fs.readFileSync(path.join(outDir, 'overlap.json'), 'utf-8'),
    ) as { candidates: unknown[]; namespaceUsage: unknown[] };

    expect(Array.isArray(overlap.candidates)).toBe(true);
    expect(Array.isArray(overlap.namespaceUsage)).toBe(true);
  });

  it('ownership report contains owned keys and collisions', () => {
    writeFixtureLocales();
    const availableKeys = flattenLocaleKeys(path.join(tmpDir, 'locales'), 'en');
    const ownership = generateDictionaryOwnershipReport(availableKeys, {
      global: { include: ['shared.*'], priority: 1 },
      ui: { include: ['shared.ok'], priority: 10 },
    });

    expect(ownership.rules).toHaveLength(2);
    expect(ownership.collisions.some((entry) => entry.key === 'shared.ok')).toBe(true);
    expect(ownership.rules.find((rule) => rule.name === 'ui')?.ownedKeys).toContain('shared.ok');
  });
});

// ─── generateOverlapAnalysis ──────────────────────────────────────────────────

describe('generateOverlapAnalysis', () => {
  function makeMultiRouteAnalysis(): ProjectAnalysis {
    // 3 routes:
    //   PageA: shared.ok, shared.cancel, products.title
    //   PageB: shared.ok, shared.cancel, cart.title
    //   PageC: shared.ok, account.title
    const pageAKeys: ExtractedKey[] = [
      makeKey('shared.ok'),
      makeKey('shared.cancel'),
      makeKey('products.title'),
    ];
    const pageBKeys: ExtractedKey[] = [
      makeKey('shared.ok'),
      makeKey('shared.cancel'),
      makeKey('cart.title'),
    ];
    const pageCKeys: ExtractedKey[] = [
      makeKey('shared.ok'),
      makeKey('account.title'),
    ];

    return {
      routes: [
        {
          entryPoint: '/app/PageA.tsx',
          routeId: 'PageA',
          scopes: [],
          keys: pageAKeys,
          files: ['/app/PageA.tsx'],
        },
        {
          entryPoint: '/app/PageB.tsx',
          routeId: 'PageB',
          scopes: [],
          keys: pageBKeys,
          files: ['/app/PageB.tsx'],
        },
        {
          entryPoint: '/app/PageC.tsx',
          routeId: 'PageC',
          scopes: [],
          keys: pageCKeys,
          files: ['/app/PageC.tsx'],
        },
      ],
      availableNamespaces: ['shared', 'products', 'cart', 'account'],
      allKeys: [
        makeKey('shared.ok'),
        makeKey('shared.cancel'),
        makeKey('products.title'),
        makeKey('cart.title'),
        makeKey('account.title'),
      ],
      sharedNamespaces: ['shared'],
    };
  }

  it('identifies keys shared across multiple routes', () => {
    const analysis = makeMultiRouteAnalysis();
    const result = generateOverlapAnalysis(analysis);

    const candidate = result.candidates.find((c) => c.key === 'shared.ok');
    expect(candidate).toBeDefined();
    expect(candidate!.routeCount).toBe(3);
    expect(candidate!.usedByRoutes.sort()).toEqual(['PageA', 'PageB', 'PageC'].sort());
  });

  it('identifies shared.cancel as used by 2 routes', () => {
    const analysis = makeMultiRouteAnalysis();
    const result = generateOverlapAnalysis(analysis);

    const candidate = result.candidates.find((c) => c.key === 'shared.cancel');
    expect(candidate).toBeDefined();
    expect(candidate!.routeCount).toBe(2);
  });

  it('does not include keys used by only one route', () => {
    const analysis = makeMultiRouteAnalysis();
    const result = generateOverlapAnalysis(analysis);

    const uniqueKeys = ['products.title', 'cart.title', 'account.title'];
    for (const key of uniqueKeys) {
      expect(result.candidates.find((c) => c.key === key)).toBeUndefined();
    }
  });

  it('excludes dictionary namespace keys from candidates', () => {
    const analysis = makeMultiRouteAnalysis();
    const dictNs = new Set(['shared']);
    const result = generateOverlapAnalysis(analysis, dictNs);

    const sharedCandidates = result.candidates.filter((c) => c.namespace === 'shared');
    expect(sharedCandidates).toHaveLength(0);
  });

  it('still includes non-dictionary shared keys when a dict namespace is provided', () => {
    // Add a non-dict key that appears in 2 routes
    const analysis = makeMultiRouteAnalysis();
    // products.title is only in PageA, so let's add it to PageB too
    analysis.routes[1].keys.push(makeKey('products.title'));
    const dictNs = new Set(['shared']);
    const result = generateOverlapAnalysis(analysis, dictNs);

    const productsCandidates = result.candidates.filter((c) => c.namespace === 'products');
    expect(productsCandidates.length).toBeGreaterThan(0);
  });

  it('reports namespace usage percentages', () => {
    const analysis = makeMultiRouteAnalysis();
    const result = generateOverlapAnalysis(analysis);

    // 'shared' is used by all 3 routes → 100%
    const sharedEntry = result.namespaceUsage.find((n) => n.namespace === 'shared');
    expect(sharedEntry).toBeDefined();
    expect(sharedEntry!.routeCount).toBe(3);
    expect(sharedEntry!.totalRoutes).toBe(3);
    expect(sharedEntry!.percentage).toBe(100);

    // 'products' is used by only PageA → 33%
    const productsEntry = result.namespaceUsage.find((n) => n.namespace === 'products');
    expect(productsEntry).toBeDefined();
    expect(productsEntry!.routeCount).toBe(1);
    expect(productsEntry!.percentage).toBe(33);
  });

  it('marks namespace as inDictionary when present in dictionaryNamespaces', () => {
    const analysis = makeMultiRouteAnalysis();
    const dictNs = new Set(['shared']);
    const result = generateOverlapAnalysis(analysis, dictNs);

    const sharedEntry = result.namespaceUsage.find((n) => n.namespace === 'shared');
    expect(sharedEntry!.inDictionary).toBe(true);

    const productsEntry = result.namespaceUsage.find((n) => n.namespace === 'products');
    expect(productsEntry!.inDictionary).toBe(false);
  });

  it('returns empty candidates and namespaceUsage for empty analysis', () => {
    const analysis: ProjectAnalysis = {
      routes: [],
      availableNamespaces: [],
      allKeys: [],
      sharedNamespaces: [],
    };
    const result = generateOverlapAnalysis(analysis);
    expect(result.candidates).toHaveLength(0);
    expect(result.namespaceUsage).toHaveLength(0);
  });

  it('skips dynamic keys when building candidates', () => {
    const analysis: ProjectAnalysis = {
      routes: [
        {
          entryPoint: '/app/PageA.tsx',
          routeId: 'PageA',
          scopes: [],
          keys: [makeKey('shared.ok', { dynamic: true })],
          files: ['/app/PageA.tsx'],
        },
        {
          entryPoint: '/app/PageB.tsx',
          routeId: 'PageB',
          scopes: [],
          keys: [makeKey('shared.ok', { dynamic: true })],
          files: ['/app/PageB.tsx'],
        },
      ],
      availableNamespaces: ['shared'],
      allKeys: [],
      sharedNamespaces: [],
    };
    const result = generateOverlapAnalysis(analysis);
    expect(result.candidates).toHaveLength(0);
  });

  it('candidate namespace field matches the namespace portion of the key', () => {
    const analysis = makeMultiRouteAnalysis();
    const result = generateOverlapAnalysis(analysis);

    for (const candidate of result.candidates) {
      const expectedNs = candidate.key.substring(0, candidate.key.indexOf('.'));
      expect(candidate.namespace).toBe(expectedNs);
    }
  });
});
