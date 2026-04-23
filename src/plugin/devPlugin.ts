import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { flattenKeys, pruneNamespace } from '../extractor/bundle-generator';
import { keyMatchesPattern, normalizeDictionaries } from '../extractor/dictionary-ownership';
import { generateTypes } from '../extractor/type-generator';
import type { I18nSharedConfig } from '../core/config';
import { I18N_DEV_UPDATE_EVENT } from '../core/runtime-env';
import { buildDevDiagnostics } from './devDiagnostics';

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
}

const DEV_EMITTED_FILES_MANIFEST = '.vite-bundled-i18n-dev-files.json';
export function i18nDevPlugin(config: I18nDevPluginConfig, options?: I18nDevPluginOptions): Plugin {
  let projectRoot = '';
  let publicAssetsDir: string | undefined;
  let typesOutPath = '';
  let logger: ResolvedConfig['logger'] | undefined;
  let warnedAboutMissingPublicDir = false;
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
      });
    }
    return cachedDiagnostics;
  }

  function invalidateDiagnosticsCache(): void {
    cachedDiagnostics = undefined;
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
      writeTextFileIfChanged(
        resolveTypesOutPath(),
        generateTypes(resolveLocalesPath(), defaultLocale),
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
          buildScopeBundle(locale, namespace),
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
   */
  function buildScopeBundle(
    locale: string,
    scope: string,
  ): Record<string, unknown> {
    const namespace = scope.indexOf('.') === -1
      ? scope
      : scope.slice(0, scope.indexOf('.'));

    const bundle: Record<string, unknown> = {};
    const data = readNamespaceFile(locale, namespace);
    if (data) {
      bundle[namespace] = data;
    }
    return bundle;
  }

  return {
    name: 'vite-bundled-i18n-dev',
    apply: 'serve',
    config() {
      return {
        define: {
          __VITE_I18N_DEV__: JSON.stringify(true),
          __VITE_I18N_DEVBAR__: JSON.stringify(options?.devBar ?? true),
        },
      };
    },
    configResolved(resolvedConfig) {
      projectRoot = resolvedConfig.root;
      typesOutPath = resolveTypesOutPath();
      logger = resolvedConfig.logger;
      publicAssetsDir = resolvePublicAssetsDir(resolvedConfig);
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
          const bundle = buildScopeBundle(locale, namespace);
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
          const bundle = buildScopeBundle(locale, scope);
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
