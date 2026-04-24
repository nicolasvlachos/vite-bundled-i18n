/**
 * Plugin version string — injected at build time via Vite's `define`. Falls
 * back to a development placeholder during tests and direct imports before
 * the build step runs.
 */
export const PLUGIN_VERSION: string =
  typeof __VITE_BUNDLED_I18N_VERSION__ !== 'undefined'
    ? __VITE_BUNDLED_I18N_VERSION__
    : 'dev';
