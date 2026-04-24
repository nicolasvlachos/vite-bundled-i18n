import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { walkAll } from '../../extractor/walker';
import { createExtractionCache, computeConfigHash } from '../../extractor/extraction-cache';
import * as extractModule from '../../extractor/extract';

/**
 * End-to-end coverage: simulates the realistic dev-server lifecycle where
 * a cache survives between runs. After a cold walk populates the cache and
 * persists it to disk, a second cold walk (fresh cache instance, same config)
 * should load the snapshot and skip every AST parse.
 */

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-cache-e2e-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relativePath: string, content: string): string {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  return fullPath;
}

function setupFixture() {
  writeFile('locales/en/products.json', JSON.stringify({ show: { title: 'Details' } }));
  writeFile('locales/en/shared.json', JSON.stringify({ ok: 'OK' }));
  writeFile(
    'src/components/Button.tsx',
    `
    import { useI18n } from 'vite-bundled-i18n/react';
    export function Button() {
      const { t } = useI18n();
      return <button>{t('shared.ok')}</button>;
    }
    `,
  );
  writeFile(
    'src/pages/Products.tsx',
    `
    import { useI18n } from 'vite-bundled-i18n/react';
    import { Button } from '../components/Button';
    export default function Products() {
      const { t } = useI18n('products.show');
      return <section>{t('products.show.title')}<Button /></section>;
    }
    `,
  );
}

const WALKER_CONFIG = {
  pages: ['src/pages/**/*.tsx'],
  defaultLocale: 'en',
  localesDir: 'locales',
  extractionScope: 'global' as const,
};

function makeCache(configHash = 'stable') {
  return createExtractionCache({
    dir: path.join(tmpDir, '.i18n', 'cache'),
    pluginVersion: '0.4.1',
    configHash,
  });
}

describe('extraction cache end-to-end', () => {
  it('second walker run skips AST parsing entirely when nothing changed', () => {
    setupFixture();

    // Cold walk: cache is empty; populate and persist.
    const cold = makeCache();
    walkAll({ ...WALKER_CONFIG, rootDir: tmpDir, cache: cold });
    cold.persistToDisk();
    expect(cold.size()).toBeGreaterThan(0);

    // Warm walk: fresh cache instance loads the snapshot.
    // extractKeys must not be called at all.
    const extractSpy = vi.spyOn(extractModule, 'extractKeys');
    const warm = makeCache();
    expect(warm.size()).toBeGreaterThan(0);
    const analysis = walkAll({ ...WALKER_CONFIG, rootDir: tmpDir, cache: warm });

    expect(extractSpy).not.toHaveBeenCalled();
    expect(analysis.routes).toHaveLength(1);
    expect(analysis.routes[0].keys.map((k) => k.key).sort()).toEqual([
      'products.show.title',
      'shared.ok',
    ]);

    extractSpy.mockRestore();
  });

  it('config-hash change invalidates the entire cache', () => {
    setupFixture();

    const first = makeCache('hash-A');
    walkAll({ ...WALKER_CONFIG, rootDir: tmpDir, cache: first });
    first.persistToDisk();

    const extractSpy = vi.spyOn(extractModule, 'extractKeys');

    // Different config hash → cache from disk is discarded.
    const second = makeCache('hash-B');
    expect(second.size()).toBe(0);
    walkAll({ ...WALKER_CONFIG, rootDir: tmpDir, cache: second });

    // Every file parsed again.
    expect(extractSpy.mock.calls.length).toBeGreaterThan(0);
    extractSpy.mockRestore();
  });

  it('a single-file edit re-parses only the changed file', () => {
    setupFixture();

    const cold = makeCache();
    walkAll({ ...WALKER_CONFIG, rootDir: tmpDir, cache: cold });
    cold.persistToDisk();

    // Edit only Button.tsx.
    const buttonPath = path.join(tmpDir, 'src/components/Button.tsx');
    const later = Date.now() + 5_000;
    fs.writeFileSync(
      buttonPath,
      `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function Button() {
        const { t } = useI18n();
        return <button>{t('shared.ok')}{t('shared.cancel')}</button>;
      }
      `,
    );
    fs.utimesSync(buttonPath, later / 1000, later / 1000);

    const extractSpy = vi.spyOn(extractModule, 'extractKeys');
    const warm = makeCache();
    const analysis = walkAll({ ...WALKER_CONFIG, rootDir: tmpDir, cache: warm });

    expect(extractSpy).toHaveBeenCalledTimes(1);
    expect(extractSpy.mock.calls[0][1].filePath).toBe(buttonPath);
    expect(analysis.routes[0].keys.map((k) => k.key).sort()).toContain('shared.cancel');
    extractSpy.mockRestore();
  });

  it('config hash is stable across equivalent inputs', () => {
    // Slight reordering / property insertion should not change the hash.
    const hashA = computeConfigHash({
      pages: ['src/pages/**/*.tsx'],
      defaultLocale: 'en',
      dictionaries: { global: { include: ['shared.*'] } },
    });
    const hashB = computeConfigHash({
      dictionaries: { global: { include: ['shared.*'] } },
      defaultLocale: 'en',
      pages: ['src/pages/**/*.tsx'],
    });
    expect(hashA).toBe(hashB);
  });
});
