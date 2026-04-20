import type { DictionaryConfig } from '../core/types';

export interface NormalizedDictionaryRule {
  name: string;
  include: string[];
  exclude: string[];
  priority: number;
  pinned: boolean;
  order: number;
}

export interface DictionaryOwnership {
  rules: NormalizedDictionaryRule[];
  keyOwner: Map<string, string>;
  dictionaryKeys: Map<string, Set<string>>;
  dictionaryNamespaces: Set<string>;
}

export function getDictionaryIncludePatterns(dict: DictionaryConfig): string[] {
  const fromKeys = (dict.keys ?? []).map((key) => `${key}.*`);
  return [...fromKeys, ...(dict.include ?? [])];
}

export function normalizeDictionaries(
  dictionaries?: Record<string, DictionaryConfig>,
): NormalizedDictionaryRule[] {
  if (!dictionaries) return [];

  return Object.entries(dictionaries)
    .map(([name, dict], order) => ({
      name,
      include: getDictionaryIncludePatterns(dict),
      exclude: dict.exclude ?? [],
      priority: dict.priority ?? 0,
      pinned: dict.pinned ?? false,
      order,
    }))
    .filter((rule) => rule.include.length > 0)
    .sort((a, b) => b.priority - a.priority || a.order - b.order);
}

export function keyMatchesPattern(key: string, pattern: string): boolean {
  if (pattern.includes('.')) {
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return key.startsWith(prefix);
    }
    return key === pattern;
  }

  const namespace = key.split('.')[0];
  if (pattern.endsWith('*')) {
    return namespace.startsWith(pattern.slice(0, -1));
  }
  return namespace === pattern;
}

export function resolveDictionaryOwnership(
  availableKeys: Iterable<string>,
  dictionaries?: Record<string, DictionaryConfig>,
): DictionaryOwnership {
  const rules = normalizeDictionaries(dictionaries);
  const keyOwner = new Map<string, string>();
  const dictionaryKeys = new Map<string, Set<string>>();
  const dictionaryNamespaces = new Set<string>();

  for (const rule of rules) {
    dictionaryKeys.set(rule.name, new Set());
  }

  for (const key of availableKeys) {
    for (const rule of rules) {
      const included = rule.include.some((pattern) => keyMatchesPattern(key, pattern));
      const excluded = rule.exclude.some((pattern) => keyMatchesPattern(key, pattern));
      if (included && !excluded) {
        keyOwner.set(key, rule.name);
        dictionaryKeys.get(rule.name)!.add(key);
        const namespace = key.split('.')[0];
        if (namespace) {
          dictionaryNamespaces.add(namespace);
        }
        break;
      }
    }
  }

  return {
    rules,
    keyOwner,
    dictionaryKeys,
    dictionaryNamespaces,
  };
}
