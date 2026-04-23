/**
 * Vite plugin entry point for vite-bundled-i18n.
 *
 * `i18nPlugin()` unifies:
 * - dev-time bundle serving via `/__i18n/...`
 * - build-time generation of static `/__i18n/...` assets, reports, types, and compiled modules
 */
import type { PluginOption } from 'vite';
import type { I18nSharedConfig } from './core/config';
import { i18nDevPlugin } from './plugin/devPlugin';
import {
  emitI18nBuildArtifacts,
  i18nBuildPlugin,
} from './plugin/buildPlugin';
import type {
  I18nBuildPluginConfig,
} from './plugin/buildPlugin';

export type {
  I18nDevPluginConfig,
} from './plugin/devPlugin';
export type {
  EmitI18nBuildArtifactsOptions,
  EmitI18nBuildArtifactsResult,
  I18nBuildPluginConfig,
} from './plugin/buildPlugin';

export {
  emitI18nBuildArtifacts,
  i18nBuildPlugin,
  i18nDevPlugin,
};

/**
 * Unified options for the i18n Vite plugin.
 *
 * Extends `I18nBuildPluginConfig` so all build-related fields (pages, locales,
 * assetsDir, etc.) live at the top level. Dev-only knobs live under the
 * optional `dev` block.
 */
export interface I18nPluginOptions extends I18nBuildPluginConfig {
  /** Dev-specific options. Only applied when running `vite dev`. */
  dev?: {
    /** Emit static JSON to public/__i18n/. For sidecar setups. Default: false. */
    emitPublicAssets?: boolean;
    /** Show devtools toggle button and drawer. Default: true in dev. */
    devBar?: boolean;
  };
}

export function i18nPlugin(
  sharedConfig: I18nSharedConfig,
  options?: I18nPluginOptions,
): PluginOption[] {
  const plugins: PluginOption[] = [
    i18nDevPlugin(sharedConfig, {
      assetsDir: options?.assetsDir,
      pages: options?.pages,
      defaultLocale: options?.defaultLocale,
      extractionScope: options?.extractionScope,
      typesOutPath: options?.typesOutPath,
      emitPublicAssets: options?.dev?.emitPublicAssets,
      devBar: options?.dev?.devBar,
    }),
  ];

  if (options) {
    plugins.push(i18nBuildPlugin(sharedConfig, options));
  }

  return plugins;
}
