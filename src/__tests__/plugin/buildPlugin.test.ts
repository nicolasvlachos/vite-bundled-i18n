import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emitI18nBuildArtifacts } from '../../plugin';
import { i18nBuildPlugin } from '../../plugin/buildPlugin';
import type { UserConfig } from 'vite';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-plugin-build-'));

  fs.mkdirSync(path.join(tmpDir, 'locales/en'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'locales/bg'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'locales/en/shared.json'),
    JSON.stringify({ ok: 'OK', loading: 'Loading...' }),
  );
  fs.writeFileSync(
    path.join(tmpDir, 'locales/en/products.json'),
    JSON.stringify({
      index: { heading: 'All Products' },
      show: { title: 'Product Details', price: 'Price: {{amount}}' },
    }),
  );
  fs.writeFileSync(
    path.join(tmpDir, 'locales/bg/shared.json'),
    JSON.stringify({ ok: 'Добре' }),
  );
  fs.writeFileSync(
    path.join(tmpDir, 'locales/bg/products.json'),
    JSON.stringify({
      index: { heading: 'Всички продукти' },
      show: { title: 'Детайли', price: 'Цена: {{amount}}' },
    }),
  );

  fs.mkdirSync(path.join(tmpDir, 'src/pages'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'src/pages/ProductsPage.tsx'),
    `
      import { useI18n } from 'vite-bundled-i18n/react';

      export function ProductsPage() {
        const { t, ready } = useI18n('products.index');
        if (!ready) return <div>{t('shared.loading', 'Loading...')}</div>;
        return <h1>{t('products.index.heading', 'All Products')}</h1>;
      }
    `,
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('i18nBuildPlugin config hook', () => {
  it('injects __VITE_I18N_BASE__ with default base', () => {
    const plugin = i18nBuildPlugin(
      { localesDir: 'locales' },
      { pages: [], locales: ['en'], defaultLocale: 'en' },
    );
    const configHook = plugin.config as (config: UserConfig) => UserConfig;
    const result = configHook({});
    expect(result.define).toHaveProperty('__VITE_I18N_BASE__', JSON.stringify('/__i18n'));
  });

  it('injects __VITE_I18N_BASE__ with custom Vite base', () => {
    const plugin = i18nBuildPlugin(
      { localesDir: 'locales' },
      { pages: [], locales: ['en'], defaultLocale: 'en' },
    );
    const configHook = plugin.config as (config: UserConfig) => UserConfig;
    const result = configHook({ base: '/build/' });
    expect(result.define).toHaveProperty('__VITE_I18N_BASE__', JSON.stringify('/build/__i18n'));
  });

  it('injects __VITE_I18N_BASE__ with custom assetsDir', () => {
    const plugin = i18nBuildPlugin(
      { localesDir: 'locales' },
      { pages: [], locales: ['en'], defaultLocale: 'en', assetsDir: 'translations' },
    );
    const configHook = plugin.config as (config: UserConfig) => UserConfig;
    const result = configHook({ base: '/app/' });
    expect(result.define).toHaveProperty('__VITE_I18N_BASE__', JSON.stringify('/app/translations'));
  });

  it('still injects __VITE_I18N_COMPILED_MANIFEST__', () => {
    const plugin = i18nBuildPlugin(
      { localesDir: 'locales' },
      { pages: [], locales: ['en'], defaultLocale: 'en' },
    );
    const configHook = plugin.config as (config: UserConfig) => UserConfig;
    const result = configHook({});
    expect(result.define).toHaveProperty('__VITE_I18N_COMPILED_MANIFEST__');
  });
});

describe('emitI18nBuildArtifacts', () => {
  it('writes production i18n assets and generated artifacts from one build pass', () => {
    const result = emitI18nBuildArtifacts({
      rootDir: tmpDir,
      viteOutDir: path.join(tmpDir, 'dist'),
      sharedConfig: {
        localesDir: 'locales',
        dictionaries: {
          global: { keys: ['shared'], pinned: true },
        },
      },
      buildConfig: {
        pages: ['src/pages/**/*.tsx'],
        locales: ['en', 'bg'],
        defaultLocale: 'en',
        generatedOutDir: '.i18n',
        typesOutPath: 'src/i18n-types.d.ts',
      },
    });

    expect(result.assetBundles).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(tmpDir, 'dist', '__i18n', 'en', '_dict', 'global.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'dist', '__i18n', 'en', 'products.index.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'dist', '__i18n', 'compiled', 'manifest.js'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.i18n', 'stats.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'src', 'i18n-types.d.ts'))).toBe(true);

    const routeBundle = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'dist', '__i18n', 'en', 'products.index.json'), 'utf-8'),
    );
    expect(routeBundle).toEqual({
      products: { index: { heading: 'All Products' } },
    });
  });

  it('returns warnings when extracted keys exist but no keys match translations', () => {
    // Create a locale directory with no JSON files (empty locale dir)
    const emptyTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-plugin-warn-'));
    fs.mkdirSync(path.join(emptyTmpDir, 'locales/en'), { recursive: true });
    fs.mkdirSync(path.join(emptyTmpDir, 'src/pages'), { recursive: true });
    fs.writeFileSync(
      path.join(emptyTmpDir, 'src/pages/Page.tsx'),
      `
        import { useI18n } from 'vite-bundled-i18n/react';
        export function Page() {
          const { t } = useI18n('common');
          return <h1>{t('common.hello', 'Hello')}</h1>;
        }
      `,
    );

    try {
      const result = emitI18nBuildArtifacts({
        rootDir: emptyTmpDir,
        viteOutDir: path.join(emptyTmpDir, 'dist'),
        sharedConfig: { localesDir: 'locales' },
        buildConfig: {
          pages: ['src/pages/**/*.tsx'],
          locales: ['en'],
          defaultLocale: 'en',
        },
      });

      expect(result.warnings).toBeDefined();
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('0 of');
      expect(result.warnings[0]).toContain('extracted keys found in translation files');
      expect(result.warnings[0]).toContain('No JSON files found');
    } finally {
      fs.rmSync(emptyTmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty warnings array when keys match normally', () => {
    const result = emitI18nBuildArtifacts({
      rootDir: tmpDir,
      viteOutDir: path.join(tmpDir, 'dist'),
      sharedConfig: {
        localesDir: 'locales',
        dictionaries: {
          global: { keys: ['shared'], pinned: true },
        },
      },
      buildConfig: {
        pages: ['src/pages/**/*.tsx'],
        locales: ['en', 'bg'],
        defaultLocale: 'en',
        generatedOutDir: '.i18n',
        typesOutPath: 'src/i18n-types.d.ts',
      },
    });

    expect(result.warnings).toEqual([]);
  });
});
