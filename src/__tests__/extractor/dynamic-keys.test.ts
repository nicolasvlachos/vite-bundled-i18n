import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { applyDynamicKeys } from '../../extractor/dynamic-keys';
import type { ProjectAnalysis, RouteAnalysis } from '../../extractor/walker-types';
import type { ExtractedKey } from '../../extractor/types';

function makeKey(key: string): ExtractedKey {
  return { key, dynamic: false, line: 1, column: 0 };
}

function makeRoute(overrides: Partial<RouteAnalysis>): RouteAnalysis {
  return {
    entryPoint: '/project/src/pages/home.tsx',
    routeId: 'home',
    scopes: [],
    entryScopes: [],
    keys: [],
    files: [],
    ...overrides,
  };
}

function makeAnalysis(routes: RouteAnalysis[]): ProjectAnalysis {
  return { routes, availableNamespaces: [], allKeys: [], sharedNamespaces: [] };
}

describe('applyDynamicKeys', () => {
  it('returns no work and empty orphans when the list is empty', () => {
    const analysis = makeAnalysis([
      makeRoute({ scopes: ['status.dashboard'], entryScopes: ['status.dashboard'] }),
    ]);
    const report = applyDynamicKeys(analysis, { dynamicKeys: [] });
    expect(report.orphans).toEqual([]);
    expect(analysis.routes[0].keys).toEqual([]);
  });

  it('injects a dynamic key into every route whose scope primary namespace matches', () => {
    const routeA = makeRoute({
      entryPoint: path.join('/p', 'a.tsx'),
      routeId: 'a',
      scopes: ['status.dashboard'],
      entryScopes: ['status.dashboard'],
    });
    const routeB = makeRoute({
      entryPoint: path.join('/p', 'b.tsx'),
      routeId: 'b',
      scopes: ['status.detail'],
      entryScopes: ['status.detail'],
    });
    const routeUnrelated = makeRoute({
      entryPoint: path.join('/p', 'c.tsx'),
      routeId: 'c',
      scopes: ['cart.index'],
      entryScopes: ['cart.index'],
    });
    const analysis = makeAnalysis([routeA, routeB, routeUnrelated]);

    const report = applyDynamicKeys(analysis, { dynamicKeys: ['status.active', 'status.pending'] });

    expect(report.orphans).toEqual([]);
    expect(routeA.keys.map((k) => k.key).sort()).toEqual(['status.active', 'status.pending']);
    expect(routeB.keys.map((k) => k.key).sort()).toEqual(['status.active', 'status.pending']);
    expect(routeUnrelated.keys).toEqual([]);
    // allKeys refreshed
    expect(analysis.allKeys.map((k) => k.key).sort()).toEqual(['status.active', 'status.pending']);
  });

  it('with crossNamespacePacking, extends to routes that reference the namespace via other keys', () => {
    // `giftcards.show` route uses vendors.compact.name — its cross-ns extras
    // will include vendors. A dynamic `vendors.*` key should ride along.
    const route = makeRoute({
      entryPoint: path.join('/p', 'giftcards', 'show.tsx'),
      routeId: 'giftcards-show',
      scopes: ['giftcards.show'],
      entryScopes: ['giftcards.show'],
      keys: [makeKey('giftcards.show.title'), makeKey('vendors.compact.name')],
    });
    const analysis = makeAnalysis([route]);

    applyDynamicKeys(analysis, {
      dynamicKeys: ['vendors.status.active'],
      crossNamespacePacking: true,
    });

    expect(route.keys.map((k) => k.key)).toContain('vendors.status.active');
  });

  it('without crossNamespacePacking, routes that only reference a namespace via imports do not receive the key', () => {
    const route = makeRoute({
      entryPoint: path.join('/p', 'a.tsx'),
      routeId: 'a',
      scopes: ['giftcards.show'],
      entryScopes: ['giftcards.show'],
      keys: [makeKey('giftcards.show.title'), makeKey('vendors.compact.name')],
    });
    const analysis = makeAnalysis([route]);

    const report = applyDynamicKeys(analysis, {
      dynamicKeys: ['vendors.status.active'],
      crossNamespacePacking: false,
    });

    // `vendors` namespace is referenced but not the scope's primary — so
    // without cross-ns packing the dynamic key has no home.
    expect(report.orphans).toEqual(['vendors.status.active']);
    expect(route.keys.map((k) => k.key)).not.toContain('vendors.status.active');
  });

  it('skips keys already claimed by a dictionary (no duplication)', () => {
    const route = makeRoute({
      scopes: ['shared.layout'],
      entryScopes: ['shared.layout'],
    });
    const analysis = makeAnalysis([route]);

    const report = applyDynamicKeys(analysis, {
      dynamicKeys: ['shared.ok'],
      dictionaries: {
        global: { include: ['shared.*'] },
      },
    });

    expect(report.orphans).toEqual([]);
    expect(route.keys).toEqual([]); // dictionary already covers it
  });

  it('reports dynamic keys whose namespace matches no route and no dictionary as orphans', () => {
    const analysis = makeAnalysis([
      makeRoute({ scopes: ['cart.index'], entryScopes: ['cart.index'] }),
    ]);
    const report = applyDynamicKeys(analysis, {
      dynamicKeys: ['phantom.alpha', 'phantom.beta'],
    });
    expect(report.orphans.sort()).toEqual(['phantom.alpha', 'phantom.beta']);
  });

  it('treats bare keys without a namespace as orphans', () => {
    const analysis = makeAnalysis([
      makeRoute({ scopes: ['foo'], entryScopes: ['foo'] }),
    ]);
    const report = applyDynamicKeys(analysis, { dynamicKeys: ['barewithoutdot'] });
    expect(report.orphans).toEqual(['barewithoutdot']);
  });

  it('does not add duplicates when re-applied', () => {
    const route = makeRoute({
      scopes: ['status.dashboard'],
      entryScopes: ['status.dashboard'],
    });
    const analysis = makeAnalysis([route]);

    applyDynamicKeys(analysis, { dynamicKeys: ['status.active'] });
    applyDynamicKeys(analysis, { dynamicKeys: ['status.active'] });

    const statusActive = route.keys.filter((k) => k.key === 'status.active');
    expect(statusActive).toHaveLength(1);
  });
});
