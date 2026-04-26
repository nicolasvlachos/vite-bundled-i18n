import fs from 'node:fs';
import path from 'node:path';
import { walkAll } from '../extractor/walker';
import { generateBundles } from '../extractor/bundle-generator';
import { writeTypes, writeRuntimeConst, runtimePathFromTypesPath } from '../extractor/type-generator';
import { generateReports } from '../extractor/reports';
import { compileAll } from '../extractor/compiler';
import type { ProjectAnalysis } from '../extractor/walker-types';
import type { DictionaryConfig } from '../core/types';
import { flattenLocaleKeys } from '../extractor/reports';
import {
  createExtractionCache,
  computeConfigHash,
  CACHE_FILE_NAME,
  type ExtractionCache,
} from '../extractor/extraction-cache';
import { resolveCacheConfig } from '../extractor/cache-config';
import { PLUGIN_VERSION } from '../plugin/version';
import { buildScopeMap } from '../extractor/scope-map';
import { applyDynamicKeys } from '../extractor/dynamic-keys';
import {
  runStrictExtraction,
  writeStrictExtractionReport,
  assertNoStrictExtractionErrors,
  type StrictExtractionConfig,
} from '../extractor/strict-extraction';
import {
  computeAnalysisFingerprint,
  detectStaleness,
  writeBuildStamp,
  BUILD_STAMP_SCHEMA_VERSION,
  BUILD_STAMP_FILE_NAME,
} from '../extractor/build-stamp';

export interface CliConfig {
  /** Glob patterns for page entry points. */
  pages: string[];
  /** Locales directory (relative to rootDir). */
  localesDir: string;
  /** All supported locale codes. */
  locales: string[];
  /** Default locale. */
  defaultLocale: string;
  /** Root directory. Defaults to process.cwd(). */
  rootDir?: string;
  /** Output directory for generated bundles. Defaults to '.i18n'. */
  outDir?: string;
  /** Output path for generated types. Defaults to '.i18n/i18n.d.ts'. */
  typesOutPath?: string;
  /** Extraction scope. Defaults to 'global'. */
  extractionScope?: 'global' | 'scoped';
  /** Optional dictionary configurations for compiled mode. */
  dictionaries?: Record<string, DictionaryConfig>;
  /** Additional module specifiers that export `useI18n`. */
  hookSources?: string[];
  /**
   * Additional property names to scan as translation key fields.
   * Mirrors `I18nSharedConfig.extraction.keyFields`. Threaded through
   * to the walker AND to the cache `configHash` so CLI-driven and
   * Vite-driven builds produce identical hashes (otherwise alternating
   * between the two would invalidate the cache on every switch).
   */
  keyFields?: string[];
  /**
   * Inline cross-namespace keys (tree-shaken) into each scope bundle.
   * See `I18nSharedConfig.bundling.crossNamespacePacking`.
   */
  crossNamespacePacking?: boolean;
  /**
   * Runtime-computed keys to treat as always-extracted. Matches
   * `I18nSharedConfig.bundling.dynamicKeys`. CLI-side JSON config only,
   * since function-based identifiers aren't serializable.
   */
  dynamicKeys?: readonly string[];
  /**
   * Severity for the "page registers no scope" audit. Matches
   * `I18nSharedConfig.bundling.strictScopeRegistration`.
   *
   * @deprecated since v0.7. Use `strictExtraction.scopeRegistration`
   * instead. Honored as a fallback when `strictExtraction` is not set.
   */
  strictScopeRegistration?: 'off' | 'warn' | 'error';
  /**
   * Unified extraction-correctness audit (v0.7+). Matches
   * `I18nSharedConfig.bundling.strictExtraction`. See that field's
   * docs for the full shape.
   */
  strictExtraction?: StrictExtractionConfig;
  /**
   * Extraction cache control. `false` disables, an object configures the
   * backing directory and persistence. Env vars (`VITE_I18N_NO_CACHE`,
   * `VITE_I18N_CLEAR_CACHE`, `VITE_I18N_CACHE_DEBUG`) always take
   * precedence. See `resolveCacheConfig`.
   */
  cache?: boolean | {
    enabled?: boolean;
    dir?: string;
    persist?: boolean;
  };
}

