import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ProjectAnalysis } from './walker-types';

/**
 * Schema version for `.i18n/build-stamp.json`. Bump when the shape changes.
 *
 * The stamp is an integrity primitive — it records what the previous full
 * build emitted, so the next build can detect when downstream artifacts
 * (manifest, per-scope bundles) might be older than the extraction cache
 * and warn the operator before they ship stale prod assets.
 *
 * The cost is one small JSON file at the end of every build; the value is
 * one clear "your `.i18n/` is stale, run `npx vite-bundled-i18n clean`"
 * warning instead of a silent corruption.
 */
export const BUILD_STAMP_SCHEMA_VERSION = 1;

/** Filename written under `generatedOutDir` (`.i18n/` by default). */
export const BUILD_STAMP_FILE_NAME = 'build-stamp.json';

/**
 * Persisted shape. The fingerprint summarizes the analysis (routes, scopes,
 * keys per route) — when it changes between builds, downstream artifacts
 * MUST be regenerated. The stamp itself doesn't enforce that; it just
 * records the truth so we can verify on the next run.
 *
 * `cacheMtimeAtStampWrite` is the linchpin of the staleness check: it's
 * the mtime of the extraction cache file AT the moment this stamp was
 * written, NOT when the build happened to finish. The next run compares
 * the current cache.mtime against this recorded value, so a build that
 * takes 6 minutes (or a 4-hour dev session followed by a build) doesn't
 * falsely look stale on the next start.
 */
export interface BuildStamp {
  schemaVersion: number;
  pluginVersion: string;
  configHash: string;
  /** sha256 of the analysis fingerprint (see {@link computeAnalysisFingerprint}). */
  analysisFingerprint: string;
  /** Number of routes / unique keys for at-a-glance debugging. */
  routeCount: number;
  keyCount: number;
  /**
   * mtime (epoch ms) of the extraction cache file at the moment this
   * stamp was written. `null` when no cache existed at write time
   * (cache disabled). The next staleness check compares
   * `currentCacheStat.mtimeMs > this + grace` to detect "the cache has
   * been advanced since we last completed a build."
   */
  cacheMtimeAtStampWrite: number | null;
  /** When the stamp was written. ISO-8601 UTC. */
  writtenAt: string;
}

/**
 * Stable hash of the analysis. Fingerprints route ids → scopes + sorted
 * extracted key names (NOT call-site metadata like line/column, which
 * shouldn't gate downstream regeneration).
 *
 * Stable across reorderings — routes, scopes, and keys are sorted before
 * hashing.
 */
export function computeAnalysisFingerprint(analysis: ProjectAnalysis): string {
  const routes = [...analysis.routes]
    .map((route) => ({
      id: route.routeId,
      scopes: [...route.scopes].sort(),
      keys: [...new Set(route.keys.map((k) => k.key))].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const sharedNs = [...analysis.sharedNamespaces].sort();
  const availableNs = [...analysis.availableNamespaces].sort();

  const payload = JSON.stringify({ routes, sharedNs, availableNs });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Read the stamp at `dir/build-stamp.json` if present and parseable. Returns
 * `null` for missing/corrupt files — every consumer treats those identically
 * (no point distinguishing).
 */
export function readBuildStamp(dir: string): BuildStamp | null {
  const filePath = path.join(dir, BUILD_STAMP_FILE_NAME);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  let parsed: Partial<BuildStamp> | null;
  try {
    parsed = JSON.parse(raw) as Partial<BuildStamp>;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.schemaVersion !== BUILD_STAMP_SCHEMA_VERSION) return null;
  if (typeof parsed.pluginVersion !== 'string') return null;
  if (typeof parsed.configHash !== 'string') return null;
  if (typeof parsed.analysisFingerprint !== 'string') return null;

  // `cacheMtimeAtStampWrite` is allowed to be `number | null`. Anything
  // else means the file was hand-edited or the schema drifted — bail.
  const cm = parsed.cacheMtimeAtStampWrite;
  if (cm !== null && typeof cm !== 'number') return null;

  return parsed as BuildStamp;
}

/**
 * Write the stamp atomically (`writeFileSync` to a temp path, then rename).
 * Creates the parent directory if it doesn't exist. All failures are
 * swallowed — the stamp is observability, not correctness, so a failed
 * write must never break the build.
 */
export function writeBuildStamp(dir: string, stamp: BuildStamp): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return;
  }

  const filePath = path.join(dir, BUILD_STAMP_FILE_NAME);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(stamp, null, 2));
    fs.renameSync(tmpPath, filePath);
  } catch {
    try { fs.rmSync(tmpPath, { force: true }); } catch { /* swallow */ }
  }
}

