export const I18N_DEV_UPDATE_EVENT = 'vite-bundled-i18n:resources-updated';

export interface I18nDevUpdatePayload {
  locales?: string[];
  reason: 'locale' | 'routes';
  changedFile?: string;
  generatedAt: string;
}

interface RuntimeGlobal {
  __VITE_I18N_DEV__?: boolean;
}

interface HmrClient {
  on?: (event: string, callback: (payload: I18nDevUpdatePayload) => void) => void;
}

/**
 * Reads the compile-time or runtime dev flag.
 *
 * Checks the Vite-injected `__VITE_I18N_DEV__` define first, then falls
 * back to `globalThis.__VITE_I18N_DEV__`. Returns `undefined` when neither
 * source provides a boolean value.
 *
 * @returns `true` or `false` when the flag is explicitly set, or `undefined`
 *   when no flag is defined.
 */
export function getDefinedDevFlag(): boolean | undefined {
  if (typeof __VITE_I18N_DEV__ !== 'undefined') {
    return __VITE_I18N_DEV__;
  }

  const globalFlag = (globalThis as typeof globalThis & RuntimeGlobal).__VITE_I18N_DEV__;
  return typeof globalFlag === 'boolean' ? globalFlag : undefined;
}

/**
 * Returns the Vite HMR client if available in the current environment.
 *
 * Accesses `import.meta.hot`, which is only present when running inside
 * Vite's dev server. Returns `undefined` in production builds, SSR, or
 * non-Vite environments.
 *
 * @returns The HMR client object, or `undefined` when HMR is not available.
 */
export function getHmrClient(): HmrClient | undefined {
  return typeof import.meta !== 'undefined'
    ? (import.meta as ImportMeta & { hot?: HmrClient }).hot
    : undefined;
}

/**
 * Determines whether the application is running in a development context.
 *
 * Returns `true` when any of the following conditions hold:
 * 1. The `__VITE_I18N_DEV__` flag is explicitly `true`.
 * 2. `process.env.NODE_ENV` equals `'test'` (test environments).
 * 3. A Vite HMR client (`import.meta.hot`) is detected.
 *
 * Returns `false` when the dev flag is explicitly `false` or none of the
 * above conditions are met.
 *
 * @returns `true` if running in a development or test environment.
 */
export function isDevRuntime(): boolean {
  const definedFlag = getDefinedDevFlag();
  if (typeof definedFlag === 'boolean') {
    return definedFlag;
  }

  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
    return true;
  }

  return Boolean(getHmrClient());
}