function resolveConfig(config: CliConfig) {
  const rootDir = config.rootDir ?? process.cwd();
  const outDir = config.outDir ?? path.join(rootDir, '.i18n');
  const typesOutPath =
    config.typesOutPath ?? path.join(outDir, 'i18n-generated.ts');
  const localesDir = path.isAbsolute(config.localesDir)
    ? config.localesDir
    : path.join(rootDir, config.localesDir);
  const extractionScope = config.extractionScope ?? 'global';

  return { rootDir, outDir, typesOutPath, localesDir, extractionScope } as const;
}

function buildCliCache(config: CliConfig, rootDir: string): ExtractionCache | undefined {
  const cacheSettings = resolveCacheConfig(config.cache, { rootDir });
  if (!cacheSettings.enabled) return undefined;

  if (cacheSettings.clearBeforeStart) {
    try {
      fs.rmSync(cacheSettings.dir, { recursive: true, force: true });
    } catch {
      // Non-fatal — fall through to a fresh cache.
    }
  }

  return createExtractionCache({
    dir: cacheSettings.dir,
    pluginVersion: PLUGIN_VERSION,
    configHash: computeConfigHash({
      pages: config.pages,
      defaultLocale: config.defaultLocale,
      extractionScope: config.extractionScope ?? 'global',
      hookSources: config.hookSources,
      keyFields: config.keyFields,
      dictionaries: config.dictionaries,
      crossNamespacePacking: config.crossNamespacePacking,
    }),
    debug: cacheSettings.debug,
  });
}

function persistCache(config: CliConfig, cache: ExtractionCache | undefined, rootDir: string): void {
  if (!cache) return;
  const cacheSettings = resolveCacheConfig(config.cache, { rootDir });
  if (cacheSettings.persist) {
    cache.persistToDisk();
  }
}

function runWalker(config: CliConfig, cache?: ExtractionCache): ProjectAnalysis {
  const { rootDir, localesDir, extractionScope } = resolveConfig(config);

  const analysis = walkAll({
    pages: config.pages,
    rootDir,
    localesDir,
    defaultLocale: config.defaultLocale,
    extractionScope,
    hookSources: config.hookSources,
    keyFields: config.keyFields,
    cache,
  });

  // Mirror the build plugin: apply declared dynamic keys, run the
  // strict-extraction audit, and persist the structured report. Same
  // primitives, identical semantics — keeps CLI-driven and Vite-driven
  // builds in lockstep so swapping between them never surprises CI.
  if (config.dynamicKeys && config.dynamicKeys.length > 0) {
    applyDynamicKeys(analysis, {
      dynamicKeys: config.dynamicKeys,
      dictionaries: config.dictionaries,
      crossNamespacePacking: config.crossNamespacePacking,
    });
  }

  const { outDir } = resolveConfig(config);
  const defaultReportPath = path.join(outDir, 'strict-extraction-report.json');
  const strictReport = runStrictExtraction({
    analysis,
    rootDir,
    localesDir,
    defaultLocale: config.defaultLocale,
    dictionaries: config.dictionaries,
    dynamicKeys: config.dynamicKeys,
    config: config.strictExtraction,
    legacyStrictScopeRegistration: config.strictScopeRegistration,
    defaultReportPath,
  });
  writeStrictExtractionReport(defaultReportPath, strictReport);
  for (const finding of strictReport.findings) {
    if (finding.severity === 'warn') {
      console.warn(`[vite-bundled-i18n strictExtraction/${finding.check}] ${finding.message}`);
    }
  }
  assertNoStrictExtractionErrors(strictReport);

  return analysis;
}

function collectScopeNames(analysis: ProjectAnalysis): string[] {
  return [...new Set(analysis.routes.flatMap((route) => route.scopes))].sort();
}

