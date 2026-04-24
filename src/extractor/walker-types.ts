import type { ExtractedKey } from './types';
import type { ExtractionCache } from './extraction-cache';

/**
 * Options for the import graph walker.
 */
export interface WalkerOptions {
  /** Glob patterns for page entry points. */
  pages: string[];
  /** Root directory of the project. Defaults to process.cwd(). */
  rootDir?: string;
  /** Locales directory path (relative to rootDir). For namespace discovery. */
  localesDir: string;
  /** Default locale code. Used for namespace discovery. */
  defaultLocale: string;
  /** Extraction scope mode. Default: 'global'. */
  extractionScope?: 'global' | 'scoped';
  /** Additional module specifiers that export `useI18n`. */
  hookSources?: string[];
  /**
   * Optional extraction cache. When provided, per-file AST parses are
   * skipped for entries whose mtime + size match disk. See
   * {@link ExtractionCache} and `createExtractionCache`.
   */
  cache?: ExtractionCache;
}

/**
 * Analysis result for a single route/page entry point.
 */
export interface RouteAnalysis {
  /** The page entry point file path (absolute). */
  entryPoint: string;
  /** A route identifier derived from the file path. */
  routeId: string;
  /** All scopes found across the component tree for this route. */
  scopes: string[];
  /** All unique translation keys used by this route (deduplicated by key string). */
  keys: ExtractedKey[];
  /** All files in this route's component tree (absolute paths). */
  files: string[];
}

/**
 * Analysis result for the entire project.
 */
export interface ProjectAnalysis {
  /** Analysis results per route. */
  routes: RouteAnalysis[];
  /** All namespace names discovered from locale files. */
  availableNamespaces: string[];
  /** All unique keys across all routes (deduplicated). */
  allKeys: ExtractedKey[];
  /** Namespaces used by >50% of routes — dictionary candidates. */
  sharedNamespaces: string[];
}
