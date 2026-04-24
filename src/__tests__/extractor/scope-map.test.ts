import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { buildScopeMap, defaultPageIdentifier } from '../../extractor/scope-map';
import type { ProjectAnalysis } from '../../extractor/walker-types';

function makeAnalysis(overrides?: Partial<ProjectAnalysis>): ProjectAnalysis {
  return {
    routes: [],
    availableNamespaces: [],
    allKeys: [],
    sharedNamespaces: [],
    ...overrides,
  };
}

describe('defaultPageIdentifier', () => {
  const rootDir = '/projects/app';

  it('strips the rootDir prefix and the src/pages/ segment', () => {
    expect(
      defaultPageIdentifier(path.join(rootDir, 'src/pages/giftcards/show.tsx'), rootDir),
    ).toBe('giftcards/show');
  });

  it('strips .tsx extension', () => {
    expect(
      defaultPageIdentifier(path.join(rootDir, 'src/pages/home.tsx'), rootDir),
    ).toBe('home');
  });

  it('strips .ts extension', () => {
    expect(
      defaultPageIdentifier(path.join(rootDir, 'src/pages/index.ts'), rootDir),
    ).toBe('index');
  });

  it('strips composite .page.tsx suffix', () => {
    expect(
      defaultPageIdentifier(path.join(rootDir, 'src/pages/products/show.page.tsx'), rootDir),
    ).toBe('products/show');
  });

  it('strips composite .page.ts suffix', () => {
    expect(
      defaultPageIdentifier(path.join(rootDir, 'src/pages/products/show.page.ts'), rootDir),
    ).toBe('products/show');
  });

  it('handles files outside src/pages/ by keeping the relative path', () => {
    expect(
      defaultPageIdentifier(path.join(rootDir, 'app/routes/home.tsx'), rootDir),
    ).toBe('app/routes/home');
  });

  it('normalizes to POSIX separators regardless of path.sep', () => {
    // Construct a Windows-style path manually so the test is platform-agnostic.
    const winAbs = 'C:\\projects\\app\\src\\pages\\giftcards\\show.tsx';
    const result = defaultPageIdentifier(winAbs, 'C:\\projects\\app');
    // Runtime platform's path.relative still normalizes somehow, but the
    // POSIX output contract is what matters — no backslashes in the result.
    expect(result.includes('\\')).toBe(false);
  });
});

describe('buildScopeMap', () => {
  const rootDir = '/projects/app';

  it('emits a page entry per route with its scopes and the app-wide dictionaries', () => {
    const analysis = makeAnalysis({
      routes: [
        {
          entryPoint: path.join(rootDir, 'src/pages/giftcards/show.tsx'),
          routeId: 'giftcards-show',
          scopes: ['giftcards.show'],
          keys: [],
          files: [],
        },
        {
          entryPoint: path.join(rootDir, 'src/pages/cart/index.tsx'),
          routeId: 'cart-index',
          scopes: ['cart.index', 'cart.summary'],
          keys: [],
          files: [],
        },
      ],
    });

    const map = buildScopeMap(analysis, {
      rootDir,
      defaultLocale: 'en',
      dictionaries: {
        global: { include: ['shared.*'] },
        admin: { include: ['admin.*'] },
      },
    });

    expect(map.version).toBe(1);
    expect(map.defaultLocale).toBe('en');
    expect(map.pages['giftcards/show']).toEqual({
      scopes: ['giftcards.show'],
      dictionaries: ['global', 'admin'],
    });
    expect(map.pages['cart/index']).toEqual({
      scopes: ['cart.index', 'cart.summary'],
      dictionaries: ['global', 'admin'],
    });
  });

  it('uses a custom pageIdentifier verbatim as the map key', () => {
    const analysis = makeAnalysis({
      routes: [
        {
          entryPoint: path.join(rootDir, 'admin/customers/pages/index.tsx'),
          routeId: 'admin-customers-index',
          scopes: ['customers.index'],
          keys: [],
          files: [],
        },
      ],
    });

    const map = buildScopeMap(analysis, {
      rootDir,
      defaultLocale: 'en',
      pageIdentifier: (abs) => {
        const rel = abs.slice(rootDir.length + 1);
        return rel.replace(/\/pages\//, '/').replace(/\.tsx$/, '');
      },
    });

    expect(Object.keys(map.pages)).toEqual(['admin/customers/index']);
    expect(map.pages['admin/customers/index'].scopes).toEqual(['customers.index']);
  });

  it('emits an empty dictionaries array when no dictionaries are configured', () => {
    const analysis = makeAnalysis({
      routes: [
        {
          entryPoint: path.join(rootDir, 'src/pages/home.tsx'),
          routeId: 'home',
          scopes: ['home'],
          keys: [],
          files: [],
        },
      ],
    });

    const map = buildScopeMap(analysis, {
      rootDir,
      defaultLocale: 'en',
    });

    expect(map.pages['home'].dictionaries).toEqual([]);
  });

  it('deduplicates scopes within a single route', () => {
    const analysis = makeAnalysis({
      routes: [
        {
          entryPoint: path.join(rootDir, 'src/pages/a.tsx'),
          routeId: 'a',
          scopes: ['a', 'a', 'b'],
          keys: [],
          files: [],
        },
      ],
    });

    const map = buildScopeMap(analysis, { rootDir, defaultLocale: 'en' });
    expect(map.pages['a'].scopes).toEqual(['a', 'b']);
  });

  it('last-wins when two entry points resolve to the same identifier', () => {
    // Edge case: two files with the same identifier (e.g. one is a duplicate).
    // Behavior: later route overwrites — document in the implementation.
    const analysis = makeAnalysis({
      routes: [
        {
          entryPoint: path.join(rootDir, 'src/pages/home.tsx'),
          routeId: 'home-1',
          scopes: ['home.v1'],
          keys: [],
          files: [],
        },
        {
          entryPoint: path.join(rootDir, 'src/pages/home.tsx'),
          routeId: 'home-2',
          scopes: ['home.v2'],
          keys: [],
          files: [],
        },
      ],
    });

    const map = buildScopeMap(analysis, { rootDir, defaultLocale: 'en' });
    expect(map.pages['home'].scopes).toEqual(['home.v2']);
  });
});
