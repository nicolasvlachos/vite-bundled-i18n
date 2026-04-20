import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import type { I18nSharedConfig } from '../core/config';
import { writeTypes } from '../extractor/type-generator';
import { generateReports } from '../extractor/reports';
import { generateBundles } from '../extractor/bundle-generator';
import { compileAll } from '../extractor/compiler';
import { walkAll } from '../extractor/walker';

export interface I18nBuildPluginConfig {
  /** Glob patterns for route/page entry points. */
  pages: string[];
  /** All supported locale codes. */
  locales: string[];
  /** Default locale used for fallback resolution. */
  defaultLocale: string;
  /** Where to write internal artifacts like reports and compiled modules. */
  generatedOutDir?: string;
  /** Where to write generated type declarations. */
  typesOutPath?: string;
  /** Extraction scope for the walker. */
  extractionScope?: 'global' | 'scoped';
  /** Public asset directory emitted into the Vite build output. */
  assetsDir?: string;
  /** Disable writing generated types during `vite build`. */
  emitTypes?: boolean;
  /** Disable writing reports during `vite build`. */
  emitReports?: boolean;
  /** Disable writing compiled modules during `vite build`. */
  emitCompiled?: boolean;
}

export interface EmitI18nBuildArtifactsOptions {
  rootDir: string;
  viteOutDir: string;
  sharedConfig: I18nSharedConfig;
  buildConfig: I18nBuildPluginConfig;
}

export interface EmitI18nBuildArtifactsResult {
  assetBundles: number;
  assetsOutDir: string;
  generatedOutDir: string;
  compiledOutDir?: string;
  typesOutPath?: string;
}

function resolveBuildPaths(options: EmitI18nBuildArtifactsOptions) {
  const { rootDir, viteOutDir, sharedConfig, buildConfig } = options;

  const localesDir = path.isAbsolute(sharedConfig.localesDir)
    ? sharedConfig.localesDir
    : path.join(rootDir, sharedConfig.localesDir);
  const generatedOutDir = buildConfig.generatedOutDir
    ? path.resolve(rootDir, buildConfig.generatedOutDir)
    : path.join(rootDir, '.i18n');
  const typesOutPath = buildConfig.typesOutPath
    ? path.resolve(rootDir, buildConfig.typesOutPath)
    : path.join(rootDir, 'src', 'i18n-types.d.ts');
  const assetsOutDir = path.join(viteOutDir, buildConfig.assetsDir ?? '__i18n');
  const extractionScope = buildConfig.extractionScope ?? 'global';

  return {
    localesDir,
    generatedOutDir,
    typesOutPath,
    assetsOutDir,
    extractionScope,
  };
}

function joinPublicPath(base: string, relativePath: string): string {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const normalizedRelative = relativePath.replace(/^\/+/, '');
  return `${normalizedBase}${normalizedRelative}`;
}

export function emitI18nBuildArtifacts(
  options: EmitI18nBuildArtifactsOptions,
): EmitI18nBuildArtifactsResult {
  const { rootDir, sharedConfig, buildConfig } = options;
  const {
    localesDir,
    generatedOutDir,
    typesOutPath,
    assetsOutDir,
    extractionScope,
  } = resolveBuildPaths(options);

  const analysis = walkAll({
    pages: buildConfig.pages,
    rootDir,
    localesDir,
    defaultLocale: buildConfig.defaultLocale,
    extractionScope,
  });

  const bundles = generateBundles(analysis, {
    localesDir,
    locales: buildConfig.locales,
    outDir: assetsOutDir,
    dictionaries: sharedConfig.dictionaries,
  });

  if (buildConfig.emitTypes !== false) {
    writeTypes(localesDir, buildConfig.defaultLocale, typesOutPath);
  }

  let compiledOutDir: string | undefined;
  if (buildConfig.emitCompiled !== false) {
    compiledOutDir = path.join(assetsOutDir, 'compiled');
    compileAll(analysis, {
      localesDir,
      locales: buildConfig.locales,
      defaultLocale: buildConfig.defaultLocale,
      outDir: compiledOutDir,
      dictionaries: sharedConfig.dictionaries,
    });
  }

  if (buildConfig.emitReports !== false) {
    generateReports(
      analysis,
      localesDir,
      buildConfig.defaultLocale,
      generatedOutDir,
      sharedConfig.dictionaries,
    );
  }

  return {
    assetBundles: bundles.length,
    assetsOutDir,
    generatedOutDir,
    compiledOutDir,
    typesOutPath: buildConfig.emitTypes === false ? undefined : typesOutPath,
  };
}

export function i18nBuildPlugin(
  sharedConfig: I18nSharedConfig,
  buildConfig: I18nBuildPluginConfig,
): Plugin {
  let resolvedConfig: ResolvedConfig | undefined;
  const assetsDir = buildConfig.assetsDir ?? '__i18n';

  return {
    name: 'vite-bundled-i18n-build',
    apply: 'build',
    config(config) {
      const base = config.base ?? '/';
      const manifestUrl = joinPublicPath(base, `${assetsDir}/compiled/manifest.js`);
      return {
        define: {
          __VITE_I18N_COMPILED_MANIFEST__: JSON.stringify(manifestUrl),
        },
      };
    },
    configResolved(config) {
      resolvedConfig = config;
    },
    closeBundle() {
      if (!resolvedConfig) return;

      const result = emitI18nBuildArtifacts({
        rootDir: resolvedConfig.root,
        viteOutDir: path.resolve(resolvedConfig.root, resolvedConfig.build.outDir),
        sharedConfig,
        buildConfig,
      });

      resolvedConfig.logger.info(
        `vite-bundled-i18n: emitted ${result.assetBundles} i18n asset bundle(s) to ${path.relative(resolvedConfig.root, result.assetsOutDir)}`,
      );
      if (result.compiledOutDir) {
        resolvedConfig.logger.info(
          `vite-bundled-i18n: compiled runtime modules written to ${path.relative(resolvedConfig.root, result.compiledOutDir)}`,
        );
      }
      if (result.typesOutPath) {
        resolvedConfig.logger.info(
          `vite-bundled-i18n: types written to ${path.relative(resolvedConfig.root, result.typesOutPath)}`,
        );
      }
    },
  };
}