/**
 * Emit both the typed `.ts` (for TSC/IDE) and runtime `.js` (for Vite
 * resolve.alias) generated files. Called by every CLI command that
 * previously only wrote the `.ts` file — keeps CLI output aligned with
 * the Vite plugin's `emitGeneratedArtifacts` so there's no drift.
 */
function emitGeneratedPair(
  analysis: ProjectAnalysis,
  config: CliConfig,
  localesDir: string,
  rootDir: string,
  typesOutPath: string,
): void {
  const scopeNames = collectScopeNames(analysis);
  const scopeMap = buildScopeMap(analysis, {
    rootDir,
    defaultLocale: config.defaultLocale,
    dictionaries: config.dictionaries,
  });
  const pageScopeMap: Record<string, readonly string[]> = {};
  for (const [id, entry] of Object.entries(scopeMap.pages)) {
    pageScopeMap[id] = entry.scopes;
  }
  const hasPageMap = Object.keys(pageScopeMap).length > 0;
  writeTypes(
    localesDir,
    config.defaultLocale,
    typesOutPath,
    scopeNames,
    hasPageMap ? pageScopeMap : undefined,
  );
  writeRuntimeConst(
    runtimePathFromTypesPath(typesOutPath),
    hasPageMap ? pageScopeMap : undefined,
  );
}

/**
 * Pad a string to the given width.
 */
function pad(str: string, width: number): string {
  return str + ' '.repeat(Math.max(0, width - str.length));
}

/**
 * Print a simple ASCII table to stdout.
 */
function printTable(
  headers: string[],
  rows: string[][],
): void {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );

  const sep =
    '\u250c' +
    colWidths.map((w) => '\u2500'.repeat(w + 2)).join('\u252c') +
    '\u2510';
  const mid =
    '\u251c' +
    colWidths.map((w) => '\u2500'.repeat(w + 2)).join('\u253c') +
    '\u2524';
  const bot =
    '\u2514' +
    colWidths.map((w) => '\u2500'.repeat(w + 2)).join('\u2534') +
    '\u2518';

  const formatRow = (cells: string[]) =>
    '\u2502' +
    cells.map((c, i) => ' ' + pad(c, colWidths[i]) + ' ').join('\u2502') +
    '\u2502';

  console.log(sep);
  console.log(formatRow(headers));
  console.log(mid);
  for (const row of rows) {
    console.log(formatRow(row));
  }
  console.log(bot);
}

/**
 * Run the walker and print a summary table to stdout.
 * Returns the ProjectAnalysis for programmatic use.
 */
export function analyze(config: CliConfig): ProjectAnalysis {
  const { rootDir, localesDir } = resolveConfig(config);
  const cache = buildCliCache(config, rootDir);
  const analysis = runWalker(config, cache);
  persistCache(config, cache, rootDir);

  const availableKeys = flattenLocaleKeys(localesDir, config.defaultLocale);
  const totalAvailable = Array.from(availableKeys.values()).reduce(
    (sum, keys) => sum + keys.length,
    0,
  );

  const rows = analysis.routes.map((route) => {
    const usedCount = route.keys.filter((k) => !k.dynamic).length;
    return [
      route.routeId,
      String(usedCount),
      String(totalAvailable),
      String(totalAvailable - usedCount),
    ];
  });

  printTable(['Route', 'Used Keys', 'Available', 'Pruned'], rows);

  console.log(
    `\n${analysis.routes.length} route(s), ${analysis.allKeys.length} unique key(s), ${analysis.availableNamespaces.length} namespace(s)`,
  );

  return analysis;
}

/**
 * Run the walker, then generate bundles and types.
 * Prints what was generated to stdout.
 */
export function generate(config: CliConfig): void {
  const { rootDir, outDir, typesOutPath, localesDir } = resolveConfig(config);
  const cache = buildCliCache(config, rootDir);
  const analysis = runWalker(config, cache);
  persistCache(config, cache, rootDir);

  const bundles = generateBundles(analysis, {
    localesDir,
    locales: config.locales,
    outDir,
    crossNamespacePacking: config.crossNamespacePacking,
  });

  emitGeneratedPair(analysis, config, localesDir, rootDir, typesOutPath);

  console.log(`Generated ${bundles.length} bundle(s):`);
  for (const b of bundles) {
    console.log(`  ${b.locale}/${b.name} — ${b.keyCount} keys (${b.prunedCount} pruned)`);
  }
  console.log(`Types written to ${typesOutPath}`);
}

