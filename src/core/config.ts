import type { DictionaryConfig } from './types';

/**
 * Shared i18n configuration used by both the runtime (`createI18n`) and
 * the Vite dev plugin (`i18nDevPlugin`). Define this once in a shared
 * file and import it in both places to prevent config drift.
 *
 * This is the subset of config that must be identical between the
 * runtime and the plugin. Runtime-only fields (like `locale`) are
 * not included here.
 */
export interface I18nSharedConfig {
  /** Path to the locales directory. Relative to project root for the plugin, URL path for the runtime. */
  localesDir: string;
  /** Named groups of namespaces. Must be identical between runtime and plugin. */
  dictionaries?: Record<string, DictionaryConfig>;
  /** Extraction configuration shared between the plugin and CLI. */
  extraction?: {
    /** Additional property names to scan as translation key fields. */
    keyFields?: string[];
    /**
     * Additional module specifiers that export `useI18n`.
     *
     * The extractor only recognizes `useI18n` imported from `vite-bundled-i18n/react`
     * by default. If your app wraps `useI18n` in a custom hook that re-exports it
     * from a different path, add that path here so the extractor can trace scope
     * declarations and `t()` calls through the wrapper.
     *
     * @example
     * ```ts
     * extraction: {
     *   hookSources: ['@/hooks/use-page-i18n-scope'],
     * }
     * ```
     */
    hookSources?: string[];
  };
  /** Bundling behavior for scope/dictionary emission. */
  bundling?: {
    /**
     * Inline cross-namespace keys into each scope bundle.
     *
     * By default, a scope bundle contains only the keys that belong to the
     * scope's own namespace (e.g. `products.show` → `products.*` only). Keys
     * referenced on the route from other namespaces are expected to be
     * covered by a dictionary.
     *
     * When enabled, the extractor collects cross-namespace keys referenced
     * on each route, tree-shakes them down to just the used subset, and
     * inlines them into the same scope bundle. Keys that are already owned
     * by a dictionary are skipped (no point duplicating the always-available
     * layer into per-page bundles).
     *
     * This trades a slightly larger per-scope payload for zero extra HTTP
     * requests and zero ceremony around shared cross-module components.
     *
     * @default false
     */
    crossNamespacePacking?: boolean;
    /**
     * After extraction, verify that every file matching the `pages` glob
     * declares at least one `useI18n('<literal>')` scope. Files without
     * a registered scope don't contribute to any scope bundle — their
     * translation keys only work if covered by a dictionary, which is
     * almost always a mistake.
     *
     * - `'off'` — no check
     * - `'warn'` (default) — log a warning per offender via Vite's logger
     * - `'error'` — throw during the build; fails CI
     */
    strictScopeRegistration?: 'off' | 'warn' | 'error';
    /**
     * Fully qualified keys the extractor can't see from static `t()` calls —
     * e.g. keys built from variables (`t.dynamic(\`status.\${state}\`)`) or
     * keys resolved at runtime via a map.
     *
     * Each listed key is added to every route whose scope's primary
     * namespace (or packed cross-ns extras namespace) matches the key's
     * namespace. Dictionary-owned keys are skipped — dictionaries already
     * guarantee global availability.
     *
     * Keys whose namespace matches no route and isn't dictionary-owned
     * emit a build warning. A "dangling" dynamic key silently bloats
     * nothing; flagging it forces the user to correct the config.
     *
     * @example
     * ```ts
     * bundling: {
     *   dynamicKeys: ['status.active', 'status.pending', 'status.failed'],
     * }
     * ```
     */
    dynamicKeys?: readonly string[];
    /** Dev-server bundle shape. Build output is always tree-shaken. */
    dev?: {
      /**
       * Tree-shake dev bundles using the walker's extraction data.
       *
       * When `true` (default), each dev scope-bundle response contains only
       * the keys the route's AST extraction found — same shape as the
       * production build. Matches prod semantics and keeps per-scope payloads
       * small on large apps (typically 10× to 20× smaller than the full
       * namespace).
       *
       * When `false`, falls back to the v0.6.0 behavior of shipping the
       * whole namespace (plus any full cross-ns extras). Kept for escape
       * hatch — properly-structured apps should leave the default on.
       *
       * Falls back to full namespaces automatically when `options.pages`
       * isn't configured (no analysis available).
       *
       * @default true
       */
      leanBundles?: boolean;
    };
  };
}

