import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { compileAll } from '../../extractor/compiler';
import { walkAll } from '../../extractor/walker';
import type { ProjectAnalysis } from '../../extractor/walker-types';
import {
  setTranslations,
  compiledTranslate,
  compiledHasKey,
  clearTranslations,
} from '../../core/compiled-runtime';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-compiled-int-'));
  clearTranslations();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(rel: string, content: string) {
  const full = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

/**
 * Parses a generated compiled module and returns the Map it exports.
 * Since we can't dynamically import from temp dirs easily in tests,
 * we parse the generated source and reconstruct the Map.
 */
function parseCompiledModule(filePath: string): Map<string, string> {
  const source = fs.readFileSync(filePath, 'utf-8');
  // Extract the array literal from: new Map([\n  ['key','value'],\n  ...])
  const match = source.match(/new Map\(\[([\s\S]*?)\]\)/);
  if (!match) return new Map();

  const entries: [string, string][] = [];
  const entryPattern = /\['([^']*?)','((?:[^'\\]|\\.)*)'\]/g;
  let m;
  while ((m = entryPattern.exec(match[1])) !== null) {
    entries.push([m[1], m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\')]);
  }
  return new Map(entries);
}

describe('Compiled mode integration', () => {
  it('full pipeline: walk → compile → load → translate', () => {
    // Set up locale files
    writeFile('locales/en/shared.json', JSON.stringify({
      ok: 'OK', cancel: 'Cancel', loading: 'Loading...',
    }));
    writeFile('locales/en/products.json', JSON.stringify({
      show: { title: 'Product Details', price: 'Price: {{amount}}' },
    }));
    writeFile('locales/bg/shared.json', JSON.stringify({
      ok: 'Добре',
    }));
    writeFile('locales/bg/products.json', JSON.stringify({
      show: { title: 'Детайли', price: 'Цена: {{amount}}' },
    }));

    // Set up source files
    writeFile('src/pages/ProductsPage.tsx', `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function ProductsPage() {
        const { t, ready } = useI18n('products.show');
        if (!ready) return <div>{t('shared.loading', 'Loading...')}</div>;
        return (
          <div>
            <h1>{t('products.show.title', 'Details')}</h1>
            <p>{t('products.show.price', { amount: 29.99 }, 'Price: {{amount}}')}</p>
            <button>{t('shared.ok', 'OK')}</button>
          </div>
        );
      }
    `);

    // Run analysis
    const analysis = walkAll({
      pages: ['src/pages/**/*.tsx'],
      rootDir: tmpDir,
      localesDir: 'locales',
      defaultLocale: 'en',
    });

    expect(analysis.routes).toHaveLength(1);
    expect(analysis.routes[0].keys.length).toBeGreaterThan(0);

    // Compile
    const outDir = path.join(tmpDir, '.i18n/compiled');
    compileAll(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en', 'bg'],
      defaultLocale: 'en',
      outDir,
      dictionaries: { global: { keys: ['shared'] } },
    });

    // Load and verify English compiled module (route + dictionary)
    const enRouteMap = parseCompiledModule(
      path.join(outDir, 'en', 'products.show.js'),
    );
    const enDictMap = parseCompiledModule(
      path.join(outDir, 'en', '_dict', 'global.js'),
    );
    // Merge dictionary + route into one map (simulates runtime loading both)
    const enMap = new Map([...enDictMap, ...enRouteMap]);
    setTranslations(enMap);

    expect(compiledTranslate('shared.ok')).toBe('OK');
    expect(compiledTranslate('products.show.title')).toBe('Product Details');
    expect(compiledTranslate('products.show.price', { amount: 29.99 })).toBe('Price: 29.99');
    expect(compiledHasKey('shared.ok')).toBe(true);

    // Route bundle should NOT contain dictionary keys (no duplication)
    expect(enRouteMap.has('shared.ok')).toBe(false);
    // Dictionary bundle SHOULD contain dictionary keys
    expect(enDictMap.has('shared.ok')).toBe(true);

    // Load and verify Bulgarian compiled module (route + dictionary)
    const bgRouteMap = parseCompiledModule(
      path.join(outDir, 'bg', 'products.show.js'),
    );
    const bgDictMap = parseCompiledModule(
      path.join(outDir, 'bg', '_dict', 'global.js'),
    );
    const bgMap = new Map([...bgDictMap, ...bgRouteMap]);
    setTranslations(bgMap);

    expect(compiledTranslate('shared.ok')).toBe('Добре');
    expect(compiledTranslate('products.show.title')).toBe('Детайли');
    expect(compiledTranslate('products.show.price', { amount: 29.99 })).toBe('Цена: 29.99');

    // Verify fallback pre-resolution: 'shared.loading' missing from bg locale,
    // should be resolved from en in the dictionary bundle
    expect(compiledTranslate('shared.loading')).toBe('Loading...'); // fallback from en
  });

  it('dictionary modules contain all dictionary namespace keys', () => {
    writeFile('locales/en/shared.json', JSON.stringify({
      ok: 'OK', cancel: 'Cancel',
    }));
    writeFile('locales/en/actions.json', JSON.stringify({
      save: 'Save', delete: 'Delete',
    }));

    const analysis: ProjectAnalysis = {
      routes: [],
      availableNamespaces: ['shared', 'actions'],
      allKeys: [],
      sharedNamespaces: ['shared'],
    };

    const outDir = path.join(tmpDir, '.i18n/compiled');
    compileAll(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en'],
      defaultLocale: 'en',
      outDir,
      dictionaries: { global: { keys: ['shared', 'actions'] } },
    });

    const dictMap = parseCompiledModule(path.join(outDir, 'en', '_dict', 'global.js'));
    setTranslations(dictMap);

    expect(compiledTranslate('shared.ok')).toBe('OK');
    expect(compiledTranslate('shared.cancel')).toBe('Cancel');
    expect(compiledTranslate('actions.save')).toBe('Save');
    expect(compiledTranslate('actions.delete')).toBe('Delete');
  });
});
