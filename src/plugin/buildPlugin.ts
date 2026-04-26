import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import type { I18nSharedConfig } from '../core/config';
import { writeTypes, writeRuntimeConst, runtimePathFromTypesPath } from '../extractor/type-generator';
import { generateReports } from '../extractor/reports';
import { generateBundles } from '../extractor/bundle-generator';
import { compileAll } from '../extractor/compiler';
import { walkAll } from '../extractor/walker';
import type { ProjectAnalysis } from '../extractor/walker-types';
import {
  createExtractionCache,
  computeConfigHash,
  CACHE_FILE_NAME,
  type ExtractionCache,
} from '../extractor/extraction-cache';
import { resolveCacheConfig, type CacheOptionInput } from '../extractor/cache-config';
import { PLUGIN_VERSION } from './version';
import { buildScopeMap, type PageIdentifierFn } from '../extractor/scope-map';
import { applyDynamicKeys } from '../extractor/dynamic-keys';
import {
  runStrictExtraction,
  writeStrictExtractionReport,
  assertNoStrictExtractionErrors,
} from '../extractor/strict-extraction';
import {
  computeAnalysisFingerprint,
  detectStaleness,
  writeBuildStamp,
  BUILD_STAMP_SCHEMA_VERSION,
} from '../extractor/build-stamp';

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
  /**
   * Extraction cache control. Accepts `true` / `false` / options object.
   * See {@link CacheOptionInput}. Env vars take precedence.
   */
  cache?: CacheOptionInput;
  /**
   * Maps an absolute page file path to a stable string identifier used as
   * the key in the emitted `scope-map.json`. Consumers supply a function
   * that produces whatever token their router exposes at runtime for the
   * matched page.
   *
   * When omitted, {@link defaultPageIdentifier} is used — strips
   * `src/pages/` and common `.tsx` / `.page.tsx` suffixes, normalizes to
   * POSIX separators.
   */
  pageIdentifier?: PageIdentifierFn;
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
  warnings: string[];
}

