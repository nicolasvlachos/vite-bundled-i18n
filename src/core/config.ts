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
