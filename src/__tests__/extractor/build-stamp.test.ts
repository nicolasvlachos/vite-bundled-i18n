import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeAnalysisFingerprint,
  detectStaleness,
  readBuildStamp,
  writeBuildStamp,
  BUILD_STAMP_SCHEMA_VERSION,
  BUILD_STAMP_FILE_NAME,
} from '../../extractor/build-stamp';
import type { ProjectAnalysis } from '../../extractor/walker-types';
import type { ExtractedKey } from '../../extractor/types';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-stamp-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const k = (key: string): ExtractedKey => ({ key, dynamic: false, line: 1, column: 0 });

function analysis(routes: { id: string; scopes: string[]; keys: string[] }[]): ProjectAnalysis {
  return {
    routes: routes.map((r) => ({
      entryPoint: `/fake/${r.id}.tsx`,
      routeId: r.id,
      scopes: r.scopes,
      entryScopes: r.scopes,
      keys: r.keys.map(k),
      files: [],
    })),
    availableNamespaces: [],
    allKeys: [],
    sharedNamespaces: [],
  };
}

describe('computeAnalysisFingerprint', () => {
  it('is stable across reorderings of routes/scopes/keys', () => {
    const a = analysis([
      { id: 'a', scopes: ['x', 'y'], keys: ['k1', 'k2'] },
      { id: 'b', scopes: ['z'], keys: ['k3'] },
    ]);
    const b = analysis([
      { id: 'b', scopes: ['z'], keys: ['k3'] },
      { id: 'a', scopes: ['y', 'x'], keys: ['k2', 'k1'] },
    ]);
    expect(computeAnalysisFingerprint(a)).toBe(computeAnalysisFingerprint(b));
  });

  it('changes when a key is added', () => {
    const before = analysis([{ id: 'a', scopes: ['x'], keys: ['k1'] }]);
    const after = analysis([{ id: 'a', scopes: ['x'], keys: ['k1', 'k2'] }]);
    expect(computeAnalysisFingerprint(before)).not.toBe(computeAnalysisFingerprint(after));
  });

  it('changes when a scope is added', () => {
    const before = analysis([{ id: 'a', scopes: ['x'], keys: ['k1'] }]);
    const after = analysis([{ id: 'a', scopes: ['x', 'y'], keys: ['k1'] }]);
    expect(computeAnalysisFingerprint(before)).not.toBe(computeAnalysisFingerprint(after));
  });

  it('ignores call-site metadata (line/column)', () => {
    const base: ProjectAnalysis = analysis([{ id: 'a', scopes: ['x'], keys: ['k1'] }]);
    const shifted: ProjectAnalysis = {
      ...base,
      routes: base.routes.map((r) => ({
        ...r,
        keys: r.keys.map((kk) => ({ ...kk, line: 999, column: 42 })),
      })),
    };
    expect(computeAnalysisFingerprint(base)).toBe(computeAnalysisFingerprint(shifted));
  });
});

describe('build-stamp read/write round-trip', () => {
  it('writes then reads the same shape', () => {
    const stamp = {
      schemaVersion: BUILD_STAMP_SCHEMA_VERSION,
      pluginVersion: '0.7.0',
      configHash: 'abc123',
      analysisFingerprint: 'def456',
      routeCount: 5,
      keyCount: 42,
      cacheMtimeAtStampWrite: 1700000000000,
      writtenAt: new Date().toISOString(),
    };
    writeBuildStamp(tmpDir, stamp);
    expect(readBuildStamp(tmpDir)).toEqual(stamp);
  });

  it('returns null for missing file', () => {
    expect(readBuildStamp(tmpDir)).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    fs.writeFileSync(path.join(tmpDir, BUILD_STAMP_FILE_NAME), 'not json{{{');
    expect(readBuildStamp(tmpDir)).toBeNull();
  });

  it('returns null when the schema version mismatches (forces invalidation on upgrade)', () => {
    fs.writeFileSync(
      path.join(tmpDir, BUILD_STAMP_FILE_NAME),
      JSON.stringify({
        schemaVersion: BUILD_STAMP_SCHEMA_VERSION + 99,
        pluginVersion: '0.7.0',
        configHash: 'x',
        analysisFingerprint: 'y',
        routeCount: 0,
        keyCount: 0,
        cacheMtimeAtStampWrite: null,
        writtenAt: new Date().toISOString(),
      }),
    );
    expect(readBuildStamp(tmpDir)).toBeNull();
  });

  it('survives missing parent directory by creating it', () => {
    const nested = path.join(tmpDir, 'a/b/c');
    writeBuildStamp(nested, {
      schemaVersion: BUILD_STAMP_SCHEMA_VERSION,
      pluginVersion: '0.7.0',
      configHash: 'h',
      analysisFingerprint: 'f',
      routeCount: 0,
      keyCount: 0,
      cacheMtimeAtStampWrite: null,
      writtenAt: '2026-01-01T00:00:00.000Z',
    });
    expect(fs.existsSync(path.join(nested, BUILD_STAMP_FILE_NAME))).toBe(true);
  });
});

