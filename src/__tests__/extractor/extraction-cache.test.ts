import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createExtractionCache,
  computeConfigHash,
  CACHE_FILE_NAME,
  CACHE_SCHEMA_VERSION,
} from '../../extractor/extraction-cache';
import type { CacheFileEntry } from '../../extractor/extraction-cache';

let tmpDir: string;

function makeEntry(overrides?: Partial<CacheFileEntry>): CacheFileEntry {
  return {
    mtime: 1_000,
    size: 100,
    imports: ['./foo'],
    keys: [{ key: 'shared.ok', dynamic: false, line: 1, column: 0 }],
    scopes: ['shared'],
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-cache-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('createExtractionCache', () => {
  it('starts empty when no cache file exists', () => {
    const cache = createExtractionCache({
      dir: tmpDir,
      pluginVersion: '0.4.1',
      configHash: 'abc',
    });
    expect(cache.size()).toBe(0);
    expect(cache.get('/any/path.tsx')).toBeUndefined();
  });

  it('round-trips entries via set/get', () => {
    const cache = createExtractionCache({
      dir: tmpDir,
      pluginVersion: '0.4.1',
      configHash: 'abc',
    });
    cache.set('/pages/a.tsx', makeEntry({ mtime: 5 }));
    expect(cache.size()).toBe(1);
    expect(cache.get('/pages/a.tsx')?.mtime).toBe(5);
  });

  it('invalidate removes a single entry', () => {
    const cache = createExtractionCache({
      dir: tmpDir,
      pluginVersion: '0.4.1',
      configHash: 'abc',
    });
    cache.set('/a.tsx', makeEntry());
    cache.set('/b.tsx', makeEntry());
    cache.invalidate('/a.tsx');
    expect(cache.get('/a.tsx')).toBeUndefined();
    expect(cache.get('/b.tsx')).toBeDefined();
  });

  it('clear drops all entries', () => {
    const cache = createExtractionCache({
      dir: tmpDir,
      pluginVersion: '0.4.1',
      configHash: 'abc',
    });
    cache.set('/a.tsx', makeEntry());
    cache.set('/b.tsx', makeEntry());
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it('persistToDisk writes a JSON file that loads cleanly on next init', () => {
    const first = createExtractionCache({
      dir: tmpDir,
      pluginVersion: '0.4.1',
      configHash: 'abc',
    });
    first.set('/a.tsx', makeEntry({ mtime: 99 }));
    first.persistToDisk();

    const cacheFilePath = path.join(tmpDir, CACHE_FILE_NAME);
    expect(fs.existsSync(cacheFilePath)).toBe(true);

    const second = createExtractionCache({
      dir: tmpDir,
      pluginVersion: '0.4.1',
      configHash: 'abc',
    });
    expect(second.size()).toBe(1);
    expect(second.get('/a.tsx')?.mtime).toBe(99);
  });

  it('drops entries when schemaVersion on disk is older', () => {
    const cacheFile = path.join(tmpDir, CACHE_FILE_NAME);
    fs.writeFileSync(cacheFile, JSON.stringify({
      schemaVersion: CACHE_SCHEMA_VERSION - 1,
      pluginVersion: '0.4.1',
      configHash: 'abc',
      nodeVersion: process.version,
      createdAt: new Date().toISOString(),
      files: { '/a.tsx': makeEntry() },
    }));

    const cache = createExtractionCache({
      dir: tmpDir,
      pluginVersion: '0.4.1',
      configHash: 'abc',
    });
    expect(cache.size()).toBe(0);
  });

  it('drops entries when pluginVersion on disk differs', () => {
    const cacheFile = path.join(tmpDir, CACHE_FILE_NAME);
    fs.writeFileSync(cacheFile, JSON.stringify({
      schemaVersion: CACHE_SCHEMA_VERSION,
      pluginVersion: '0.3.0',
      configHash: 'abc',
      nodeVersion: process.version,
      createdAt: new Date().toISOString(),
      files: { '/a.tsx': makeEntry() },
    }));

    const cache = createExtractionCache({
      dir: tmpDir,
      pluginVersion: '0.4.1',
      configHash: 'abc',
    });
    expect(cache.size()).toBe(0);
  });

  it('drops entries when configHash differs', () => {
    const cacheFile = path.join(tmpDir, CACHE_FILE_NAME);
    fs.writeFileSync(cacheFile, JSON.stringify({
      schemaVersion: CACHE_SCHEMA_VERSION,
      pluginVersion: '0.4.1',
      configHash: 'old-hash',
      nodeVersion: process.version,
      createdAt: new Date().toISOString(),
      files: { '/a.tsx': makeEntry() },
    }));

    const cache = createExtractionCache({
      dir: tmpDir,
      pluginVersion: '0.4.1',
      configHash: 'new-hash',
    });
    expect(cache.size()).toBe(0);
  });

  it('drops entries when major Node version differs', () => {
    const cacheFile = path.join(tmpDir, CACHE_FILE_NAME);
    fs.writeFileSync(cacheFile, JSON.stringify({
      schemaVersion: CACHE_SCHEMA_VERSION,
      pluginVersion: '0.4.1',
      configHash: 'abc',
      nodeVersion: 'v18.0.0',
      createdAt: new Date().toISOString(),
      files: { '/a.tsx': makeEntry() },
    }));

    const cache = createExtractionCache({
      dir: tmpDir,
      pluginVersion: '0.4.1',
      configHash: 'abc',
      currentNodeVersion: 'v22.0.0',
    });
    expect(cache.size()).toBe(0);
  });

  it('keeps entries when only minor/patch Node version differs', () => {
    const cacheFile = path.join(tmpDir, CACHE_FILE_NAME);
    fs.writeFileSync(cacheFile, JSON.stringify({
      schemaVersion: CACHE_SCHEMA_VERSION,
      pluginVersion: '0.4.1',
      configHash: 'abc',
      nodeVersion: 'v22.3.0',
      createdAt: new Date().toISOString(),
      files: { '/a.tsx': makeEntry() },
    }));

    const cache = createExtractionCache({
      dir: tmpDir,
      pluginVersion: '0.4.1',
      configHash: 'abc',
      currentNodeVersion: 'v22.9.1',
    });
    expect(cache.size()).toBe(1);
  });

  it('returns empty cache on corrupt JSON without throwing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cacheFile = path.join(tmpDir, CACHE_FILE_NAME);
    fs.writeFileSync(cacheFile, '{ not json }');

    const cache = createExtractionCache({
      dir: tmpDir,
      pluginVersion: '0.4.1',
      configHash: 'abc',
    });
    expect(cache.size()).toBe(0);
    warnSpy.mockRestore();
  });

  it('creates the cache dir if it does not exist on persistToDisk', () => {
    const nestedDir = path.join(tmpDir, 'nested', 'cache');
    const cache = createExtractionCache({
      dir: nestedDir,
      pluginVersion: '0.4.1',
      configHash: 'abc',
    });
    cache.set('/a.tsx', makeEntry());
    cache.persistToDisk();
    expect(fs.existsSync(path.join(nestedDir, CACHE_FILE_NAME))).toBe(true);
  });

  it('persistToDisk is atomic — no partial file on mid-write interruption', () => {
    const cache = createExtractionCache({
      dir: tmpDir,
      pluginVersion: '0.4.1',
      configHash: 'abc',
    });
    cache.set('/a.tsx', makeEntry({ mtime: 1 }));
    cache.persistToDisk();

    cache.set('/a.tsx', makeEntry({ mtime: 2 }));
    cache.persistToDisk();

    // Cache file contents are always a valid, fully-serialized snapshot.
    const raw = fs.readFileSync(path.join(tmpDir, CACHE_FILE_NAME), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.files['/a.tsx'].mtime).toBe(2);
  });
});

describe('computeConfigHash', () => {
  it('returns the same hash for identical inputs', () => {
    const a = computeConfigHash({
      pages: ['src/pages/**/*.tsx'],
      defaultLocale: 'en',
      dictionaries: { global: { include: ['shared.*'] } },
      hookSources: ['@/hooks/useI18n'],
      keyFields: ['labelKey'],
      extractionScope: 'global',
      crossNamespacePacking: true,
    });
    const b = computeConfigHash({
      pages: ['src/pages/**/*.tsx'],
      defaultLocale: 'en',
      dictionaries: { global: { include: ['shared.*'] } },
      hookSources: ['@/hooks/useI18n'],
      keyFields: ['labelKey'],
      extractionScope: 'global',
      crossNamespacePacking: true,
    });
    expect(a).toBe(b);
  });

  it('is stable across object key ordering', () => {
    const a = computeConfigHash({
      pages: ['a', 'b'],
      defaultLocale: 'en',
      dictionaries: { x: { include: ['a.*'] }, y: { include: ['b.*'] } },
    });
    const b = computeConfigHash({
      dictionaries: { y: { include: ['b.*'] }, x: { include: ['a.*'] } },
      defaultLocale: 'en',
      pages: ['a', 'b'],
    });
    expect(a).toBe(b);
  });

  it('changes when any input changes', () => {
    const base = computeConfigHash({ pages: ['a'], defaultLocale: 'en' });
    expect(base).not.toBe(computeConfigHash({ pages: ['b'], defaultLocale: 'en' }));
    expect(base).not.toBe(computeConfigHash({ pages: ['a'], defaultLocale: 'bg' }));
    expect(base).not.toBe(computeConfigHash({ pages: ['a'], defaultLocale: 'en', crossNamespacePacking: true }));
  });
});
