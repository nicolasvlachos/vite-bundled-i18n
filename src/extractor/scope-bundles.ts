import type { ProjectAnalysis } from './walker-types';
import type { ExtractedKey } from './types';

export interface ScopeBundlePlan {
  scope: string;
  namespace: string;
  /** Keys from the scope's own (primary) namespace. */
  keys: Set<string>;
  /**
   * Cross-namespace keys referenced on this route, keyed by namespace.
   *
   * Populated only when `buildScopePlans` is called with
   * `crossNamespacePacking: true`. Empty otherwise.
   */
  extras: Map<string, Set<string>>;
  routeIds: Set<string>;
}

export interface BuildScopePlansOptions {
  /**
   * Collect cross-namespace keys into {@link ScopeBundlePlan.extras} so the
   * emit phase can inline them into each scope bundle.
   *
   * @default false
   */
  crossNamespacePacking?: boolean;
}

export function inferScopeNamespace(scope: string): string {
  return scope.includes('.') ? scope.slice(0, scope.indexOf('.')) : scope;
}

function keyNamespace(key: ExtractedKey): string | undefined {
  const source = key.dynamic && key.staticPrefix ? key.staticPrefix : key.key;
  if (!source) return undefined;
  const dotIndex = source.indexOf('.');
  return dotIndex === -1 ? undefined : source.slice(0, dotIndex);
}

function getOrCreate<K, V>(map: Map<K, Set<V>>, key: K): Set<V> {
  let set = map.get(key);
  if (!set) {
    set = new Set<V>();
    map.set(key, set);
  }
  return set;
}

export function buildScopePlans(
  analysis: ProjectAnalysis,
  availableKeys: Iterable<string>,
  options: BuildScopePlansOptions = {},
): ScopeBundlePlan[] {
  const { crossNamespacePacking = false } = options;
  const scopePlans = new Map<string, ScopeBundlePlan>();
  const allAvailableKeys = [...availableKeys];

  for (const route of analysis.routes) {
    for (const scope of route.scopes) {
      const namespace = inferScopeNamespace(scope);
      let plan = scopePlans.get(scope);
      if (!plan) {
        plan = {
          scope,
          namespace,
          keys: new Set<string>(),
          extras: new Map<string, Set<string>>(),
          routeIds: new Set<string>(),
        };
        scopePlans.set(scope, plan);
      }

      plan.routeIds.add(route.routeId);

      for (const key of route.keys) {
        const ns = keyNamespace(key);
        if (!ns) continue;

        const isPrimary = ns === namespace;
        if (!isPrimary && !crossNamespacePacking) continue;

        const bucket = isPrimary ? plan.keys : getOrCreate(plan.extras, ns);

        if (!key.dynamic) {
          bucket.add(key.key);
          continue;
        }

        if (!key.staticPrefix) continue;
        for (const availableKey of allAvailableKeys) {
          if (availableKey.startsWith(key.staticPrefix)) {
            bucket.add(availableKey);
          }
        }
      }
    }
  }

  return [...scopePlans.values()].sort((a, b) => a.scope.localeCompare(b.scope));
}
