/**
 * Runtime shim for the `vite-bundled-i18n/generated` package export.
 *
 * This is a package-shipped placeholder with empty exports. It guarantees
 * that `import { PAGE_SCOPE_MAP } from 'vite-bundled-i18n/generated'` always
 * resolves at module-resolution time, even before the i18nPlugin has run
 * for the first time.
 *
 * Real values come from `.i18n/i18n-generated.js` in the consumer project,
 * written by the plugin's `buildStart` hook. The plugin also programmatically
 * registers a Vite `resolve.alias` so that both dev and build resolve
 * `vite-bundled-i18n/generated` directly to that file, bypassing this shim.
 *
 * Non-Vite consumers (raw Node scripts, tests that don't go through Vite)
 * fall through to these empty defaults.
 */

/** @type {Readonly<Record<string, readonly string[]>>} */
export const PAGE_SCOPE_MAP = Object.freeze({});