describe('detectStaleness', () => {
  const cacheFile = () => path.join(tmpDir, 'cache', 'extraction-v2.json');

  /**
   * Write cache + stamp in the order a real build would: cache first
   * (during `runProjectAnalysis`), stamp last (during `emitBundlesArtifacts`)
   * with the cache's mtime captured into `cacheMtimeAtStampWrite`. Returns
   * the recorded cache mtime so tests can compare against it.
   */
  function setupFreshBuild(overrides: Partial<Parameters<typeof writeBuildStamp>[1]> = {}): number {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(cacheFile(), '{}');
    const cacheMtime = fs.statSync(cacheFile()).mtimeMs;
    writeBuildStamp(tmpDir, {
      schemaVersion: BUILD_STAMP_SCHEMA_VERSION,
      pluginVersion: '0.7.0',
      configHash: 'cfg-hash',
      analysisFingerprint: 'fp',
      routeCount: 1,
      keyCount: 1,
      cacheMtimeAtStampWrite: cacheMtime,
      writtenAt: new Date().toISOString(),
      ...overrides,
    });
    return cacheMtime;
  }

  function bumpCacheMtime(deltaMs: number): void {
    const future = new Date(Date.now() + deltaMs);
    fs.utimesSync(cacheFile(), future, future);
  }

  it('returns null when nothing exists (clean install)', () => {
    expect(detectStaleness({
      generatedOutDir: tmpDir,
      cacheFilePath: cacheFile(),
      pluginVersion: '0.7.0',
      configHash: 'cfg-hash',
    })).toBeNull();
  });

  it('returns null when stamp + cache agree (no advancement since stamp wrote)', () => {
    setupFreshBuild();
    expect(detectStaleness({
      generatedOutDir: tmpDir,
      cacheFilePath: cacheFile(),
      pluginVersion: '0.7.0',
      configHash: 'cfg-hash',
    })).toBeNull();
  });

  it('flags cache-without-stamp (previous build never finished)', () => {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(cacheFile(), '{}');
    // No stamp written.
    const r = detectStaleness({
      generatedOutDir: tmpDir,
      cacheFilePath: cacheFile(),
      pluginVersion: '0.7.0',
      configHash: 'cfg-hash',
    });
    expect(r?.reason).toBe('cache-without-stamp');
    expect(r?.message).toMatch(/clean/);
  });

  it('flags plugin-version-changed', () => {
    setupFreshBuild({ pluginVersion: '0.6.2' });
    const r = detectStaleness({
      generatedOutDir: tmpDir,
      cacheFilePath: cacheFile(),
      pluginVersion: '0.7.0',
      configHash: 'cfg-hash',
    });
    expect(r?.reason).toBe('plugin-version-changed');
    expect(r?.message).toMatch(/0\.6\.2/);
    expect(r?.message).toMatch(/0\.7\.0/);
  });

  it('flags config-changed', () => {
    setupFreshBuild({ configHash: 'old-hash' });
    const r = detectStaleness({
      generatedOutDir: tmpDir,
      cacheFilePath: cacheFile(),
      pluginVersion: '0.7.0',
      configHash: 'new-hash',
    });
    expect(r?.reason).toBe('config-changed');
  });

  it('flags cache-newer-than-stamp when cache mtime advances past stamp\'s observed mtime + grace', () => {
    setupFreshBuild();
    // Cache subsequently touched (e.g. by dev-mode transform) past the grace window.
    bumpCacheMtime(10 * 60 * 1000);

    const r = detectStaleness({
      generatedOutDir: tmpDir,
      cacheFilePath: cacheFile(),
      pluginVersion: '0.7.0',
      configHash: 'cfg-hash',
      gracePeriodMs: 60 * 1000,
    });
    expect(r?.reason).toBe('cache-newer-than-stamp');
    expect(r?.message).toMatch(/rebuild|build|clean/i);
  });

  it('respects gracePeriodMs (small drift is tolerated)', () => {
    setupFreshBuild();
    bumpCacheMtime(30 * 1000);
    expect(detectStaleness({
      generatedOutDir: tmpDir,
      cacheFilePath: cacheFile(),
      pluginVersion: '0.7.0',
      configHash: 'cfg-hash',
      gracePeriodMs: 60 * 1000,
    })).toBeNull();
  });

  it('does NOT flag staleness on a slow build (the C1 fix)', () => {
    // Simulate a build that took 6 minutes between cache-write and
    // stamp-write. With the OLD comparison (stamp file mtime vs cache
    // file mtime), this would falsely fire 'cache-newer-than-stamp'
    // on the next run — even though nothing has happened since.
    setupFreshBuild();
    // Manually bump only the stamp's mtime, leaving the cache's mtime
    // untouched. With the new logic — comparing cache.mtime against
    // stamp.cacheMtimeAtStampWrite — there's no drift, so no warning.
    const stampPath = path.join(tmpDir, BUILD_STAMP_FILE_NAME);
    const farFuture = new Date(Date.now() + 10 * 60 * 1000);
    fs.utimesSync(stampPath, farFuture, farFuture);

    expect(detectStaleness({
      generatedOutDir: tmpDir,
      cacheFilePath: cacheFile(),
      pluginVersion: '0.7.0',
      configHash: 'cfg-hash',
      gracePeriodMs: 60 * 1000,
    })).toBeNull();
  });
});
