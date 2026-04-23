import path from 'node:path';
import type { I18nSharedConfig } from '../core/config';
import {
  keyMatchesPattern,
  normalizeDictionaries,
  resolveDictionaryOwnership,
} from '../extractor/dictionary-ownership';
import {
  flattenLocaleKeys,
  generateDictionaryOwnershipReport,
} from '../extractor/reports';
import { walkAll } from '../extractor/walker';

export interface DevDiagnosticsRoute {
  routeId: string;
  entryPoint: string;
  scopes: string[];
  files: string[];
  extractedKeys: string[];
  dynamicKeys: string[];
  dictionaryOwnedKeys: string[];
  explicitlyExcludedKeys: string[];
  missingKeys: string[];
}

export interface DevDiagnosticsDictionary {
  name: string;
  priority: number;
  include: string[];
  exclude: string[];
  pinned: boolean;
  ownedKeysCount: number;
}

export interface DevDiagnosticsPayload {
  available: boolean;
  generatedAt: string;
  message?: string;
  availableNamespaces: string[];
  sharedNamespaces: string[];
  routes: DevDiagnosticsRoute[];
  dictionaries: DevDiagnosticsDictionary[];
  collisions: Array<{
    key: string;
    owner: string;
    matchedDictionaries: string[];
  }>;
}

export interface DevDiagnosticsOptions {
  rootDir: string;
  pages?: string[];
  defaultLocale: string;
  localesDir: string;
  extractionScope?: 'global' | 'scoped';
  sharedConfig: I18nSharedConfig;
}

function hasAvailableKey(availableKeys: Map<string, string[]>, fullKey: string): boolean {
  const dotIndex = fullKey.indexOf('.');
  if (dotIndex === -1) return false;
  const namespace = fullKey.slice(0, dotIndex);
  const subKey = fullKey.slice(dotIndex + 1);
  return availableKeys.get(namespace)?.includes(subKey) ?? false;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

export function buildDevDiagnostics(
  options: DevDiagnosticsOptions,
): DevDiagnosticsPayload {
  const pages = options.pages ?? [];
  if (pages.length === 0) {
    return {
      available: false,
      generatedAt: new Date().toISOString(),
      message:
        'Route analysis is unavailable in devtools. Pass buildConfig.pages to i18nPlugin(...) or pages to i18nDevPlugin(...).',
      availableNamespaces: [],
      sharedNamespaces: [],
      routes: [],
      dictionaries: [],
      collisions: [],
    };
  }

  const localesDir = path.isAbsolute(options.localesDir)
    ? options.localesDir
    : path.join(options.rootDir, options.localesDir);
  const analysis = walkAll({
    pages,
    rootDir: options.rootDir,
    localesDir,
    defaultLocale: options.defaultLocale,
    extractionScope: options.extractionScope ?? 'global',
    hookSources: options.sharedConfig.extraction?.hookSources,
  });
  const availableKeys = flattenLocaleKeys(localesDir, options.defaultLocale);
  const allAvailableKeys = [...availableKeys.entries()].flatMap(([namespace, keys]) =>
    keys.map((key) => `${namespace}.${key}`),
  );
  const ownership = resolveDictionaryOwnership(allAvailableKeys, options.sharedConfig.dictionaries);
  const ownershipReport = generateDictionaryOwnershipReport(availableKeys, options.sharedConfig.dictionaries);
  const rules = normalizeDictionaries(options.sharedConfig.dictionaries);

  const routes = analysis.routes.map((route) => {
    const staticKeys = uniqueSorted(
      route.keys
        .filter((key) => !key.dynamic)
        .map((key) => key.key),
    );
    const dynamicKeys = uniqueSorted(
      route.keys
        .filter((key) => key.dynamic)
        .map((key) => key.key),
    );

    const dictionaryOwnedKeys = staticKeys.filter((key) => ownership.keyOwner.has(key));
    const explicitlyExcludedKeys = staticKeys.filter((key) => {
      if (ownership.keyOwner.has(key)) return false;
      return rules.some((rule) =>
        rule.include.some((pattern) => keyMatchesPattern(key, pattern)) &&
        rule.exclude.some((pattern) => keyMatchesPattern(key, pattern)),
      );
    });
    const missingKeys = staticKeys.filter((key) => !hasAvailableKey(availableKeys, key));

    return {
      routeId: route.routeId,
      entryPoint: route.entryPoint,
      scopes: uniqueSorted(route.scopes),
      files: uniqueSorted(route.files),
      extractedKeys: staticKeys,
      dynamicKeys,
      dictionaryOwnedKeys,
      explicitlyExcludedKeys,
      missingKeys,
    };
  });

  return {
    available: true,
    generatedAt: new Date().toISOString(),
    availableNamespaces: analysis.availableNamespaces,
    sharedNamespaces: analysis.sharedNamespaces,
    routes,
    dictionaries: ownership.rules.map((rule) => ({
      name: rule.name,
      priority: rule.priority,
      include: rule.include,
      exclude: rule.exclude,
      pinned: rule.pinned,
      ownedKeysCount: ownership.dictionaryKeys.get(rule.name)?.size ?? 0,
    })),
    collisions: ownershipReport.collisions,
  };
}
