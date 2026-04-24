import fs from 'node:fs';
import path from 'node:path';
import { walkAll } from '../extractor/walker';
import { generateBundles } from '../extractor/bundle-generator';
import { writeTypes } from '../extractor/type-generator';
import { generateReports } from '../extractor/reports';
import { compileAll } from '../extractor/compiler';
import type { ProjectAnalysis } from '../extractor/walker-types';
import type { DictionaryConfig } from '../core/types';
import { flattenLocaleKeys } from '../extractor/reports';
import {
  createExtractionCache,
  computeConfigHash,
  type ExtractionCache,
} from '../extractor/extraction-cache';
import { resolveCacheConfig } from '../extractor/cache-config';
import { PLUGIN_VERSION } from '../plugin/version';

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
   * Inline cross-namespace keys (tree-shaken) into each scope bundle.
   * See `I18nSharedConfig.bundling.crossNamespacePacking`.
   */
  crossNamespacePacking?: boolean;
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

  return walkAll({
    pages: config.pages,
    rootDir,
    localesDir,
    defaultLocale: config.defaultLocale,
    extractionScope,
    hookSources: config.hookSources,
    cache,
  });
}

function collectScopeNames(analysis: ProjectAnalysis): string[] {
  return [...new Set(analysis.routes.flatMap((route) => route.scopes))].sort();
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

  writeTypes(localesDir, config.defaultLocale, typesOutPath, collectScopeNames(analysis));

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

  writeTypes(localesDir, config.defaultLocale, typesOutPath, collectScopeNames(analysis));

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

  console.log(`Reports written to ${outDir}`);
  console.log(
    `\nDone. ${analysis.routes.length} route(s), ${analysis.allKeys.length} unique key(s).`,
  );
}
