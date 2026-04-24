import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ExtractedKey } from './types';

/** Cache file schema version. Bump when the {@link CacheFileEntry} shape changes. */
export const CACHE_SCHEMA_VERSION = 1;

/** Relative filename inside the configured cache directory. */
export const CACHE_FILE_NAME = 'extraction-v1.json';

/**
 * Per-file extraction snapshot stored in the cache.
 *
 * The fields mirror the walker's per-file analysis output. On subsequent
 * runs, the walker compares `mtime` + `size` from `fs.stat` against the
 * cached entry; if both match, the entry is trusted and the AST parse is
 * skipped entirely.
 */
export interface CacheFileEntry {
  /** Modification time in milliseconds, from `fs.statSync(path).mtimeMs`. */
  mtime: number;
  /** File size in bytes — a second signal beyond mtime for filesystems with 1s mtime resolution. */
  size: number;
  /** Resolved absolute import paths from this file. */
  imports: string[];
  /** Translation keys the extractor found in this file. */
  keys: ExtractedKey[];
  /** Scope strings declared via `useI18n(scope)` in this file. */
  scopes: string[];
}

/**
 * Header written alongside entries. Any mismatch on load discards the entire
 * cache — the entries can't be trusted when the context that produced them
 * has shifted (new plugin version, reshaped config, different Node).
 */
interface CacheHeader {
  schemaVersion: number;
  pluginVersion: string;
  configHash: string;
  nodeVersion: string;
  createdAt: string;
}

interface CacheFile extends CacheHeader {
  files: Record<string, CacheFileEntry>;
}

/**
 * Options for {@link createExtractionCache}.
 */
export interface ExtractionCacheOptions {
  /** Absolute path to the cache directory. Created on persist if missing. */
  dir: string;
  /** Plugin version (normally from `package.json`). */
  pluginVersion: string;
  /** Config hash — any change invalidates the whole cache. See {@link computeConfigHash}. */
  configHash: string;
  /**
   * Override the detected Node version. Test-only; production callers let it
   * default to `process.version`.
   */
  currentNodeVersion?: string;
  /** When true, emits cache hits/misses/invalidations to stderr. */
  debug?: boolean;
}

/**
 * In-memory cache of per-file extraction results, backed by a JSON snapshot
 * on disk.
 *
 * Initialization loads the snapshot (if present and valid). The cache is
 * mutated in-memory via {@link set}/{@link invalidate}/{@link clear} and
 * flushed to disk via {@link persistToDisk}. All disk I/O is synchronous —
 * reads happen once at startup, writes happen once at shutdown (or debounced
 * during HMR), so `await` overhead isn't warranted.
 */
export interface ExtractionCache {
  /** Look up an entry by absolute file path. */
  get(filePath: string): CacheFileEntry | undefined;
  /** Insert or replace an entry for this file. */
  set(filePath: string, entry: CacheFileEntry): void;
  /** Remove a single entry. */
  invalidate(filePath: string): void;
  /** Drop every entry in memory. Does not touch disk until {@link persistToDisk}. */
  clear(): void;
  /** Number of cached entries. */
  size(): number;
  /**
   * Persist the in-memory entries to disk as a single atomic write
   * (`writeFileSync` to a temp path, then `rename`). Creates the cache
   * directory if it doesn't exist yet.
   */
  persistToDisk(): void;
}

/**
 * Create a cache instance, eagerly loading from disk if a valid snapshot
 * exists at `{dir}/{CACHE_FILE_NAME}`. A missing, unreadable, or
 * header-mismatched snapshot yields an empty cache — the caller's next walk
 * populates it fresh.
 */
