import type { ProjectAnalysis } from './walker-types';
import type { ExtractedKey } from './types';

export interface ScopeBundlePlan {
  scope: string;
  namespace: string;
  keys: Set<string>;
  routeIds: Set<string>;
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

export function buildScopePlans(
  analysis: ProjectAnalysis,
  availableKeys: Iterable<string>,
): ScopeBundlePlan[] {
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
          routeIds: new Set<string>(),
        };
        scopePlans.set(scope, plan);
      }

      plan.routeIds.add(route.routeId);

      for (const key of route.keys) {
        if (keyNamespace(key) !== namespace) continue;

        if (!key.dynamic) {
          plan.keys.add(key.key);
          continue;
        }

        if (!key.staticPrefix) continue;
        for (const availableKey of allAvailableKeys) {
          if (availableKey.startsWith(key.staticPrefix)) {
            plan.keys.add(availableKey);
          }
        }
      }
    }
  }

  return [...scopePlans.values()].sort((a, b) => a.scope.localeCompare(b.scope));
}
