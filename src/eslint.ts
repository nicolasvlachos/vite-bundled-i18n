/**
 * ESLint plugin entry point for vite-bundled-i18n.
 *
 * Subpath export so consumers can do:
 *   import i18n from 'vite-bundled-i18n/eslint';
 *   export default [i18n.flatConfigs.recommended];
 *
 * The actual rule modules + plugin shape live under `src/eslint/`. This
 * file is the public re-export — keeps the import path stable even as the
 * internal layout evolves.
 */
export { default } from './eslint/index';
export { rules, flatConfigs, configs } from './eslint/index';
