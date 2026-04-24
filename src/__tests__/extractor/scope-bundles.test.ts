import { describe, it, expect } from 'vitest';
import { buildScopePlans } from '../../extractor/scope-bundles';
import type { ProjectAnalysis } from '../../extractor/walker-types';
import type { ExtractedKey } from '../../extractor/types';

function key(k: string): ExtractedKey {
  return { key: k, dynamic: false };
}

function dynamicKey(prefix: string): ExtractedKey {
  return { key: `${prefix}__dynamic__`, dynamic: true, staticPrefix: prefix };
}

function analysis(routes: ProjectAnalysis['routes']): ProjectAnalysis {
  return {
    routes,
    availableNamespaces: [],
    allKeys: [],
    sharedNamespaces: [],
  };
}

describe('buildScopePlans', () => {
  it('collects only primary-namespace keys by default', () => {
    const a = analysis([
      {
        entryPoint: '/pages/giftcards/show.tsx',
        routeId: 'giftcards/show',
        scopes: ['giftcards.show'],
        keys: [
          key('giftcards.show.title'),
          key('vendors.compact.name'),
          key('activity.types.redeem'),
        ],
        files: [],
      },
    ]);

    const plans = buildScopePlans(a, []);
    const plan = plans.find((p) => p.scope === 'giftcards.show')!;

    expect([...plan.keys]).toEqual(['giftcards.show.title']);
    expect(plan.extras).toBeDefined();
    expect(plan.extras.size).toBe(0);
  });

  it('populates extras with cross-namespace keys when crossNamespacePacking is on', () => {
    const a = analysis([
      {
        entryPoint: '/pages/giftcards/show.tsx',
        routeId: 'giftcards/show',
        scopes: ['giftcards.show'],
        keys: [
          key('giftcards.show.title'),
          key('vendors.compact.name'),
          key('activity.types.redeem'),
          key('activity.types.issue'),
        ],
        files: [],
      },
    ]);

    const plans = buildScopePlans(a, [], { crossNamespacePacking: true });
    const plan = plans.find((p) => p.scope === 'giftcards.show')!;

    expect([...plan.keys]).toEqual(['giftcards.show.title']);
    expect([...plan.extras.keys()].sort()).toEqual(['activity', 'vendors']);
    expect([...plan.extras.get('vendors')!]).toEqual(['vendors.compact.name']);
    expect([...plan.extras.get('activity')!].sort()).toEqual([
      'activity.types.issue',
      'activity.types.redeem',
    ]);
  });

  it('tree-shakes extras via dynamic-key static prefix expansion', () => {
    const a = analysis([
      {
        entryPoint: '/pages/giftcards/show.tsx',
        routeId: 'giftcards/show',
        scopes: ['giftcards.show'],
        keys: [dynamicKey('activity.types.')],
        files: [],
      },
    ]);

    const plans = buildScopePlans(
      a,
      ['activity.types.redeem', 'activity.types.issue', 'activity.unrelated.x'],
      { crossNamespacePacking: true },
    );
    const plan = plans.find((p) => p.scope === 'giftcards.show')!;

    expect([...plan.extras.get('activity')!].sort()).toEqual([
      'activity.types.issue',
      'activity.types.redeem',
    ]);
  });

  it('keeps extras empty when flag is off even for cross-namespace references', () => {
    const a = analysis([
      {
        entryPoint: '/pages/a/index.tsx',
        routeId: 'a/index',
        scopes: ['a.index'],
        keys: [key('a.title'), key('b.shared')],
        files: [],
      },
    ]);

    const plans = buildScopePlans(a, []);
    const plan = plans.find((p) => p.scope === 'a.index')!;

    expect([...plan.keys]).toEqual(['a.title']);
    expect(plan.extras.size).toBe(0);
  });
});
