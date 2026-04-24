import path from 'node:path';
import type { DictionaryConfig } from '../core/types';
import type { ProjectAnalysis } from './walker-types';

/** Framework-agnostic page-to-scopes index emitted alongside scope bundles. */
export interface ScopeMapFile {
  /** Schema version. Bumped when the shape changes in a non-additive way. */
  version: 1;
  /** Default locale — mirrors the build config, useful for SSR preloading. */
  defaultLocale: string;
  /**
   * Per-page entries keyed by whatever {@link PageIdentifierFn} returned.
   * Consumers use this map at runtime inside their router's async resolve
   * hook to kick off scope loads in parallel with component resolution.
   */
  pages: Record<string, ScopeMapPageEntry>;
}

export interface ScopeMapPageEntry {
  /** Scopes this route declared via `useI18n(scope)`, deduplicated and stable. */
  scopes: readonly string[];
  /**
   * All dictionary names configured for this app. Dictionaries are app-wide
   * so every page entry lists the same set — this is a convenience for
   * consumers that want a single source of truth for "what to preload".
   */
  dictionaries: readonly string[];
}

/** Maps an absolute page file path to a stable string identifier. */
export type PageIdentifierFn = (absolutePath: string) => string;

export interface BuildScopeMapOptions {
  /** Absolute project root. Used by the default identifier resolver. */
  rootDir: string;
  /** Default locale — echoed into the emitted file. */
  defaultLocale: string;
  /** App-wide dictionary configurations. */
  dictionaries?: Record<string, DictionaryConfig>;
  /**
   * Custom page identifier resolver. When omitted, {@link defaultPageIdentifier}
   * is used, which strips the `src/pages/` prefix and common extensions.
   */
  pageIdentifier?: PageIdentifierFn;
}

const COMPOSITE_PAGE_SUFFIXES = [
  '.page.tsx',
  '.page.ts',
  '.page.jsx',
  '.page.js',
] as const;

const SINGLE_EXTENSIONS = new Set(['.tsx', '.ts', '.jsx', '.js']);

/**
 * Default identifier resolver.
 *
 * Produces stable, POSIX-separated identifiers suitable for routers that
 * already think in "page paths":
 *
 *   /projects/app/src/pages/giftcards/show.tsx      → "giftcards/show"
 *   /projects/app/src/pages/products/show.page.tsx  → "products/show"
 *   /projects/app/app/routes/home.tsx                → "app/routes/home"
 *
 * The `src/pages/` prefix is stripped when present; composite `.page.tsx`
 * / `.page.ts` suffixes collapse with the extension; single-file
 * `.tsx|.ts|.jsx|.js` extensions are dropped. Everything else passes through.
 */
export function defaultPageIdentifier(
  absolutePath: string,
  rootDir: string,
): string {
  let rel = path.relative(rootDir, absolutePath);

  const pagesPrefix = path.join('src', 'pages') + path.sep;
  if (rel.startsWith(pagesPrefix)) {
    rel = rel.slice(pagesPrefix.length);
  }

  // Strip composite suffixes first (they end in a known extension too).
  let strippedComposite = false;
  for (const suffix of COMPOSITE_PAGE_SUFFIXES) {
    if (rel.endsWith(suffix)) {
      rel = rel.slice(0, -suffix.length);
      strippedComposite = true;
      break;
    }
  }
  if (!strippedComposite) {
    const ext = path.extname(rel);
    if (SINGLE_EXTENSIONS.has(ext)) {
      rel = rel.slice(0, -ext.length);
    }
  }

  // POSIX normalization: collapse `\` on Windows, leave `/` untouched.
  return rel.split(path.sep).join('/').split('\\').join('/');
}

function uniqueOrdered(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

/**
 * Build a {@link ScopeMapFile} from a {@link ProjectAnalysis}.
 *
 * Each route contributes one entry keyed by the configured or default page
 * identifier. When two routes resolve to the same identifier (rare — e.g.
 * duplicate entry-point globs), the later entry wins. Duplicates should
 * usually be surfaced by the `stats.json` report separately.
 */
export function buildScopeMap(
  analysis: ProjectAnalysis,
  options: BuildScopeMapOptions,
): ScopeMapFile {
  const identify: PageIdentifierFn =
    options.pageIdentifier ?? ((abs) => defaultPageIdentifier(abs, options.rootDir));

  const dictionaryNames = options.dictionaries
    ? Object.keys(options.dictionaries)
    : [];

  const pages: Record<string, ScopeMapPageEntry> = {};
  for (const route of analysis.routes) {
    const id = identify(route.entryPoint);
    pages[id] = {
      scopes: uniqueOrdered(route.scopes),
      dictionaries: dictionaryNames,
    };
  }

  return {
    version: 1,
    defaultLocale: options.defaultLocale,
    pages,
  };
}