export function createExtractionCache(options: ExtractionCacheOptions): ExtractionCache {
  const nodeVersion = options.currentNodeVersion ?? process.version;
  const filePath = path.join(options.dir, CACHE_FILE_NAME);
  const entries = loadEntriesOrEmpty(filePath, {
    pluginVersion: options.pluginVersion,
    configHash: options.configHash,
    nodeVersion,
    debug: options.debug,
  });

  function debugLog(message: string): void {
    if (options.debug) {
      console.warn(`[i18n-cache] ${message}`);
    }
  }

  return {
    get(filePath) {
      return entries.get(filePath);
    },

    set(filePath, entry) {
      entries.set(filePath, entry);
    },

    invalidate(filePath) {
      entries.delete(filePath);
    },

    clear() {
      entries.clear();
    },

    size() {
      return entries.size;
    },

    persistToDisk() {
      const payload: CacheFile = {
        schemaVersion: CACHE_SCHEMA_VERSION,
        pluginVersion: options.pluginVersion,
        configHash: options.configHash,
        nodeVersion,
        createdAt: new Date().toISOString(),
        files: Object.fromEntries(entries),
      };

      try {
        fs.mkdirSync(options.dir, { recursive: true });
      } catch (error) {
        debugLog(`mkdir failed at ${options.dir}: ${(error as Error).message}`);
        return;
      }

      const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      try {
        fs.writeFileSync(tmpPath, JSON.stringify(payload));
        fs.renameSync(tmpPath, filePath);
        debugLog(`persisted ${entries.size} entries to ${filePath}`);
      } catch (error) {
        debugLog(`write failed: ${(error as Error).message}`);
        try { fs.rmSync(tmpPath, { force: true }); } catch { /* swallow */ }
      }
    },
  };
}

/**
 * Attempt to load + validate a cache file. Returns an empty `Map` on any of:
 * - missing file
 * - corrupt JSON
 * - schema/plugin/config/node-major mismatch
 */
function loadEntriesOrEmpty(
  filePath: string,
  context: { pluginVersion: string; configHash: string; nodeVersion: string; debug?: boolean },
): Map<string, CacheFileEntry> {
  const empty = new Map<string, CacheFileEntry>();

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return empty;
  }

  let parsed: Partial<CacheFile> | null = null;
  try {
    parsed = JSON.parse(raw) as Partial<CacheFile>;
  } catch {
    if (context.debug) {
      console.warn(`[i18n-cache] corrupt cache file at ${filePath}; starting empty`);
    }
    return empty;
  }

  if (!parsed || typeof parsed !== 'object') return empty;
  if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) return empty;
  if (parsed.pluginVersion !== context.pluginVersion) return empty;
  if (parsed.configHash !== context.configHash) return empty;

  if (!isCompatibleNodeVersion(parsed.nodeVersion, context.nodeVersion)) return empty;

  if (!parsed.files || typeof parsed.files !== 'object') return empty;

  const map = new Map<string, CacheFileEntry>();
  for (const [key, value] of Object.entries(parsed.files)) {
    if (value && typeof value === 'object') {
      map.set(key, value as CacheFileEntry);
    }
  }
  return map;
}

/**
 * Two Node versions are compatible iff their major components match. Minor
 * and patch differences are ignored — AST parser behavior is stable within a
 * major.
 */
function isCompatibleNodeVersion(
  cached: string | undefined,
  current: string,
): boolean {
  if (!cached) return false;
  return majorOf(cached) === majorOf(current);
}

function majorOf(version: string): string {
  const trimmed = version.startsWith('v') ? version.slice(1) : version;
  const dot = trimmed.indexOf('.');
  return dot === -1 ? trimmed : trimmed.slice(0, dot);
}

/**
 * Hash the extraction-relevant slice of config into a stable sha256. Any
 * change to a field that affects the walker's output bumps the hash,
 * invalidating the whole cache.
 *
 * Input is JSON-serialized with sorted keys so object-key ordering doesn't
 * perturb the result.
 */
export function computeConfigHash(input: unknown): string {
  const stable = stableStringify(input);
  return crypto.createHash('sha256').update(stable).digest('hex');
}

/**
 * JSON.stringify with deterministic object-key ordering. Arrays keep their
 * order (they're semantically meaningful — page globs have priority).
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(',');
  return `{${body}}`;
}