/**
 * Defines the shared i18n configuration.
 *
 * Use this to create a config object that is imported by both `createI18n()`
 * and `i18nDevPlugin()`, ensuring they stay in sync.
 *
 * @param config - The shared configuration
 * @returns The same config object (identity function for type safety and readability)
 *
 * @example
 * ```ts
 * // src/i18n.config.ts
 * import { defineI18nConfig } from 'vite-bundled-i18n';
 *
 * export const i18nConfig = defineI18nConfig({
 *   localesDir: 'locales',
 *   dictionaries: {
 *     global: { keys: ['shared', 'global', 'actions'] },
 *   },
 * });
 * ```
 *
 * ```ts
 * // src/i18n.ts — runtime
 * import { createI18n } from 'vite-bundled-i18n';
 * import { i18nConfig } from './i18n.config';
 *
 * export const i18n = createI18n({
 *   ...i18nConfig,
 *   localesDir: '/' + i18nConfig.localesDir, // URL path for browser
 *   locale: 'en',
 *   defaultLocale: 'en',
 *   supportedLocales: ['en', 'bg'],
 * });
 * ```
 *
 * ```ts
 * // vite.config.ts — plugin
 * import { i18nConfig } from './src/i18n.config';
 *
 * i18nDevPlugin(i18nConfig)
 * ```
 */
export function defineI18nConfig(config: I18nSharedConfig): I18nSharedConfig {
  validateConfig(config);
  return config;
}

function getDictionaryPatterns(dict: DictionaryConfig): string[] {
  const fromKeys = (dict.keys ?? []).map((key) => `${key}.*`);
  return [...fromKeys, ...(dict.include ?? [])];
}

function isValidPattern(pattern: string): boolean {
  if (!pattern || typeof pattern !== 'string') return false;
  if (pattern.includes('*')) {
    return pattern.endsWith('*') && pattern.indexOf('*') === pattern.length - 1;
  }
  return true;
}

function validateConfig(config: I18nSharedConfig): void {
  if (!config.localesDir || typeof config.localesDir !== 'string') {
    throw new Error('vite-bundled-i18n: localesDir must be a non-empty string');
  }

  if (config.dictionaries) {
    for (const [name, dict] of Object.entries(config.dictionaries)) {
      const hasKeys = dict.keys !== undefined;
      const hasInclude = dict.include !== undefined;

      if (hasKeys && !Array.isArray(dict.keys)) {
        throw new Error(`vite-bundled-i18n: dictionary "${name}" must have a keys array`);
      }
      if (hasInclude && !Array.isArray(dict.include)) {
        throw new Error(`vite-bundled-i18n: dictionary "${name}" must have an include array`);
      }
      if (hasKeys && (dict.keys?.length ?? 0) === 0 && !hasInclude) {
        throw new Error(`vite-bundled-i18n: dictionary "${name}" has an empty keys array`);
      }
      if (hasKeys) {
        for (const key of dict.keys ?? []) {
          if (!key || typeof key !== 'string') {
            throw new Error(`vite-bundled-i18n: dictionary "${name}" contains an invalid key: ${JSON.stringify(key)}`);
          }
        }
      }
      if (hasInclude) {
        for (const pattern of dict.include ?? []) {
          if (!pattern || typeof pattern !== 'string') {
            throw new Error(`vite-bundled-i18n: dictionary "${name}" contains an invalid key pattern: ${JSON.stringify(pattern)}`);
          }
        }
      }

      const patterns = getDictionaryPatterns(dict);
      if (patterns.length === 0) {
        throw new Error(`vite-bundled-i18n: dictionary "${name}" must define keys or include patterns`);
      }

      if (dict.priority !== undefined && typeof dict.priority !== 'number') {
        throw new Error(`vite-bundled-i18n: dictionary "${name}" priority must be a number`);
      }

      for (const key of patterns) {
        if (!isValidPattern(key)) {
          throw new Error(`vite-bundled-i18n: dictionary "${name}" contains an invalid key pattern: ${JSON.stringify(key)}`);
        }
      }
    }

    // Warn about duplicate patterns across dictionaries
    const seen = new Map<string, string>(); // pattern → first dictionary name
    for (const [name, dict] of Object.entries(config.dictionaries)) {
      for (const pattern of getDictionaryPatterns(dict)) {
        const existing = seen.get(pattern);
        if (existing) {
          console.warn(
            `vite-bundled-i18n: pattern "${pattern}" appears in both dictionary "${existing}" and "${name}". This is allowed but may cause unexpected loading order.`,
          );
        } else {
          seen.set(pattern, name);
        }
      }
    }
  }
}
