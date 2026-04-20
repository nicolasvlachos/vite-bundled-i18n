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

export function i18nPlugin(
  sharedConfig: I18nSharedConfig,
  buildConfig?: I18nBuildPluginConfig,
): PluginOption[] {
  const plugins: PluginOption[] = [
    i18nDevPlugin(sharedConfig, {
      assetsDir: buildConfig?.assetsDir,
      defaultLocale: buildConfig?.defaultLocale,
      typesOutPath: buildConfig?.typesOutPath,
    }),
  ];

  if (buildConfig) {
    plugins.push(i18nBuildPlugin(sharedConfig, buildConfig));
  }

  return plugins;
}