export function resolveBuildPaths(options: EmitI18nBuildArtifactsOptions): ResolvedBuildPaths {
  const { rootDir, viteOutDir, sharedConfig, buildConfig } = options;

  const localesDir = path.isAbsolute(sharedConfig.localesDir)
    ? sharedConfig.localesDir
    : path.join(rootDir, sharedConfig.localesDir);
  const generatedOutDir = buildConfig.generatedOutDir
    ? path.resolve(rootDir, buildConfig.generatedOutDir)
    : path.join(rootDir, '.i18n');
  const typesOutPath = buildConfig.typesOutPath
    ? path.resolve(rootDir, buildConfig.typesOutPath)
    : path.join(generatedOutDir, 'i18n-generated.ts');
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

// ---------------------------------------------------------------------------
// Shared helpers — the single code path that CLI commands and the build
// plugin both call into. Splitting the emit into (analyze → types → bundles)
// lets the build plugin run typegen in buildStart (so downstream code that
// imports `.i18n/i18n-generated.ts` resolves during the same build) and
// bundles in closeBundle (so the Vite output directory is stable by then).
// ---------------------------------------------------------------------------

/** Paths derived from buildConfig — used by every emit helper. */
export interface ResolvedBuildPaths {
  localesDir: string;
  generatedOutDir: string;
  typesOutPath: string;
  assetsOutDir: string;
  extractionScope: 'global' | 'scoped';
}

/**
 * Walk the project and return the full analysis. Creates + persists the
 * extraction cache when enabled. Pure — no emitted artifacts.
 */
export function runProjectAnalysis(
  options: EmitI18nBuildArtifactsOptions,
  resolved: ResolvedBuildPaths,
  logger: { warn: (msg: string) => void } = console,
): ProjectAnalysis {
  const { rootDir, sharedConfig, buildConfig } = options;
  const { localesDir, extractionScope } = resolved;

  const cacheSettings = resolveCacheConfig(buildConfig.cache, { rootDir });
  const configHash = computeConfigHash({
    pages: buildConfig.pages,
    defaultLocale: buildConfig.defaultLocale,
    extractionScope,
    hookSources: sharedConfig.extraction?.hookSources,
    keyFields: sharedConfig.extraction?.keyFields,
    dictionaries: sharedConfig.dictionaries,
    crossNamespacePacking: sharedConfig.bundling?.crossNamespacePacking,
  });

  // Staleness check: a build-stamp from a prior successful build, compared
  // against the current extraction cache mtime + plugin version + config
  // hash. Surfaces a single warning so the operator knows to run a clean
  // rebuild instead of silently shipping stale prod bundles.
  // Runs before we touch the cache so we observe the on-disk truth from
  // the previous build.
  const stalenessReport = detectStaleness({
    generatedOutDir: resolved.generatedOutDir,
    cacheFilePath: path.join(cacheSettings.dir, CACHE_FILE_NAME),
    pluginVersion: PLUGIN_VERSION,
    configHash,
  });
  if (stalenessReport) {
    logger.warn(stalenessReport.message);
  }

  let extractionCache: ExtractionCache | undefined;
  if (cacheSettings.enabled) {
    if (cacheSettings.clearBeforeStart) {
      try { fs.rmSync(cacheSettings.dir, { recursive: true, force: true }); } catch { /* non-fatal */ }
    }
    extractionCache = createExtractionCache({
      dir: cacheSettings.dir,
      pluginVersion: PLUGIN_VERSION,
      configHash,
      debug: cacheSettings.debug,
    });
  }

  const analysis = walkAll({
    pages: buildConfig.pages,
    rootDir,
    localesDir,
    defaultLocale: buildConfig.defaultLocale,
    extractionScope,
    hookSources: sharedConfig.extraction?.hookSources,
    keyFields: sharedConfig.extraction?.keyFields,
    cache: extractionCache,
  });

  if (extractionCache && cacheSettings.persist) {
    extractionCache.persistToDisk();
  }

  // Post-walk audits + mutations. Centralized here so every caller
  // (`emitI18nBuildArtifacts` wrapper, `buildStart` hook, `closeBundle`
  // fallback) gets identical behavior — no drift between the public
  // wrapper and the plugin's hooks.
  applyPostWalkAudits(analysis, options, logger);

  return analysis;
}

/**
 * Run dynamic-key injection + scope-registration audit against a fresh
 * analysis. Separated from {@link runProjectAnalysis} only so the dev
 * plugin — which bypasses `runProjectAnalysis` for its lazy walks —
 * can call it after its own `walkAll`.
 *
 * Uses `console.warn` by default; build-plugin hooks override via the
 * optional `logger` parameter to route through Vite's logger.
 */
export function applyPostWalkAudits(
  analysis: ProjectAnalysis,
  options: EmitI18nBuildArtifactsOptions,
  logger: { warn: (msg: string) => void } = console,
): void {
  const { sharedConfig } = options;

  // Dynamic-key INJECTION (mutation, not audit) — keeps running first so
  // the strict-extraction's orphan-dynamic check sees the post-injection
  // route shape. The audit-style orphan reporting now lives inside
  // `runStrictExtraction` so it's part of the unified report.
  if (sharedConfig.bundling?.dynamicKeys && sharedConfig.bundling.dynamicKeys.length > 0) {
    applyDynamicKeys(analysis, {
      dynamicKeys: sharedConfig.bundling.dynamicKeys,
      dictionaries: sharedConfig.dictionaries,
      crossNamespacePacking: sharedConfig.bundling.crossNamespacePacking,
    });
  }

  // Resolve paths needed by strictExtraction's defaults — done inline
  // because applyPostWalkAudits is called from multiple sites and we
  // can't depend on `resolved` being threaded in (the dev-plugin path
  // calls it without one).
  const generatedOutDir = options.buildConfig.generatedOutDir
    ? path.resolve(options.rootDir, options.buildConfig.generatedOutDir)
    : path.join(options.rootDir, '.i18n');
  const localesDir = path.isAbsolute(sharedConfig.localesDir)
    ? sharedConfig.localesDir
    : path.join(options.rootDir, sharedConfig.localesDir);
  const defaultReportPath = path.join(generatedOutDir, 'strict-extraction-report.json');

  // Run the unified strictExtraction audit (replaces the standalone
  // strictScopeRegistration call). Backward compat: when only the
  // legacy `strictScopeRegistration` field is set, it's threaded into
  // `runStrictExtraction` as the scopeRegistration mode default.
  const strictReport = runStrictExtraction({
    analysis,
    rootDir: options.rootDir,
    localesDir,
    defaultLocale: options.buildConfig.defaultLocale,
    dictionaries: sharedConfig.dictionaries,
    dynamicKeys: sharedConfig.bundling?.dynamicKeys,
    config: sharedConfig.bundling?.strictExtraction,
    legacyStrictScopeRegistration: sharedConfig.bundling?.strictScopeRegistration,
    defaultReportPath,
  });

  // Always persist the structured report — observability primitive,
  // independent of severity. CI tooling can parse it without scraping.
  writeStrictExtractionReport(defaultReportPath, strictReport);

  // Surface every warn-level finding through the logger; let the assert
  // helper raise on errors (so the build aborts cleanly with all the
  // error messages bundled into one Error).
  for (const finding of strictReport.findings) {
    if (finding.severity === 'warn') {
      logger.warn(`[vite-bundled-i18n strictExtraction/${finding.check}] ${finding.message}`);
    }
  }

  assertNoStrictExtractionErrors(strictReport);
}

/**
 * Write generated types + runtime-const artifacts. Side-effect only.
 *
 * Emits:
 * - `<typesOutPath>` — `.ts` file with typed `I18nNestedKeys`, `I18nScopeMap`,
 *   `I18nPageIdentifier`, and the `PAGE_SCOPE_MAP` const. Consumed by TSC/IDE.
 * - `<typesOutPath sibling>.js` — runtime `.js` with the same `PAGE_SCOPE_MAP`
 *   as an `Object.freeze`'d const. The plugin's `resolve.alias` points
 *   `vite-bundled-i18n/generated` at this file.
 *
 * Respects `buildConfig.emitTypes: false` — skips both files when disabled.
 */
export function emitGeneratedArtifacts(
  analysis: ProjectAnalysis,
  options: EmitI18nBuildArtifactsOptions,
  resolved: ResolvedBuildPaths,
): void {
  if (options.buildConfig.emitTypes === false) return;

  const { rootDir, sharedConfig, buildConfig } = options;
  const { localesDir, typesOutPath } = resolved;

  const scopeNames = [...new Set(analysis.routes.flatMap((route) => route.scopes))].sort();
  const scopeMapForTypes = buildScopeMap(analysis, {
    rootDir,
    defaultLocale: buildConfig.defaultLocale,
    dictionaries: sharedConfig.dictionaries,
    pageIdentifier: buildConfig.pageIdentifier,
  });
  const pageScopeMap: Record<string, readonly string[]> = {};
  for (const [id, entry] of Object.entries(scopeMapForTypes.pages)) {
    pageScopeMap[id] = entry.scopes;
  }

  writeTypes(localesDir, buildConfig.defaultLocale, typesOutPath, scopeNames, pageScopeMap);
  writeRuntimeConst(runtimePathFromTypesPath(typesOutPath), pageScopeMap);
}

/**
 * Write bundle + compiled + report artifacts. Side-effect only.
 *
 * Respects the `emitReports` and `emitCompiled` flags. Returns the bundles
 * and diagnostic warnings so the wrapper can report them.
 */
export function emitBundlesArtifacts(
  analysis: ProjectAnalysis,
  options: EmitI18nBuildArtifactsOptions,
  resolved: ResolvedBuildPaths,
): { bundleCount: number; compiledOutDir?: string; warnings: string[] } {
  const { rootDir, sharedConfig, buildConfig } = options;
  const { localesDir, generatedOutDir, assetsOutDir } = resolved;

  const bundles = generateBundles(analysis, {
    localesDir,
    locales: buildConfig.locales,
    outDir: assetsOutDir,
    dictionaries: sharedConfig.dictionaries,
    crossNamespacePacking: sharedConfig.bundling?.crossNamespacePacking,
  });

  let compiledOutDir: string | undefined;
  if (buildConfig.emitCompiled !== false) {
    compiledOutDir = path.join(assetsOutDir, 'compiled');
    compileAll(analysis, {
      localesDir,
      locales: buildConfig.locales,
      defaultLocale: buildConfig.defaultLocale,
      outDir: compiledOutDir,
      dictionaries: sharedConfig.dictionaries,
      crossNamespacePacking: sharedConfig.bundling?.crossNamespacePacking,
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

    // scope-map.json — framework-agnostic index of "page id → scopes + dicts".
    const scopeMap = buildScopeMap(analysis, {
      rootDir,
      defaultLocale: buildConfig.defaultLocale,
      dictionaries: sharedConfig.dictionaries,
      pageIdentifier: buildConfig.pageIdentifier,
    });
    fs.mkdirSync(assetsOutDir, { recursive: true });
    fs.writeFileSync(
      path.join(assetsOutDir, 'scope-map.json'),
      JSON.stringify(scopeMap, null, 2),
    );
  }

  const warnings: string[] = [];
  const totalExtractedKeys = analysis.allKeys.filter(k => !k.dynamic).length;
  const totalBundledKeys = bundles.reduce((sum, b) => sum + b.keyCount, 0);
  if (totalExtractedKeys > 0 && totalBundledKeys === 0) {
    const localeCheckDir = path.join(localesDir, buildConfig.defaultLocale);
    let foundFiles: string[] = [];
    try { foundFiles = fs.readdirSync(localeCheckDir).filter(f => f.endsWith('.json')); } catch { /* noop */ }
    const hint = foundFiles.length === 0
      ? `No JSON files found in ${localeCheckDir}`
      : `Found ${foundFiles.length} file(s) but 0 keys matched`;
    warnings.push(
      `vite-bundled-i18n: 0 of ${totalExtractedKeys} extracted keys found in translation files.\n` +
      `  Expected structure: ${localesDir}/{locale}/{namespace}.json\n` +
      `  ${hint}\n` +
      `  Hint: Subdirectories are not supported. Each namespace must be a single flat JSON file.`
    );
  }

  // Build-stamp: records the cache mtime AT this moment so the next run's
  // `detectStaleness` knows the truthful "last cache state observed by a
  // successful build." Comparing against the stamp's own mtime would
  // falsely flag any build that took longer than `gracePeriodMs`. Failure
  // is swallowed inside writeBuildStamp — the stamp is observability,
  // never correctness.
  const stampConfigHash = computeConfigHash({
    pages: buildConfig.pages,
    defaultLocale: buildConfig.defaultLocale,
    extractionScope: resolved.extractionScope,
    hookSources: sharedConfig.extraction?.hookSources,
    keyFields: sharedConfig.extraction?.keyFields,
    dictionaries: sharedConfig.dictionaries,
    crossNamespacePacking: sharedConfig.bundling?.crossNamespacePacking,
  });
  const cacheSettingsForStamp = resolveCacheConfig(buildConfig.cache, { rootDir });
  let cacheMtimeAtStampWrite: number | null = null;
  try {
    cacheMtimeAtStampWrite = fs.statSync(path.join(cacheSettingsForStamp.dir, CACHE_FILE_NAME)).mtimeMs;
  } catch { /* cache disabled or not yet written */ }
  writeBuildStamp(generatedOutDir, {
    schemaVersion: BUILD_STAMP_SCHEMA_VERSION,
    pluginVersion: PLUGIN_VERSION,
    configHash: stampConfigHash,
    analysisFingerprint: computeAnalysisFingerprint(analysis),
    routeCount: analysis.routes.length,
    keyCount: analysis.allKeys.length,
    cacheMtimeAtStampWrite,
    writtenAt: new Date().toISOString(),
  });

  return {
    bundleCount: bundles.length,
    compiledOutDir,
    warnings,
  };
}

/**
 * Single-shot entry point — analyzes the project and emits every artifact
 * in one pass. Used by the CLI `build` command and by tests. The Vite build
 * plugin splits the work across `buildStart` (analyze + types) and
 * `closeBundle` (bundles) using the three helpers above directly.
 */
export function emitI18nBuildArtifacts(
  options: EmitI18nBuildArtifactsOptions,
): EmitI18nBuildArtifactsResult {
  const resolved = resolveBuildPaths(options);
  const analysis = runProjectAnalysis(options, resolved);
  emitGeneratedArtifacts(analysis, options, resolved);
  const bundlesResult = emitBundlesArtifacts(analysis, options, resolved);

  return {
    assetBundles: bundlesResult.bundleCount,
    assetsOutDir: resolved.assetsOutDir,
    generatedOutDir: resolved.generatedOutDir,
    compiledOutDir: bundlesResult.compiledOutDir,
    typesOutPath: options.buildConfig.emitTypes === false ? undefined : resolved.typesOutPath,
    warnings: bundlesResult.warnings,
  };
}

export function i18nBuildPlugin(
  sharedConfig: I18nSharedConfig,
  buildConfig: I18nBuildPluginConfig,
): Plugin {
  let resolvedConfig: ResolvedConfig | undefined;
  let buildStartAnalysis: ProjectAnalysis | undefined;
  const assetsDir = buildConfig.assetsDir ?? '__i18n';

  return {
    name: 'vite-bundled-i18n-build',
    apply: 'build',
    // enforce: 'post' ensures config() runs AFTER other plugins (e.g. Laravel's
    // Vite plugin) that set `base` in their own config() hooks.
    enforce: 'post',
    config(config) {
      const base = config.base ?? '/';
      const i18nBase = joinPublicPath(base, assetsDir).replace(/\/$/, '');
      const manifestUrl = joinPublicPath(base, `${assetsDir}/compiled/manifest.js`);

      // Make the runtime `.i18n/i18n-generated.js` resolvable via a bare
      // `vite-bundled-i18n/generated` import. Writing a placeholder file
      // here — before Vite builds its module graph — guarantees the alias
      // target exists even before `buildStart` runs; the real content is
      // rewritten in buildStart below.
      const projectRoot = config.root ?? process.cwd();
      const generatedDir = buildConfig.generatedOutDir
        ? path.resolve(projectRoot, buildConfig.generatedOutDir)
        : path.join(projectRoot, '.i18n');
      const runtimePath = runtimePathFromTypesPath(
        buildConfig.typesOutPath
          ? path.resolve(projectRoot, buildConfig.typesOutPath)
          : path.join(generatedDir, 'i18n-generated.ts'),
      );
      if (!fs.existsSync(runtimePath)) {
        try { writeRuntimeConst(runtimePath, undefined); } catch { /* non-fatal */ }
      }

      return {
        define: {
          __VITE_I18N_DEV__: JSON.stringify(false),
          __VITE_I18N_DEVBAR__: JSON.stringify(false),
          __VITE_I18N_COMPILED_MANIFEST__: JSON.stringify(manifestUrl),
          __VITE_I18N_BASE__: JSON.stringify(i18nBase),
        },
        resolve: {
          alias: {
            'vite-bundled-i18n/generated': runtimePath,
          },
        },
      };
    },
    configResolved(config) {
      resolvedConfig = config;
    },
    buildStart() {
      if (!resolvedConfig) return;

      // Typegen runs here (not in closeBundle) so any module in the graph
      // that imports `.i18n/i18n-generated.ts` or `vite-bundled-i18n/generated`
      // sees the real `PAGE_SCOPE_MAP` and keyspace types before
      // transformation. Warm-cache hits keep this cheap (~20 ms).
      const options: EmitI18nBuildArtifactsOptions = {
        rootDir: resolvedConfig.root,
        viteOutDir: path.resolve(resolvedConfig.root, resolvedConfig.build.outDir),
        sharedConfig,
        buildConfig,
      };
      const resolved = resolveBuildPaths(options);
      // runProjectAnalysis walks the project AND applies post-walk audits
      // (dynamic-keys injection + strictScopeRegistration). The audit routes
      // through Vite's logger here — keeps warnings in the build output.
      buildStartAnalysis = runProjectAnalysis(options, resolved, resolvedConfig.logger);
      emitGeneratedArtifacts(buildStartAnalysis, options, resolved);

      if (buildStartAnalysis && resolvedConfig) {
        resolvedConfig.logger.info(
          `vite-bundled-i18n: analyzed ${buildStartAnalysis.routes.length} route(s), types written`,
        );
      }
    },
    closeBundle() {
      if (!resolvedConfig) return;

      const options: EmitI18nBuildArtifactsOptions = {
        rootDir: resolvedConfig.root,
        viteOutDir: path.resolve(resolvedConfig.root, resolvedConfig.build.outDir),
        sharedConfig,
        buildConfig,
      };
      const resolved = resolveBuildPaths(options);

      // Reuse the analysis from buildStart when available. Falls back to a
      // fresh walk if buildStart didn't fire (e.g. a prod-only helper
      // invoking closeBundle directly in tests).
      const analysis = buildStartAnalysis ?? runProjectAnalysis(options, resolved);
      const result = emitBundlesArtifacts(analysis, options, resolved);

      for (const warning of result.warnings) {
        resolvedConfig.logger.warn(warning);
      }

      resolvedConfig.logger.info(
        `vite-bundled-i18n: emitted ${result.bundleCount} i18n asset bundle(s) to ${path.relative(resolvedConfig.root, resolved.assetsOutDir)}`,
      );
      if (result.compiledOutDir) {
        resolvedConfig.logger.info(
          `vite-bundled-i18n: compiled runtime modules written to ${path.relative(resolvedConfig.root, result.compiledOutDir)}`,
        );
      }
      if (buildConfig.emitTypes !== false) {
        resolvedConfig.logger.info(
          `vite-bundled-i18n: types written to ${path.relative(resolvedConfig.root, resolved.typesOutPath)}`,
        );
      }

      // Clear the buildStart cache so subsequent `vite build` invocations in
      // the same process (watch mode) walk fresh.
      buildStartAnalysis = undefined;
    },
  };
}
