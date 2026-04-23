import fs from 'node:fs';
import path from 'node:path';
import { globSync } from 'tinyglobby';
import ts from 'typescript';
import { extractKeys } from './extract';
import type { ExtractedKey } from './types';
import type {
  WalkerOptions,
  RouteAnalysis,
  ProjectAnalysis,
} from './walker-types';

const RESOLVE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];
const INDEX_EXTENSIONS = ['/index.tsx', '/index.ts'];
const tsconfigPathCache = new Map<string, { baseUrl?: string; paths?: Record<string, string[]> }>();

function tryResolveBase(base: string): string | undefined {
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = base + ext;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  for (const indexSuffix of INDEX_EXTENSIONS) {
    const candidate = base + indexSuffix;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function readTsconfigPaths(rootDir: string): { baseUrl?: string; paths?: Record<string, string[]> } {
  const cached = tsconfigPathCache.get(rootDir);
  if (cached) return cached;

  for (const fileName of ['tsconfig.app.json', 'tsconfig.json']) {
    const fullPath = path.join(rootDir, fileName);
    if (!fs.existsSync(fullPath)) continue;

    try {
      const configFile = ts.readConfigFile(fullPath, ts.sys.readFile);
      if (configFile.error) continue;
      const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, rootDir);
      const result = {
        baseUrl: parsed.options.baseUrl,
        paths: parsed.options.paths,
      };
      tsconfigPathCache.set(rootDir, result);
      return result;
    } catch {
      // Ignore malformed tsconfig and continue with default resolution.
    }
  }

  const empty = {};
  tsconfigPathCache.set(rootDir, empty);
  return empty;
}

function resolveAliasImport(
  specifier: string,
  rootDir: string,
): string | undefined {
  const { baseUrl, paths } = readTsconfigPaths(rootDir);
  if (!baseUrl || !paths) return undefined;

  for (const [pattern, targets] of Object.entries(paths)) {
    const wildcardIndex = pattern.indexOf('*');

    if (wildcardIndex === -1) {
      if (specifier !== pattern) continue;
      for (const target of targets) {
        const candidate = tryResolveBase(path.resolve(baseUrl, target));
        if (candidate) return candidate;
      }
      continue;
    }

    const prefix = pattern.slice(0, wildcardIndex);
    const suffix = pattern.slice(wildcardIndex + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
      continue;
    }

    const matched = specifier.slice(prefix.length, specifier.length - suffix.length);
    for (const target of targets) {
      const resolvedTarget = target.replace('*', matched);
      const candidate = tryResolveBase(path.resolve(baseUrl, resolvedTarget));
      if (candidate) return candidate;
    }
  }

  return undefined;
}

/**
 * Resolves a relative import specifier to an absolute file path.
 *
 * Only handles relative imports (starting with `.` or `..`).
 * Returns undefined for package/bare imports or if no file is found.
 */
export function resolveImport(
  specifier: string,
  fromFile: string,
  rootDir?: string,
): string | undefined {
  if (specifier.startsWith('.')) {
    const base = path.resolve(path.dirname(fromFile), specifier);
    return tryResolveBase(base);
  }

  if (rootDir) {
    return resolveAliasImport(specifier, rootDir);
  }

  return undefined;
}

/**
 * Derives a route identifier from the entry point file path.
 *
 * Strips the rootDir prefix and `src/pages/` prefix, then removes the extension.
 * Falls back to stripping just the rootDir prefix if `src/pages/` is not present.
 */
export function deriveRouteId(entryPoint: string, rootDir: string): string {
  let rel = path.relative(rootDir, entryPoint);

  const pagesPrefix = path.join('src', 'pages') + path.sep;
  if (rel.startsWith(pagesPrefix)) {
    rel = rel.slice(pagesPrefix.length);
  }

  // Strip extension
  const ext = path.extname(rel);
  if (ext) {
    rel = rel.slice(0, -ext.length);
  }

  return rel;
}

/**
 * Discovers namespace names from locale JSON files.
 *
 * Reads `{localesDir}/{defaultLocale}/` and returns sorted `.json`
 * filenames without their extension.
 */
export function discoverNamespaces(
  localesDir: string,
  defaultLocale: string,
): string[] {
  const dir = path.join(localesDir, defaultLocale);

  try {
    const entries = fs.readdirSync(dir);
    return entries
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Walks a single route's import graph starting from the entry point.
 *
 * Reads each file, extracts translation keys and import specifiers,
 * then recursively follows relative imports. Handles circular imports
 * via a visited set and deduplicates keys by key string.
 */
export function walkRoute(
  entryPoint: string,
  options: { rootDir: string; extractionScope: 'global' | 'scoped'; hookSources?: string[] },
): RouteAnalysis {
  const visited = new Set<string>();
  const allKeys: ExtractedKey[] = [];
  const allScopes: string[] = [];
  const allFiles: string[] = [];
  const seenKeys = new Set<string>();

  function visit(filePath: string): void {
    const resolved = path.resolve(filePath);
    if (visited.has(resolved)) {
      return;
    }
    visited.add(resolved);

    let source: string;
    try {
      source = fs.readFileSync(resolved, 'utf-8');
    } catch {
      return;
    }

    allFiles.push(resolved);

    const result = extractKeys(source, {
      scope: options.extractionScope,
      filePath: resolved,
      hookSources: options.hookSources,
    });

    for (const key of result.keys) {
      if (!seenKeys.has(key.key)) {
        seenKeys.add(key.key);
        allKeys.push(key);
      }
    }

    for (const scope of result.scopes) {
      if (!allScopes.includes(scope)) {
        allScopes.push(scope);
      }
    }

    for (const imp of result.imports) {
      const importPath = resolveImport(imp, resolved, options.rootDir);
      if (importPath) {
        visit(importPath);
      }
    }
  }

  visit(entryPoint);

  return {
    entryPoint: path.resolve(entryPoint),
    routeId: deriveRouteId(path.resolve(entryPoint), options.rootDir),
    scopes: allScopes,
    keys: allKeys,
    files: allFiles,
  };
}

/**
 * Walks the entire project: finds page entry points, analyzes each route,
 * discovers namespaces, and computes shared namespace candidates.
 */
export function walkAll(options: WalkerOptions): ProjectAnalysis {
  const rootDir = options.rootDir ?? process.cwd();
  const extractionScope = options.extractionScope ?? 'global';

  // Find page entry points
  const entryFiles = globSync(options.pages, { cwd: rootDir, absolute: true });

  // Walk each route
  const routes = entryFiles.map((entry) =>
    walkRoute(entry, { rootDir, extractionScope, hookSources: options.hookSources }),
  );

  // Discover namespaces
  const localesPath = path.isAbsolute(options.localesDir)
    ? options.localesDir
    : path.join(rootDir, options.localesDir);
  const availableNamespaces = discoverNamespaces(
    localesPath,
    options.defaultLocale,
  );

  // Deduplicate all keys across routes
  const allKeysMap = new Map<string, ExtractedKey>();
  for (const route of routes) {
    for (const key of route.keys) {
      if (!allKeysMap.has(key.key)) {
        allKeysMap.set(key.key, key);
      }
    }
  }
  const allKeys = Array.from(allKeysMap.values());

  // Compute shared namespaces (used by >50% of routes)
  const sharedNamespaces: string[] = [];
  if (routes.length > 0) {
    const nsCounts = new Map<string, number>();
    for (const route of routes) {
      const routeNamespaces = new Set<string>();
      for (const key of route.keys) {
        const ns = key.key.split('.')[0];
        if (ns) {
          routeNamespaces.add(ns);
        }
      }
      for (const ns of routeNamespaces) {
        nsCounts.set(ns, (nsCounts.get(ns) ?? 0) + 1);
      }
    }

    const threshold = routes.length / 2;
    for (const [ns, count] of nsCounts) {
      if (count > threshold) {
        sharedNamespaces.push(ns);
      }
    }
    sharedNamespaces.sort();
  }

  return {
    routes,
    availableNamespaces,
    allKeys,
    sharedNamespaces,
  };
}