/**
 * Inspect on-disk state and decide whether the operator should be warned
 * about likely staleness.
 *
 * Conditions that produce a warning:
 * - extraction cache file exists, but no build stamp at all → previous
 *   build never finished, or the stamp was deleted.
 * - build stamp exists but `pluginVersion` differs → upgrade happened
 *   without a clean rebuild.
 * - build stamp exists but `configHash` differs → config changed without
 *   a clean rebuild (cache itself will invalidate, but the user should
 *   know the prior bundle isn't trustworthy).
 * - extraction cache mtime > build stamp mtime by more than `gracePeriodMs`
 *   → cache has been advanced (likely by dev mode) without a full build,
 *   so any consumer reading prod bundle output is reading stale data.
 *
 * Returns `null` if everything looks fresh.
 */
export interface StalenessCheckOptions {
  generatedOutDir: string;
  cacheFilePath: string;
  pluginVersion: string;
  configHash: string;
  /** mtime delta tolerated before flagging the cache as "newer than stamp". Default: 5 minutes. */
  gracePeriodMs?: number;
}

export interface StalenessReport {
  reason:
    | 'cache-without-stamp'
    | 'plugin-version-changed'
    | 'config-changed'
    | 'cache-newer-than-stamp';
  message: string;
}

export function detectStaleness(options: StalenessCheckOptions): StalenessReport | null {
  const { generatedOutDir, cacheFilePath, pluginVersion, configHash } = options;
  const grace = options.gracePeriodMs ?? 5 * 60 * 1000;

  let cacheStat: fs.Stats | null;
  try {
    cacheStat = fs.statSync(cacheFilePath);
  } catch {
    cacheStat = null;
  }

  const stamp = readBuildStamp(generatedOutDir);

  if (cacheStat && !stamp) {
    return {
      reason: 'cache-without-stamp',
      message:
        `vite-bundled-i18n: extraction cache exists at ${cacheFilePath} but no build-stamp at ${path.join(generatedOutDir, BUILD_STAMP_FILE_NAME)}. ` +
        `Previous build may not have completed. If your prod bundles look stale, run: npx vite-bundled-i18n clean && <your-build-cmd>`,
    };
  }

  if (!stamp) return null;

  if (stamp.pluginVersion !== pluginVersion) {
    return {
      reason: 'plugin-version-changed',
      message:
        `vite-bundled-i18n: build-stamp records previous plugin version ${stamp.pluginVersion}, current is ${pluginVersion}. ` +
        `Downstream artifacts in ${generatedOutDir} may be stale until the next full build completes.`,
    };
  }

  if (stamp.configHash !== configHash) {
    return {
      reason: 'config-changed',
      message:
        `vite-bundled-i18n: extraction-relevant config changed since the last build-stamp. ` +
        `If your prod bundles look stale, run: npx vite-bundled-i18n clean && <your-build-cmd>`,
    };
  }

  if (cacheStat && stamp.cacheMtimeAtStampWrite !== null) {
    // Compare against the cache mtime the stamp OBSERVED, not the stamp
    // file's own mtime. This is the only correct anchor — a 6-minute
    // build (cache written first, stamp written last) would otherwise
    // look like 6 minutes of staleness on the next run.
    const drift = cacheStat.mtimeMs - stamp.cacheMtimeAtStampWrite;
    if (drift > grace) {
      const summary =
        stamp.routeCount && stamp.keyCount
          ? ` (last build saw ${stamp.routeCount} route(s), ${stamp.keyCount} key(s))`
          : '';
      return {
        reason: 'cache-newer-than-stamp',
        message:
          `vite-bundled-i18n: extraction cache has advanced ${formatDuration(drift)} since the last successful production build${summary}. ` +
          `If you've only been running \`vite dev\`, this is expected — the next \`vite build\` will reconcile. ` +
          `If you're seeing stale prod bundles, run: npx vite-bundled-i18n clean && <your-build-cmd>.`,
      };
    }
  }

  return null;
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}
