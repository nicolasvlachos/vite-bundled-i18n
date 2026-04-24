import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { flattenKeys, pruneNamespace } from '../extractor/bundle-generator';
import {
  keyMatchesPattern,
  normalizeDictionaries,
  resolveDictionaryOwnership,
} from '../extractor/dictionary-ownership';
import {
  generateTypes,
  writeRuntimeConst,
  runtimePathFromTypesPath,
} from '../extractor/type-generator';
import type { I18nSharedConfig } from '../core/config';
import { I18N_DEV_UPDATE_EVENT } from '../core/runtime-env';
import { buildDevDiagnostics } from './devDiagnostics';
import { resolveImport, walkAll } from '../extractor/walker';
import { buildScopePlans, inferScopeNamespace } from '../extractor/scope-bundles';
import type { ProjectAnalysis } from '../extractor/walker-types';
import {
  createExtractionCache,
  computeConfigHash,
  type ExtractionCache,
} from '../extractor/extraction-cache';
import { resolveCacheConfig, type CacheOptionInput } from '../extractor/cache-config';
import { extractKeys } from '../extractor/extract';
import { PLUGIN_VERSION } from './version';
import { buildScopeMap, type PageIdentifierFn } from '../extractor/scope-map';
import { applyDynamicKeys } from '../extractor/dynamic-keys';

/**
 * Configuration for the i18n dev plugin.
 */
export type I18nDevPluginConfig = I18nSharedConfig;

/**
 * Vite dev plugin that serves combined translation bundles.
 *
 * Instead of the browser making N separate HTTP requests for N namespace
 * files, this plugin intercepts requests to `/__i18n/` and serves all
 * requested namespaces combined into a single JSON response.
 *
 * Three types of bundles:
 *
 * **Named dictionary bundle** (`/__i18n/{locale}/_dict/{name}.json`):
 * Loads only the namespaces belonging to a specific named dictionary.
 * Each dictionary is loaded independently with its own priority.
 *
 * **Scope bundle** (`/__i18n/{locale}/{scope}.json`):
 * Loads the namespace inferred from the scope's first segment. For example,
 * `/__i18n/en/products.show.json` reads `locales/en/products.json` and
 * returns `{ "products": { ... } }`.
 *
 * In production (Group 2+), the Vite build plugin will generate these bundles
 * statically with tree-shaking. This dev plugin is the runtime equivalent —
 * same URL pattern, no tree-shaking, but demonstrates the loading strategy.
 *
 * @param config - Plugin configuration
 * @returns A Vite plugin
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { i18nDevPlugin } from './src/plugin/devPlugin';
 *
 * export default defineConfig({
 *   plugins: [
 *     react(),
 *     i18nDevPlugin({
 *       localesDir: 'locales',
 *       dictionaries: {
 *         global: { keys: ['shared', 'global', 'actions'] },
 *         admin: { keys: ['admin'] },
 *       },
 *     }),
 *   ],
 * });
 * ```
 */
export interface I18nDevPluginOptions {
  assetsDir?: string;
  /** Route/page entry globs used for devtools route diagnostics. */
  pages?: string[];
  /** Default locale for type generation. Required for dev-time autocomplete. */
  defaultLocale?: string;
  /** Extraction scope used by the walker for devtools diagnostics. */
  extractionScope?: 'global' | 'scoped';
  /** Path to write generated types. Defaults to `.i18n/i18n.d.ts`. */
  typesOutPath?: string;
  /**
   * Emit translation bundles as static JSON files into `public/__i18n/`.
   * Only needed for sidecar setups (e.g. Laravel) where the app server
   * serves assets from the public directory instead of Vite's middleware.
   * Default: false — the Vite middleware serves bundles on demand.
   */
  emitPublicAssets?: boolean;
  /** Show devtools toggle button and drawer. Default: true in dev. */
  devBar?: boolean;
  /**
   * Extraction cache control. Accepts:
   * - `true` (or omitted): cache on with defaults
   * - `false`: cache off
   * - object: fine-grained control (see {@link CacheOptionInput})
   *
   * The extraction cache persists AST analysis between runs so warm dev
   * starts skip the walk. Env vars (`VITE_I18N_NO_CACHE`,
   * `VITE_I18N_CLEAR_CACHE`, `VITE_I18N_CACHE_DEBUG`) always take precedence.
   */
  cache?: CacheOptionInput;
  /**
   * Custom page identifier resolver. Mirrors the build plugin option so
   * the dev-served `/__i18n/scope-map.json` uses the same keys as the
   * built asset.
   */
  pageIdentifier?: PageIdentifierFn;
}

const DEV_EMITTED_FILES_MANIFEST = '.vite-bundled-i18n-dev-files.json';

/** Wrap a function so it only runs once, even if invoked from multiple exit hooks. */
function onceFactory(fn: () => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    try { fn(); } catch { /* swallow — best-effort on shutdown */ }
  };
}

/**
 * Fast rejection filter for the transform hook. Vite calls `transform` for
 * every module it processes, including virtual ids, assets, and deps from
 * `node_modules`. We only care about user source files that could contain
 * `t()` / `useI18n()` calls.
 */
const EXTRACTABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs']);
function shouldExtractId(id: string, rootDir: string): boolean {
  if (!id) return false;
  if (id.startsWith('\0')) return false;            // virtual module
  if (id.includes('?')) return false;               // Vite query params
  if (!path.isAbsolute(id)) return false;           // bare specifiers, data: urls, etc.
  if (id.includes(`${path.sep}node_modules${path.sep}`)) return false;
  if (!id.startsWith(rootDir + path.sep) && id !== rootDir) return false;
  return EXTRACTABLE_EXTENSIONS.has(path.extname(id));
}
export function i18nDevPlugin(config: I18nDevPluginConfig, options?: I18nDevPluginOptions): Plugin {
  let projectRoot = '';
  let publicAssetsDir: string | undefined;
  let typesOutPath = '';
  let logger: ResolvedConfig['logger'] | undefined;
  let warnedAboutMissingPublicDir = false;
  let extractionCache: ExtractionCache | undefined;
  let persistCacheOnce: (() => void) | undefined;
  let pendingAddRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingAddRefresh:
    | {
      changedFile: string;
      locales: string[] | undefined;
      reason: 'locale' | 'routes';
    }
    | undefined;
  const assetsPrefix = `/${options?.assetsDir ?? '__i18n'}/`;
  const defaultLocale = options?.defaultLocale ?? 'en';
  const shouldEmitPublicAssets = options?.emitPublicAssets === true;

  // Cache normalizeDictionaries() — it's pure and config doesn't change.
  let cachedDictionaryRules: ReturnType<typeof normalizeDictionaries> | undefined;
  function getDictionaryRules() {
    if (!cachedDictionaryRules) {
      cachedDictionaryRules = normalizeDictionaries(config.dictionaries);
    }
    return cachedDictionaryRules;
  }

  // Cache diagnostics payload — invalidated on locale file changes.
  let cachedDiagnostics: ReturnType<typeof buildDevDiagnostics> | undefined;

  // Cache of (scope → set of cross-ns extras namespaces) for this project,
  // used only when crossNamespacePacking is enabled. Invalidated whenever
  // locale or page source files change. Keyed by scope string.
  let cachedExtrasByScope: Map<string, Set<string>> | undefined;
  let cachedExtrasByNamespace: Map<string, Set<string>> | undefined;

  // Cached scope-map payload. Invalidated alongside diagnostics so the
  // transform hook's "keys changed" signal naturally refreshes it.
  let cachedScopeMap: ReturnType<typeof buildScopeMap> | undefined;

  // Cached scope plans derived from the same analysis as the scope-map
  // payload. Used by `buildScopeBundle` to tree-shake dev responses —
  // same plans the production build uses. Empty list when `options.pages`
  // isn't configured (dev plugin standalone, no analysis available).
  let cachedScopePlans: import('../extractor/scope-bundles').ScopeBundlePlan[] | undefined;

  // Cached walked analysis. Single source of truth for scope plans,
  // ownership, and the legacy `sharedNamespaces` heuristic used when the
  // project doesn't configure named dictionaries.
  let cachedAnalysis: ProjectAnalysis | undefined;

  // Dictionary ownership cache derived from the same analysis as the scope
  // plans. Used by `buildScopeBundle` to skip keys that a dictionary already
  // ships globally — matches production's bundle-generator / compiler
  // filter. Invalidates alongside scope plans since it's derived from the
  // same walked keys.
  let cachedOwnership: ReturnType<typeof resolveDictionaryOwnership> | undefined;

  function getRequestPath(url: string): string {
    const queryIndex = url.indexOf('?');
    const hashIndex = url.indexOf('#');
    const cutIndex = [queryIndex, hashIndex]
      .filter((index) => index !== -1)
      .sort((a, b) => a - b)[0];

    const pathname = cutIndex === undefined
      ? url
      : url.slice(0, cutIndex);

    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  }

  /**
   * Reads a namespace JSON file from the locales directory.
   * Returns the parsed JSON, or undefined if the file doesn't exist.
   */
  function readNamespaceFile(
    locale: string,
    namespace: string,
  ): Record<string, unknown> | undefined {
    const filePath = path.join(
      resolveLocalesPath(),
      locale,
      `${namespace}.json`,
    );

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }

  function resolveLocalesPath(): string {
    return path.isAbsolute(config.localesDir)
      ? config.localesDir
      : path.resolve(projectRoot, config.localesDir);
  }

  function resolveTypesOutPath(): string {
    const generatedOutDir = path.resolve(projectRoot, '.i18n');
    return options?.typesOutPath
      ? path.resolve(projectRoot, options.typesOutPath)
      : path.resolve(generatedOutDir, 'i18n-generated.ts');
  }

  function resolvePublicAssetsDir(resolvedConfig: ResolvedConfig): string | undefined {
    if (typeof resolvedConfig.publicDir === 'string' && resolvedConfig.publicDir.length > 0) {
      const resolvedPublicDir = path.isAbsolute(resolvedConfig.publicDir)
        ? resolvedConfig.publicDir
        : path.resolve(resolvedConfig.root, resolvedConfig.publicDir);
      return path.resolve(resolvedPublicDir, options?.assetsDir ?? '__i18n');
    }

    const fallbackPublicDir = path.resolve(resolvedConfig.root, 'public');
    if (fs.existsSync(fallbackPublicDir) && fs.statSync(fallbackPublicDir).isDirectory()) {
      return path.resolve(fallbackPublicDir, options?.assetsDir ?? '__i18n');
    }

    return undefined;
  }

  function listLocales(): string[] {
    try {
      return fs.readdirSync(resolveLocalesPath(), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }

  function getDiagnosticsPayload() {
    if (!cachedDiagnostics) {
      cachedDiagnostics = buildDevDiagnostics({
        rootDir: projectRoot,
        pages: options?.pages,
        defaultLocale,
        localesDir: config.localesDir,
        extractionScope: options?.extractionScope ?? 'global',
        sharedConfig: config,
        cache: extractionCache,
      });
    }
    return cachedDiagnostics;
  }

  function invalidateDiagnosticsCache(): void {
    cachedDiagnostics = undefined;
    cachedExtrasByScope = undefined;
    cachedExtrasByNamespace = undefined;
    cachedScopeMap = undefined;
    cachedScopePlans = undefined;
    cachedAnalysis = undefined;
    cachedOwnership = undefined;
  }

  /**
   * Compute (and cache) dictionary ownership over every statically extracted
   * key in the project. Mirrors production's emit pipeline, which filters
   * scope-bundle and cross-ns-extras keys through `ownership.keyOwner` so
   * dictionary-claimed keys aren't duplicated into every per-page bundle.
   *
   * Shares invalidation with `cachedScopePlans` — they derive from the same
   * walked extraction data, so any source edit that changes a plan also
   * changes ownership.
   *
   * Returns an empty ownership when no analysis is available (standalone
   * dev plugin without `options.pages`); the caller's filter then becomes
   * a no-op and behavior degrades gracefully to "ship everything".
   */
  function getOwnershipCached(): ReturnType<typeof resolveDictionaryOwnership> {
    if (cachedOwnership) return cachedOwnership;

    // Walking unconditionally would duplicate getScopePlansCached's work;
    // piggyback on its analysis. If plans aren't cached yet we'd still need
    // to walk ourselves — but getScopePlansCached runs on the first
    // buildScopeBundle request, so by the time the lean filter needs
    // ownership the plans (and thus extraction data) are already warm.
    const plans = getScopePlansCached();
    const allKeys = new Set<string>();
    for (const plan of plans) {
      for (const key of plan.keys) allKeys.add(key);
      for (const keys of plan.extras.values()) {
        for (const key of keys) allKeys.add(key);
      }
    }
    cachedOwnership = resolveDictionaryOwnership(allKeys, config.dictionaries);
    return cachedOwnership;
  }

  /**
   * Compute (and cache) the scope plans for the project — same shape the
   * production build uses. Each plan carries a scope's primary keys + any
   * cross-ns extras. Empty array when `options.pages` isn't configured,
   * so `buildScopeBundle` can detect the "no analysis" case and fall back
   * to full namespaces for safety.
   *
   * The cache invalidates with the rest of the diagnostics cache (via
   * locale-file changes and the Vite transform hook on source edits), so
   * plans stay in sync with the extraction state.
   */
  function getScopePlansCached(): import('../extractor/scope-bundles').ScopeBundlePlan[] {
    if (cachedScopePlans) return cachedScopePlans;
    cachedScopePlans = [];
    if (!options?.pages || options.pages.length === 0) return cachedScopePlans;

    try {
      const analysis = walkAll({
        pages: options.pages,
        rootDir: projectRoot,
        localesDir: resolveLocalesPath(),
        defaultLocale,
        extractionScope: options?.extractionScope ?? 'global',
        hookSources: config.extraction?.hookSources,
        cache: extractionCache,
      });
      if (config.bundling?.dynamicKeys && config.bundling.dynamicKeys.length > 0) {
        applyDynamicKeys(analysis, {
          dynamicKeys: config.bundling.dynamicKeys,
          dictionaries: config.dictionaries,
          crossNamespacePacking: config.bundling.crossNamespacePacking,
        });
      }
      const availableKeys = new Set<string>();
      for (const route of analysis.routes) {
        for (const key of route.keys) {
          if (!key.dynamic) availableKeys.add(key.key);
        }
      }
      cachedScopePlans = buildScopePlans(analysis, availableKeys, {
        crossNamespacePacking: config.bundling?.crossNamespacePacking,
      });
      cachedAnalysis = analysis;
    } catch {
      cachedScopePlans = [];
      cachedAnalysis = undefined;
    }
    return cachedScopePlans;
  }

  /**
   * Return the legacy "shared namespaces" heuristic (namespaces used by
   * >50% of routes). Production's `generateBundles` uses this to decide
   * whether a scope's primary/extra namespace keys should be filtered out
   * in favor of a shared dictionary bundle — but ONLY when no named
   * dictionaries are configured. With named dictionaries this is an empty
   * set and the filter is a no-op.
   *
   * Dev must mirror this to keep `dev shape ≡ prod shape` across all
   * three config topologies (named dicts, inferred-shared, neither).
   */
  function getSharedNamespaces(): readonly string[] {
    getScopePlansCached();
    return cachedAnalysis?.sharedNamespaces ?? [];
  }

  function getScopeMapPayload(): ReturnType<typeof buildScopeMap> {
    if (cachedScopeMap) return cachedScopeMap;

    // If pages aren't configured we can't walk; emit a valid but empty map.
    if (!options?.pages || options.pages.length === 0) {
      cachedScopeMap = {
        version: 1,
        defaultLocale,
        pages: {},
      };
      return cachedScopeMap;
    }

    try {
      const analysis = walkAll({
        pages: options.pages,
        rootDir: projectRoot,
        localesDir: resolveLocalesPath(),
        defaultLocale,
        extractionScope: options?.extractionScope ?? 'global',
        hookSources: config.extraction?.hookSources,
        cache: extractionCache,
      });
      // Apply declared dynamic keys before building the scope map so dev
      // matches prod exactly — dev types, `/__i18n/scope-map.json`, and
      // scope-bundle responses all reflect the injected keys.
      if (config.bundling?.dynamicKeys && config.bundling.dynamicKeys.length > 0) {
        applyDynamicKeys(analysis, {
          dynamicKeys: config.bundling.dynamicKeys,
          dictionaries: config.dictionaries,
          crossNamespacePacking: config.bundling.crossNamespacePacking,
        });
      }
      cachedScopeMap = buildScopeMap(analysis, {
        rootDir: projectRoot,
        defaultLocale,
        dictionaries: config.dictionaries,
        pageIdentifier: options?.pageIdentifier,
      });
    } catch {
      cachedScopeMap = {
        version: 1,
        defaultLocale,
        pages: {},
      };
    }
    return cachedScopeMap;
  }

  /**
   * Compute (and cache) which foreign namespaces each scope references —
   * only when `bundling.crossNamespacePacking` is enabled. The dev scope-
   * bundle responder unions these in so cross-namespace keys resolve in
   * dev with the same semantics as the built assets.
   *
   * Returns two indexes:
   * - `byScope`: used when the runtime fetches `/__i18n/{locale}/{scope}.json`.
   * - `byNamespace`: used when the runtime is in devNamespaceMode and fetches
   *   `/__i18n/{locale}/_scope/{namespace}.json` — we union extras across all
   *   scopes that share that primary namespace, since one namespace file backs
   *   many scopes in dev.
   *
   * Walking requires `options.pages` globs. If not provided (dev plugin used
   * without the main i18nPlugin), returns empty indexes and the flag has no
   * dev-mode effect.
   */
  function getExtrasIndex(): {
    byScope: Map<string, Set<string>>;
    byNamespace: Map<string, Set<string>>;
  } {
    if (!cachedExtrasByScope || !cachedExtrasByNamespace) {
      cachedExtrasByScope = new Map();
      cachedExtrasByNamespace = new Map();

      if (config.bundling?.crossNamespacePacking && options?.pages && options.pages.length > 0) {
        let analysis: ProjectAnalysis | undefined;
        try {
          analysis = walkAll({
            pages: options.pages,
            rootDir: projectRoot,
            localesDir: resolveLocalesPath(),
            defaultLocale,
            extractionScope: options?.extractionScope ?? 'global',
            hookSources: config.extraction?.hookSources,
            cache: extractionCache,
          });
        } catch {
          return { byScope: cachedExtrasByScope, byNamespace: cachedExtrasByNamespace };
        }

        // Apply declared dynamic keys before computing extras so dev
        // extras indexes mirror prod.
        if (config.bundling.dynamicKeys && config.bundling.dynamicKeys.length > 0) {
          applyDynamicKeys(analysis, {
            dynamicKeys: config.bundling.dynamicKeys,
            dictionaries: config.dictionaries,
            crossNamespacePacking: true,
          });
        }

        const availableKeys = new Set<string>();
        for (const route of analysis.routes) {
          for (const key of route.keys) {
            if (!key.dynamic) availableKeys.add(key.key);
          }
        }

        const plans = buildScopePlans(analysis, availableKeys, {
          crossNamespacePacking: true,
        });

        for (const plan of plans) {
          const scopeExtras = new Set<string>();
          for (const ns of plan.extras.keys()) scopeExtras.add(ns);
          cachedExtrasByScope.set(plan.scope, scopeExtras);

          let nsBucket = cachedExtrasByNamespace.get(plan.namespace);
          if (!nsBucket) {
            nsBucket = new Set<string>();
            cachedExtrasByNamespace.set(plan.namespace, nsBucket);
          }
          for (const ns of plan.extras.keys()) nsBucket.add(ns);
        }
      }
    }
    return { byScope: cachedExtrasByScope, byNamespace: cachedExtrasByNamespace };
  }

  function writeTextFileIfChanged(outputPath: string, content: string): void {
    try {
      if (fs.readFileSync(outputPath, 'utf-8') === content) {
        return;
      }
    } catch {
      // Ignore missing files and continue writing.
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content, 'utf-8');
  }

  function regenerateTypes() {
    try {
      // Fold page-scope metadata into the generated types when available,
      // so `PAGE_SCOPE_MAP` / `I18nPageIdentifier` stay in sync with what
      // the runtime endpoint reports. Falls back to a bare scope list when
      // pages aren't configured.
      const scopeMap = getScopeMapPayload();
      const pageScopeMap: Record<string, readonly string[]> = {};
      const scopes = new Set<string>();
      for (const [id, entry] of Object.entries(scopeMap.pages)) {
        pageScopeMap[id] = entry.scopes;
        for (const s of entry.scopes) scopes.add(s);
      }
      const typesOutPath = resolveTypesOutPath();
      const hasPageMap = Object.keys(pageScopeMap).length > 0;
      writeTextFileIfChanged(
        typesOutPath,
        generateTypes(
          resolveLocalesPath(),
          defaultLocale,
          scopes.size > 0 ? [...scopes].sort() : undefined,
          hasPageMap ? pageScopeMap : undefined,
        ),
      );
      // Runtime `.js` companion for the `vite-bundled-i18n/generated`
      // resolve.alias — Vite can't resolve tsconfig-path aliases on its own.
      writeRuntimeConst(
        runtimePathFromTypesPath(typesOutPath),
        hasPageMap ? pageScopeMap : undefined,
      );
    } catch {
      // Silently skip if locales dir doesn't exist yet
    }
  }

  function removeManagedDevFiles(manifestPath: string): void {
    let previousFiles: string[] = [];
    try {
      previousFiles = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as string[];
    } catch {
      return;
    }

    for (const relativeFile of previousFiles) {
      if (!publicAssetsDir) break;
      const fullPath = path.join(publicAssetsDir, relativeFile);
      try {
        fs.rmSync(fullPath, { force: true });
      } catch {
        // Ignore stale cleanup failures and continue regenerating files.
      }
    }
  }

  function cleanupDevAssets(): void {
    if (!publicAssetsDir) return;

    const manifestPath = path.join(publicAssetsDir, DEV_EMITTED_FILES_MANIFEST);
    removeManagedDevFiles(manifestPath);

    try {
      fs.rmSync(publicAssetsDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures on shutdown.
    }
  }

  function inferChangedLocales(filePath: string): string[] | undefined {
    const normalizedPath = path.resolve(filePath);
    const localesRoot = `${resolveLocalesPath()}${path.sep}`;
    if (!normalizedPath.startsWith(localesRoot)) {
      return undefined;
    }

    const relativePath = normalizedPath.slice(localesRoot.length);
    const locale = relativePath.split(path.sep)[0];
    return locale ? [locale] : undefined;
  }

  function writeDevAsset(
    relativeFilePath: string,
    payload: unknown,
    writtenFiles: Set<string>,
  ): void {
    if (!publicAssetsDir) return;

    const outputPath = path.join(publicAssetsDir, relativeFilePath);
    writeTextFileIfChanged(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
    writtenFiles.add(relativeFilePath);
  }

  function emitDevAssets(): void {
    if (!shouldEmitPublicAssets) return;

    if (!publicAssetsDir) {
      if (!warnedAboutMissingPublicDir) {
        logger?.warn(
          'vite-bundled-i18n: emitPublicAssets is enabled but no public directory could be resolved. ' +
          'Falling back to Vite-only middleware for /__i18n/* requests.',
        );
        warnedAboutMissingPublicDir = true;
      }
      return;
    }

    const diagnostics = {
      available: false,
      message: 'Route diagnostics are generated on demand by the devtools endpoint.',
      availableNamespaces: [] as string[],
      sharedNamespaces: [] as string[],
      routes: [] as unknown[],
      dictionaries: [] as unknown[],
      collisions: [] as unknown[],
    };
    const manifestPath = path.join(publicAssetsDir, DEV_EMITTED_FILES_MANIFEST);
    const writtenFiles = new Set<string>();

    fs.mkdirSync(publicAssetsDir, { recursive: true });
    removeManagedDevFiles(manifestPath);

    writeDevAsset('__dev/analysis.json', diagnostics, writtenFiles);

    const locales = listLocales();
    const rules = getDictionaryRules();

    for (const locale of locales) {
      for (const rule of rules) {
        writeDevAsset(
          path.join(locale, '_dict', `${rule.name}.json`),
          buildDictionaryBundle(locale, rule.name),
          writtenFiles,
        );
      }

      let files: string[] = [];
      try {
        files = fs.readdirSync(path.join(resolveLocalesPath(), locale))
          .filter((file) => file.endsWith('.json'))
          .sort();
      } catch {
        files = [];
      }

      for (const file of files) {
        const namespace = file.slice(0, -'.json'.length);
        writeDevAsset(
          path.join(locale, '_scope', `${namespace}.json`),
          buildScopeBundle(locale, namespace, 'namespace'),
          writtenFiles,
        );
      }
    }

    writeTextFileIfChanged(
      manifestPath,
      `${JSON.stringify([...writtenFiles].sort(), null, 2)}\n`,
    );
  }

  function refreshDevArtifacts(): void {
    invalidateDiagnosticsCache();
    regenerateTypes();
    emitDevAssets();
  }

  /**
   * Builds a named dictionary bundle — only the namespaces belonging
   * to a specific dictionary, keyed by namespace name.
   */
  function buildDictionaryBundle(
    locale: string,
    dictName: string,
  ): Record<string, unknown> {
    const rule = getDictionaryRules().find((entry) => entry.name === dictName);
    if (!rule) return {};

    const localeDir = path.join(resolveLocalesPath(), locale);
    let files: string[] = [];
    try {
      files = fs.readdirSync(localeDir).filter((file) => file.endsWith('.json'));
    } catch {
      return {};
    }

    const bundle: Record<string, unknown> = {};
    for (const file of files) {
      const ns = file.slice(0, -'.json'.length);
      const data = readNamespaceFile(locale, ns);
      if (!data) continue;

      const matchedSubKeys = flattenKeys(data)
        .filter((subKey) => rule.include.some((pattern) => keyMatchesPattern(`${ns}.${subKey}`, pattern)));
      if (matchedSubKeys.length === 0) continue;

      bundle[ns] = pruneNamespace(data, matchedSubKeys);
    }
    return bundle;
  }

  /**
   * Builds a scope bundle — reads the namespace file(s) inferred from
   * the scope and returns them keyed by namespace name.
   *
   * The first segment of the scope is the namespace:
   *   'products.show' → reads products.json → { products: { ... } }
   *
   * When `bundling.crossNamespacePacking` is enabled and a scope references
   * foreign namespaces, those are included too (full data — dev doesn't
   * tree-shake). For the `_scope/{namespace}` endpoint used in devNamespaceMode,
   * we union extras across every scope that shares this primary namespace.
   */
  /**
   * Build the payload for a dev scope-bundle request.
   *
   * By default (`bundling.dev.leanBundles: true`) the response is
   * tree-shaken per route using the walker's extraction data — matches
   * the production build's shape and keeps large-app dev payloads small.
   * When lean mode is disabled or no plans are available (e.g. pages
   * aren't configured), falls back to full namespaces for safety.
   */
  function buildScopeBundle(
    locale: string,
    scopeOrNamespace: string,
    mode: 'scope' | 'namespace' = 'scope',
  ): Record<string, unknown> {
    const namespace = mode === 'namespace'
      ? scopeOrNamespace
      : inferScopeNamespace(scopeOrNamespace);

    const leanMode = config.bundling?.dev?.leanBundles !== false;
    const bundle: Record<string, unknown> = {};

    // Find the plans that apply to this request. Namespace-mode endpoints
    // (`/_scope/{namespace}`) cover every scope sharing that primary
    // namespace — union their keys and extras. Scope-mode endpoints cover
    // a single scope.
    const plans = leanMode ? getScopePlansCached() : [];
    const relevantPlans = leanMode
      ? plans.filter((p) =>
          mode === 'namespace'
            ? p.namespace === namespace
            : p.scope === scopeOrNamespace,
        )
      : [];

    const primaryData = readNamespaceFile(locale, namespace);

    if (leanMode && relevantPlans.length > 0) {
      // Apply the same two-branch filter prod's `bundle-generator.ts` uses:
      //   1. Dictionary-owned keys (`keyOwner`) — dictionaries ship these
      //      globally, never duplicate into a scope bundle.
      //   2. Legacy inferred-shared namespaces (`sharedNsSet`) — only kicks
      //      in when the project has NO named dictionaries. In that mode
      //      namespaces used by >50% of routes get their own shared bundle;
      //      scope bundles must exclude their keys so there's no overlap.
      //
      // With named dictionaries configured (the common case), `sharedNsSet`
      // is empty and the second branch is a no-op — matches prod exactly.
      const { keyOwner, rules } = getOwnershipCached();
      const hasNamedDictionaries = rules.length > 0;
      const sharedNsSet = hasNamedDictionaries
        ? new Set<string>()
        : new Set(getSharedNamespaces());

      // Tree-shake primary namespace to the route's extracted keys, minus
      // anything dict-owned or shared-inferred for the plan's primary ns.
      const primaryKeys = new Set<string>();
      for (const plan of relevantPlans) {
        if (!hasNamedDictionaries && sharedNsSet.has(plan.namespace)) continue;
        for (const k of plan.keys) {
          if (keyOwner.has(k)) continue;
          primaryKeys.add(k);
        }
      }
      if (primaryData && primaryKeys.size > 0) {
        const subkeys = [...primaryKeys]
          .filter((k) => k.startsWith(`${namespace}.`))
          .map((k) => k.slice(namespace.length + 1));
        if (subkeys.length > 0) {
          bundle[namespace] = pruneNamespace(primaryData, [...new Set(subkeys)]);
        }
      }

      // Cross-namespace extras — skip whole namespaces that are inferred-
      // shared (they go into a legacy shared dictionary bundle instead).
      // Within the remaining namespaces, drop dict-owned keys. Empty-after-
      // filter namespaces are dropped entirely so the response doesn't
      // carry a phantom `{ shared: {} }` entry.
      const extrasByNs = new Map<string, Set<string>>();
      for (const plan of relevantPlans) {
        for (const [extraNs, keys] of plan.extras) {
          if (!hasNamedDictionaries && sharedNsSet.has(extraNs)) continue;
          let set = extrasByNs.get(extraNs);
          if (!set) { set = new Set(); extrasByNs.set(extraNs, set); }
          for (const k of keys) {
            if (keyOwner.has(k)) continue;
            set.add(k);
          }
        }
      }
      for (const [extraNs, keys] of extrasByNs) {
        if (extraNs === namespace) continue;
        if (bundle[extraNs]) continue;
        if (keys.size === 0) continue;
        const extraData = readNamespaceFile(locale, extraNs);
        if (!extraData) continue;
        const subkeys = [...keys]
          .filter((k) => k.startsWith(`${extraNs}.`))
          .map((k) => k.slice(extraNs.length + 1));
        if (subkeys.length > 0) {
          bundle[extraNs] = pruneNamespace(extraData, [...new Set(subkeys)]);
        }
      }

      return bundle;
    }

    // Full-namespace fallback: used when lean mode is disabled OR when no
    // plans are available for this scope/namespace (unknown scope, pages
    // glob not configured, etc.). Preserves the pre-v0.6.1 behavior, with
    // the same dictionary-ownership filter the lean path uses so extras
    // that are fully owned by a dictionary don't duplicate into the bundle.
    if (primaryData) {
      bundle[namespace] = primaryData;
    }

    if (config.bundling?.crossNamespacePacking) {
      const { byScope, byNamespace } = getExtrasIndex();
      const extrasNs = mode === 'namespace'
        ? byNamespace.get(namespace)
        : byScope.get(scopeOrNamespace);
      if (extrasNs) {
        // Mirror the two-branch filter from the lean path:
        //   1. Dictionary-owned keys — but check via rules directly (not
        //      the ownership map) since the full-namespace path includes
        //      keys the extractor never saw.
        //   2. Inferred-shared namespaces when no named dicts are set.
        const rules = getDictionaryRules();
        const hasNamedDictionaries = rules.length > 0;
        const sharedNsSet = hasNamedDictionaries
          ? new Set<string>()
          : new Set(getSharedNamespaces());
        const isDictionaryOwned = (fullKey: string): boolean => {
          for (const rule of rules) {
            const included = rule.include.some((p) => keyMatchesPattern(fullKey, p));
            if (!included) continue;
            const excluded = rule.exclude.some((p) => keyMatchesPattern(fullKey, p));
            if (!excluded) return true;
          }
          return false;
        };

        for (const extraNs of extrasNs) {
          if (extraNs === namespace) continue;
          if (bundle[extraNs]) continue;
          // Inferred-shared namespaces don't ship in scope bundles.
          if (!hasNamedDictionaries && sharedNsSet.has(extraNs)) continue;

          const extraData = readNamespaceFile(locale, extraNs);
          if (!extraData) continue;

          // Fully-owned namespaces are dropped (dictionary covers
          // everything); partially-owned ones get pruned to their non-owned
          // subset so the scope still ships what the dictionary doesn't
          // cover; untouched namespaces (no rule matches) ship whole.
          const flat = flattenKeys(extraData, extraNs);
          const nonOwned = flat.filter((k) => !isDictionaryOwned(k));
          if (nonOwned.length === 0) continue;

          if (nonOwned.length < flat.length) {
            const subkeys = nonOwned.map((k) => k.slice(extraNs.length + 1));
            bundle[extraNs] = pruneNamespace(extraData, subkeys);
          } else {
            bundle[extraNs] = extraData;
          }
        }
      }
    }

    return bundle;
  }

  return {
    name: 'vite-bundled-i18n-dev',
    apply: 'serve',
    config(config) {
      // Mirror the build plugin: alias `vite-bundled-i18n/generated` to the
      // project-local runtime file. Ensures a placeholder exists so Vite's
      // resolver doesn't error on the first navigation before buildStart /
      // configureServer has written the real content.
      const projectRootCfg = config.root ?? process.cwd();
      const generatedDir = path.resolve(projectRootCfg, '.i18n');
      const runtimePath = options?.typesOutPath
        ? runtimePathFromTypesPath(path.resolve(projectRootCfg, options.typesOutPath))
        : path.join(generatedDir, 'i18n-generated.js');
      if (!fs.existsSync(runtimePath)) {
        try { writeRuntimeConst(runtimePath, undefined); } catch { /* non-fatal */ }
      }

      return {
        define: {
          __VITE_I18N_DEV__: JSON.stringify(true),
          __VITE_I18N_DEVBAR__: JSON.stringify(options?.devBar ?? true),
        },
        resolve: {
          alias: {
            'vite-bundled-i18n/generated': runtimePath,
          },
        },
      };
    },
    /**
     * Piggyback on Vite's transform pipeline to keep the extraction cache
     * warm without a separate parse. Vite already tokenized this file for
     * its own pipeline; extracting translation keys is cheap by comparison.
     *
     * We never modify the returned code (`return null`).
     */
    transform(code, id) {
      if (!extractionCache) return null;
      if (!shouldExtractId(id, projectRoot)) return null;

      let stat: fs.Stats;
      try { stat = fs.statSync(id); } catch { return null; }

      const previous = extractionCache.get(id);
      if (
        previous &&
        previous.mtime === stat.mtimeMs &&
        previous.size === stat.size
      ) {
        return null;
      }

      const extraction = extractKeys(code, {
        scope: options?.extractionScope ?? 'global',
        filePath: id,
        hookSources: config.extraction?.hookSources,
        keyFields: config.extraction?.keyFields,
      });

      const resolvedImports: string[] = [];
      for (const imp of extraction.imports) {
        const resolvedImport = resolveImport(imp, id, projectRoot);
        if (resolvedImport) resolvedImports.push(resolvedImport);
      }

      extractionCache.set(id, {
        mtime: stat.mtimeMs,
        size: stat.size,
        imports: resolvedImports,
        keys: extraction.keys,
        scopes: extraction.scopes,
      });

      // Invalidate diagnostics + extras indexes if keys or scopes actually
      // changed — a no-op transform (whitespace edits, reformatting) should
      // not trigger a walk on the next scope-bundle request.
      const previousKeys = previous?.keys.map((k) => k.key).sort().join('|') ?? '';
      const newKeys = extraction.keys.map((k) => k.key).sort().join('|');
      const previousScopes = (previous?.scopes ?? []).slice().sort().join('|');
      const newScopes = extraction.scopes.slice().sort().join('|');

      if (previousKeys !== newKeys || previousScopes !== newScopes) {
        invalidateDiagnosticsCache();
      }

      return null;
    },
    configResolved(resolvedConfig) {
      projectRoot = resolvedConfig.root;
      typesOutPath = resolveTypesOutPath();
      logger = resolvedConfig.logger;
      publicAssetsDir = resolvePublicAssetsDir(resolvedConfig);

      const cacheSettings = resolveCacheConfig(options?.cache, { rootDir: projectRoot });
      if (cacheSettings.enabled) {
        if (cacheSettings.clearBeforeStart) {
          try {
            fs.rmSync(cacheSettings.dir, { recursive: true, force: true });
          } catch {
            // Non-fatal — fall through to a fresh cache.
          }
        }
        extractionCache = createExtractionCache({
          dir: cacheSettings.dir,
          pluginVersion: PLUGIN_VERSION,
          configHash: computeConfigHash({
            pages: options?.pages,
            defaultLocale,
            extractionScope: options?.extractionScope ?? 'global',
            hookSources: config.extraction?.hookSources,
            keyFields: config.extraction?.keyFields,
            dictionaries: config.dictionaries,
            crossNamespacePacking: config.bundling?.crossNamespacePacking,
          }),
          debug: cacheSettings.debug,
        });

        if (cacheSettings.persist) {
          persistCacheOnce = onceFactory(() => extractionCache?.persistToDisk());
          process.once('beforeExit', persistCacheOnce);
          process.once('exit', persistCacheOnce);
        }
      }
    },
    configureServer(server) {
      const localesPath = resolveLocalesPath();

      refreshDevArtifacts();

      // Watch locale files only — type generation and bundle emission depend on them.
      // Page files are NOT watched: route diagnostics are computed on demand.
      server.watcher.add(localesPath);

      if (shouldEmitPublicAssets) {
        server.httpServer?.once('close', cleanupDevAssets);
        process.once('exit', cleanupDevAssets);
      }

      const emitRefreshUpdate = (
        filePath: string,
        reason: 'locale' | 'routes',
      ) => {
        server.ws.send({
          type: 'custom',
          event: I18N_DEV_UPDATE_EVENT,
          data: {
            locales: inferChangedLocales(filePath),
            reason,
            changedFile: filePath,
            generatedAt: new Date().toISOString(),
          },
        });
      };

      const scheduleAddRefresh = (
        filePath: string,
        reason: 'locale' | 'routes',
      ) => {
        pendingAddRefresh = {
          changedFile: filePath,
          locales: inferChangedLocales(filePath),
          reason,
        };

        if (pendingAddRefreshTimer) {
          clearTimeout(pendingAddRefreshTimer);
        }

        pendingAddRefreshTimer = setTimeout(() => {
          pendingAddRefreshTimer = undefined;
          const update = pendingAddRefresh;
          pendingAddRefresh = undefined;
          if (!update) return;
          refreshDevArtifacts();
          server.ws.send({
            type: 'custom',
            event: I18N_DEV_UPDATE_EVENT,
            data: {
              locales: update.locales,
              reason: update.reason,
              changedFile: update.changedFile,
              generatedAt: new Date().toISOString(),
            },
          });
        }, 50);
      };

      const refreshOnChange = (event: 'add' | 'change' | 'unlink', filePath: string) => {
        const normalizedPath = path.resolve(filePath);
        const isGeneratedTypesFile = normalizedPath === typesOutPath;
        const isEmittedDevAsset = publicAssetsDir
          ? normalizedPath === publicAssetsDir || normalizedPath.startsWith(`${publicAssetsDir}${path.sep}`)
          : false;
        const isLocaleFile = normalizedPath.startsWith(localesPath) && normalizedPath.endsWith('.json');

        if (isGeneratedTypesFile || isEmittedDevAsset) {
          return;
        }

        if (!isLocaleFile) {
          return;
        }

        if (event === 'add') {
          scheduleAddRefresh(normalizedPath, 'locale');
          return;
        }

        refreshDevArtifacts();
        emitRefreshUpdate(normalizedPath, 'locale');
      };

      server.watcher.on('change', (filePath) => {
        refreshOnChange('change', filePath);
      });
      server.watcher.on('add', (filePath) => {
        refreshOnChange('add', filePath);
      });
      server.watcher.on('unlink', (filePath) => {
        refreshOnChange('unlink', filePath);
      });

      server.middlewares.use((req, res, next) => {
        const requestPath = req.url ? getRequestPath(req.url) : undefined;

        if (!requestPath?.startsWith(assetsPrefix)) {
          return next();
        }

        const relativePath = requestPath.slice(assetsPrefix.length);

        if (relativePath === '__dev/analysis.json') {
          const diagnostics = getDiagnosticsPayload();
          const json = JSON.stringify(diagnostics);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(json);
          return;
        }

        // scope-map — keyed by whatever pageIdentifier returned. Handled
        // before the greedy `{locale}/(.+).json` matcher below which would
        // otherwise capture it as locale="scope-map", scope="".
        if (relativePath === 'scope-map.json') {
          const map = getScopeMapPayload();
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(JSON.stringify(map));
          return;
        }

        // Named dictionary: {locale}/_dict/{name}.json
        const dictMatch = relativePath.match(
          /^([^/]+)\/_dict\/([^/]+)\.json$/,
        );
        if (dictMatch) {
          const [, locale, dictName] = dictMatch;
          const bundle = buildDictionaryBundle(locale, dictName);
          const json = JSON.stringify(bundle);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(json);
          return;
        }

        const devNamespaceMatch = relativePath.match(
          /^([^/]+)\/_scope\/([^/]+)\.json$/,
        );
        if (devNamespaceMatch) {
          const [, locale, namespace] = devNamespaceMatch;
          const bundle = buildScopeBundle(locale, namespace, 'namespace');
          const json = JSON.stringify(bundle);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(json);
          return;
        }

        // Scope bundle: {locale}/{scope}.json
        const scopeMatch = relativePath.match(
          /^([^/]+)\/(.+)\.json$/,
        );
        if (scopeMatch) {
          const [, locale, scope] = scopeMatch;
          const bundle = buildScopeBundle(locale, scope, 'scope');
          const json = JSON.stringify(bundle);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(json);
          return;
        }

        next();
      });
    },
  };
}
