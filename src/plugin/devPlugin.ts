import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { flattenKeys, pruneNamespace } from '../extractor/bundle-generator';
import { keyMatchesPattern, normalizeDictionaries } from '../extractor/dictionary-ownership';
import type { I18nSharedConfig } from '../core/config';

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
export function i18nDevPlugin(config: I18nDevPluginConfig): Plugin {
  let projectRoot = '';

  /**
   * Reads a namespace JSON file from the locales directory.
   * Returns the parsed JSON, or undefined if the file doesn't exist.
   */
  function readNamespaceFile(
    locale: string,
    namespace: string,
  ): Record<string, unknown> | undefined {
    const filePath = path.join(
      projectRoot,
      config.localesDir,
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

  /**
   * Builds a named dictionary bundle — only the namespaces belonging
   * to a specific dictionary, keyed by namespace name.
   */
  function buildDictionaryBundle(
    locale: string,
    dictName: string,
  ): Record<string, unknown> {
    const rule = normalizeDictionaries(config.dictionaries).find((entry) => entry.name === dictName);
    if (!rule) return {};

    const localeDir = path.join(projectRoot, config.localesDir, locale);
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
    configResolved(resolvedConfig) {
      projectRoot = resolvedConfig.root;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/__i18n/')) {
          return next();
        }

        // Named dictionary: /__i18n/{locale}/_dict/{name}.json
        const dictMatch = req.url.match(
          /^\/__i18n\/([^/]+)\/_dict\/([^/]+)\.json$/,
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

        // Scope bundle: /__i18n/{locale}/{scope}.json
        const scopeMatch = req.url.match(
          /^\/__i18n\/([^/]+)\/(.+)\.json$/,
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