/**
 * Run the walker, then generate diagnostic reports.
 * Prints summary to stdout.
 */
export function report(config: CliConfig): void {
  const { rootDir, outDir, localesDir } = resolveConfig(config);
  const cache = buildCliCache(config, rootDir);
  const analysis = runWalker(config, cache);
  persistCache(config, cache, rootDir);

  generateReports(analysis, localesDir, config.defaultLocale, outDir, config.dictionaries);

  console.log(`Reports written to ${outDir}:`);
  console.log('  manifest.json');
  console.log('  missing.json');
  console.log('  unused.json');
  console.log('  stats.json');
}

/**
 * Run the walker, then compile pre-resolved flat Map modules.
 * Prints a summary to stdout.
 */
export function compile(config: CliConfig): void {
  const { rootDir, outDir, localesDir } = resolveConfig(config);
  const cache = buildCliCache(config, rootDir);
  const analysis = runWalker(config, cache);
  persistCache(config, cache, rootDir);
  const compiledOutDir = path.join(outDir, 'compiled');

  compileAll(analysis, {
    localesDir,
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    outDir: compiledOutDir,
    dictionaries: config.dictionaries,
    crossNamespacePacking: config.crossNamespacePacking,
  });

  // Count generated modules: one per route per locale, plus dictionary modules
  const routeModules = analysis.routes.length * config.locales.length;
  const dictModules =
    config.dictionaries && Object.keys(config.dictionaries).length > 0
      ? config.locales.length
      : 0;
  const total = routeModules + dictModules + 1; // +1 for manifest

  console.log(`Compiled ${total} module(s) to ${compiledOutDir}`);
}

/**
 * Run analyze + generate + compile + report all at once.
 */
export function build(config: CliConfig): void {
  const { rootDir, outDir, typesOutPath, localesDir } = resolveConfig(config);
  const cache = buildCliCache(config, rootDir);
  const analysis = runWalker(config, cache);
  persistCache(config, cache, rootDir);

  // Analyze: print table
  const availableKeys = flattenLocaleKeys(localesDir, config.defaultLocale);
  const totalAvailable = Array.from(availableKeys.values()).reduce(
    (sum, keys) => sum + keys.length,
    0,
  );

  const rows = analysis.routes.map((route) => {
    const usedCount = route.keys.filter((k) => !k.dynamic).length;
    return [
      route.routeId,
      String(usedCount),
      String(totalAvailable),
      String(totalAvailable - usedCount),
    ];
  });

  printTable(['Route', 'Used Keys', 'Available', 'Pruned'], rows);

  // Generate bundles + types
  const bundles = generateBundles(analysis, {
    localesDir,
    locales: config.locales,
    outDir,
    crossNamespacePacking: config.crossNamespacePacking,
  });

  emitGeneratedPair(analysis, config, localesDir, rootDir, typesOutPath);

  console.log(`\nGenerated ${bundles.length} bundle(s)`);
  console.log(`Types written to ${typesOutPath}`);

  // Compile
  const compiledOutDir = path.join(outDir, 'compiled');
  compileAll(analysis, {
    localesDir,
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    outDir: compiledOutDir,
    dictionaries: config.dictionaries,
    crossNamespacePacking: config.crossNamespacePacking,
  });
  console.log(`Compiled modules written to ${compiledOutDir}`);

  // Reports
  generateReports(analysis, localesDir, config.defaultLocale, outDir, config.dictionaries);

  // Build-stamp: mirrors the Vite build plugin so CLI-driven and Vite-driven
  // builds produce the same observability artifact. Without this, a project
  // that runs `npx vite-bundled-i18n build` would never get the staleness
  // warning on the next run. Records the cache mtime at stamp-write time
  // so subsequent staleness checks compare against the cache state THIS
  // build observed (not against the stamp file's own mtime, which would
  // make multi-minute builds and dev sessions look perpetually stale).
  const stampCacheSettings = resolveCacheConfig(config.cache, { rootDir });
  let cacheMtimeAtStampWrite: number | null = null;
  try {
    cacheMtimeAtStampWrite = fs.statSync(path.join(stampCacheSettings.dir, CACHE_FILE_NAME)).mtimeMs;
  } catch { /* cache disabled or absent */ }
  writeBuildStamp(outDir, {
    schemaVersion: BUILD_STAMP_SCHEMA_VERSION,
    pluginVersion: PLUGIN_VERSION,
    configHash: computeConfigHash({
      pages: config.pages,
      defaultLocale: config.defaultLocale,
      extractionScope: config.extractionScope ?? 'global',
      hookSources: config.hookSources,
      keyFields: config.keyFields,
      dictionaries: config.dictionaries,
      crossNamespacePacking: config.crossNamespacePacking,
    }),
    analysisFingerprint: computeAnalysisFingerprint(analysis),
    routeCount: analysis.routes.length,
    keyCount: analysis.allKeys.length,
    cacheMtimeAtStampWrite,
    writtenAt: new Date().toISOString(),
  });

  console.log(`Reports written to ${outDir}`);
  console.log(
    `\nDone. ${analysis.routes.length} route(s), ${analysis.allKeys.length} unique key(s).`,
  );
}

