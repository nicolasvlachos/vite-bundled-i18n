import path from 'node:path';

/**
 * User-facing cache options on `i18nPlugin` / `i18nDevPlugin`.
 *
 * - `true` (or `undefined`) — cache on with defaults
 * - `false` — cache off
 * - object — fine-grained control
 */
export type CacheOptionInput = boolean | CacheOptions | undefined;

export interface CacheOptions {
  /** Master on/off switch. Default: true. */
  enabled?: boolean;
  /**
   * Cache directory, absolute or relative to the project root.
   * Default: `.i18n/cache`.
   */
  dir?: string;
  /**
   * Whether to write the in-memory cache back to disk. Default: true.
   * Set to false for ephemeral environments where on-disk persistence
   * would be wasted work.
   */
  persist?: boolean;
}

/**
 * Resolved cache settings after applying config, env vars, and sensible
 * defaults. Consumers (walker, dev plugin, build plugin, CLI) read this
 * shape — they don't look at the raw inputs.
 */
export interface ResolvedCacheConfig {
  enabled: boolean;
  dir: string;
  persist: boolean;
  clearBeforeStart: boolean;
  debug: boolean;
}

export interface ResolveCacheConfigContext {
  rootDir: string;
  /**
   * Environment variables. Defaults to `process.env`. Accepting an explicit
   * env makes the function trivially testable — no `vi.stubEnv` dance.
   */
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_DIR = path.join('.i18n', 'cache');

/**
 * Compute effective cache settings.
 *
 * Precedence, highest wins:
 * 1. Env vars (operator override — always win over code)
 * 2. Explicit plugin config
 * 3. Environment defaults (`NODE_ENV=test` disables)
 * 4. Built-in defaults
 *
 * Env vars that matter:
 * - `VITE_I18N_NO_CACHE=1` — force disable
 * - `VITE_I18N_CLEAR_CACHE=1` — keep enabled, wipe dir before start
 * - `VITE_I18N_CACHE_DEBUG=1` — stream cache events to stderr
 */
export function resolveCacheConfig(
  input: CacheOptionInput,
  context: ResolveCacheConfigContext,
): ResolvedCacheConfig {
  const env = context.env ?? process.env;
  const envFlag = (name: string) => {
    const value = env[name];
    return value !== undefined && value !== '' && value !== '0' && value !== 'false';
  };

  const explicit: CacheOptions =
    input === undefined
      ? {}
      : typeof input === 'boolean'
        ? { enabled: input }
        : input;

  // Decide enablement.
  let enabled: boolean;
  if (envFlag('VITE_I18N_NO_CACHE')) {
    enabled = false;
  } else if (explicit.enabled !== undefined) {
    enabled = explicit.enabled;
  } else if (env.NODE_ENV === 'test') {
    enabled = false;
  } else {
    enabled = true;
  }

  // Resolve directory — absolute passes through, relative joins from rootDir.
  const rawDir = explicit.dir ?? DEFAULT_DIR;
  const dir = path.isAbsolute(rawDir) ? rawDir : path.join(context.rootDir, rawDir);

  const persist = explicit.persist ?? true;
  const clearBeforeStart = envFlag('VITE_I18N_CLEAR_CACHE');
  const debug = envFlag('VITE_I18N_CACHE_DEBUG');

  return { enabled, dir, persist, clearBeforeStart, debug };
}