/**
 * `clean` — remove generated artifacts so the next build starts from a
 * known-good state. The recommended workaround whenever a per-scope bundle
 * looks stale or out-of-sync with the source locale files.
 *
 * Removes:
 * - the configured `outDir` (`.i18n/` by default) — extraction cache,
 *   reports, generated types, build stamp.
 *
 * Vite's own asset output (e.g. `public/build/__i18n/`) lives in Vite's
 * configured outDir, not here, and is rewritten on every `vite build` —
 * so there's nothing to clean from this side.
 *
 * Returns the number of paths removed; safe to call when nothing exists.
 *
 * Safety rails: by default, `extraPaths` entries are constrained to
 * paths INSIDE `rootDir`. An attempt to delete `/`, `~`, `..`, or any
 * absolute path outside `rootDir` is rejected with a logged refusal.
 * Operators who genuinely need to wipe an external path pass
 * `allowOutsideRoot: true` — they're explicitly opting in.
 */
export interface CleanOptions {
  /** Project root. Defaults to `process.cwd()`. */
  rootDir?: string;
  /** Generated output directory to remove. Mirrors `CliConfig.outDir`. Defaults to `.i18n`. */
  outDir?: string;
  /**
   * Additional absolute or rootDir-relative paths to remove. Use for
   * project-specific layouts (e.g. Laravel's `public/build/__i18n`,
   * `public/__i18n` for dev-emitted assets). Constrained to paths
   * inside `rootDir` unless {@link allowOutsideRoot} is `true`.
   */
  extraPaths?: string[];
  /**
   * Allow `extraPaths` entries that resolve outside `rootDir`. Off by
   * default — protects operators from `--extra-path /` mishaps.
   * @default false
   */
  allowOutsideRoot?: boolean;
  /** Suppress console output. */
  quiet?: boolean;
}

export interface CleanResult {
  removed: string[];
  missing: string[];
  /** Paths that were rejected by the safety rails (outside rootDir + allowOutsideRoot=false). */
  rejected: string[];
}

/**
 * Resolve a user-supplied extra path to an absolute path and validate
 * it against the rootDir containment rule. Returns `null` when the
 * path is rejected.
 */
function resolveExtraPath(raw: string, rootDir: string, allowOutsideRoot: boolean): string | null {
  const abs = path.resolve(rootDir, raw);
  if (allowOutsideRoot) return abs;

  const normalizedRoot = path.resolve(rootDir);
  const rel = path.relative(normalizedRoot, abs);
  // `rel` starts with `..` (or is absolute on Windows-cross-drive) when
  // `abs` is outside `rootDir`. Empty `rel` means abs === rootDir,
  // which is dangerous in its own right (would wipe the whole project)
  // — also reject.
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

export function clean(options: CleanOptions = {}): CleanResult {
  const rootDir = options.rootDir ?? process.cwd();
  const allowOutsideRoot = options.allowOutsideRoot === true;
  const outDir = options.outDir
    ? (path.isAbsolute(options.outDir) ? options.outDir : path.join(rootDir, options.outDir))
    : path.join(rootDir, '.i18n');

  // outDir is operator-controlled via config; trust it (matches the
  // pre-fix behavior). Only `extraPaths` is rate-limited.
  const targets: string[] = [outDir];
  const rejected: string[] = [];

  for (const raw of options.extraPaths ?? []) {
    const resolved = resolveExtraPath(raw, rootDir, allowOutsideRoot);
    if (resolved === null) {
      rejected.push(raw);
      continue;
    }
    targets.push(resolved);
  }

  const removed: string[] = [];
  const missing: string[] = [];

  for (const target of targets) {
    let existed = false;
    try {
      existed = fs.existsSync(target);
    } catch { /* treat as missing */ }

    if (!existed) {
      missing.push(target);
      continue;
    }

    try {
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(target);
    } catch (error) {
      if (!options.quiet) {
        console.warn(`vite-bundled-i18n: failed to remove ${target}: ${(error as Error).message}`);
      }
    }
  }

  if (!options.quiet) {
    if (removed.length > 0) {
      console.log(`Removed ${removed.length} path(s):`);
      for (const p of removed) console.log(`  ${p}`);
    } else if (rejected.length === 0) {
      console.log('Nothing to clean.');
    }
    for (const r of rejected) {
      console.warn(
        `vite-bundled-i18n: refusing to remove "${r}" — resolves outside rootDir (${rootDir}). ` +
        `If this is intentional, pass allowOutsideRoot: true.`,
      );
    }
  }

  return { removed, missing, rejected };
}

/**
 * `rebuild` — `clean` + `build`. The instinctive recovery move when a
 * per-scope bundle has gone stale; documented as such in the README's
 * troubleshooting section.
 *
 * Accepts both `CleanOptions` (for the wipe step) and `CliConfig` (for
 * the build step). The clean step always runs first so the build always
 * sees a fresh `.i18n/` directory.
 */
export function rebuild(config: CliConfig, cleanOptions?: Omit<CleanOptions, 'rootDir' | 'outDir'>): void {
  const { rootDir, outDir } = resolveConfig(config);
  clean({
    rootDir,
    outDir,
    extraPaths: cleanOptions?.extraPaths,
    allowOutsideRoot: cleanOptions?.allowOutsideRoot,
    quiet: cleanOptions?.quiet,
  });
  build(config);
}

// Re-export the build-stamp filename so the CLI entry can include it in
// `--help` output if it ever wants to.
export { BUILD_STAMP_FILE_NAME };

/**
 * Run staleness detection without modifying anything. Used by the CLI
 * `doctor` command (when added) and by tests that want to assert the
 * staleness signal directly.
 */
export function inspectStaleness(config: CliConfig): ReturnType<typeof detectStaleness> {
  const { rootDir, outDir } = resolveConfig(config);
  const cacheSettings = resolveCacheConfig(config.cache, { rootDir });
  return detectStaleness({
    generatedOutDir: outDir,
    cacheFilePath: path.join(cacheSettings.dir, CACHE_FILE_NAME),
    pluginVersion: PLUGIN_VERSION,
    configHash: computeConfigHash({
      pages: config.pages,
      defaultLocale: config.defaultLocale,
      extractionScope: config.extractionScope ?? 'global',
      hookSources: config.hookSources,
      keyFields: config.keyFields,
      dictionaries: config.dictionaries,
      crossNamespacePacking: config.crossNamespacePacking,
    }),
  });
}
