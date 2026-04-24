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
    expect(result.define).toHaveProperty('__VITE_I18N_DEV__', JSON.stringify(false));
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
        typesOutPath: 'src/core/i18n-generated.ts',
      },
    });

    expect(result.assetBundles).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(tmpDir, 'dist', '__i18n', 'en', '_dict', 'global.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'dist', '__i18n', 'en', 'products.index.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'dist', '__i18n', 'compiled', 'manifest.js'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.i18n', 'stats.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'src', 'core', 'i18n-generated.ts'))).toBe(true);

    const routeBundle = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'dist', '__i18n', 'en', 'products.index.json'), 'utf-8'),
    );
    expect(routeBundle).toEqual({
      products: { index: { heading: 'All Products' } },
    });

    const generatedTypes = fs.readFileSync(
      path.join(tmpDir, 'src', 'core', 'i18n-generated.ts'),
      'utf-8',
    );
    expect(generatedTypes).toContain(`'products.index': true;`);
    expect(generatedTypes).not.toContain(`'ProductsPage': true;`);
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
        typesOutPath: 'src/core/i18n-generated.ts',
      },
    });

    expect(result.warnings).toEqual([]);
  });

  it('writes scope-map.json next to the scope bundles with default page identifiers', () => {
    emitI18nBuildArtifacts({
      rootDir: tmpDir,
      viteOutDir: path.join(tmpDir, 'dist'),
      sharedConfig: {
        localesDir: 'locales',
        dictionaries: { global: { keys: ['shared'] } },
      },
      buildConfig: {
        pages: ['src/pages/**/*.tsx'],
        locales: ['en'],
        defaultLocale: 'en',
      },
    });

    const scopeMapPath = path.join(tmpDir, 'dist', '__i18n', 'scope-map.json');
    expect(fs.existsSync(scopeMapPath)).toBe(true);

    const map = JSON.parse(fs.readFileSync(scopeMapPath, 'utf-8'));
    expect(map.version).toBe(1);
    expect(map.defaultLocale).toBe('en');
    // `src/pages/ProductsPage.tsx` → `ProductsPage` via defaultPageIdentifier
    // (no `src/pages/` prefix stripping since there's no subdirectory).
    expect(map.pages['ProductsPage']).toBeDefined();
    expect(map.pages['ProductsPage'].scopes).toContain('products.index');
    expect(map.pages['ProductsPage'].dictionaries).toEqual(['global']);
  });

  it('skips scope-map.json when emitReports is false', () => {
    emitI18nBuildArtifacts({
      rootDir: tmpDir,
      viteOutDir: path.join(tmpDir, 'dist'),
      sharedConfig: { localesDir: 'locales' },
      buildConfig: {
        pages: ['src/pages/**/*.tsx'],
        locales: ['en'],
        defaultLocale: 'en',
        emitReports: false,
      },
    });

    const scopeMapPath = path.join(tmpDir, 'dist', '__i18n', 'scope-map.json');
    expect(fs.existsSync(scopeMapPath)).toBe(false);
  });

  it('emitI18nBuildArtifacts wrapper applies bundling.dynamicKeys (parity with plugin)', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'locales/en/status.json'),
      JSON.stringify({ active: 'Active', pending: 'Pending', failed: 'Failed' }),
    );
    // A page under the status namespace — the dynamic keys flow in via
    // applyDynamicKeys triggered from runProjectAnalysis.
    fs.writeFileSync(
      path.join(tmpDir, 'src/pages/StatusPage.tsx'),
      [
        "import { useI18n } from 'vite-bundled-i18n/react';",
        'export function StatusPage() {',
        "  const { t } = useI18n('status.dashboard');",
        "  return <div>{t.dynamic('status.' + 'active')}</div>;",
        '}',
      ].join('\n'),
    );

    emitI18nBuildArtifacts({
      rootDir: tmpDir,
      viteOutDir: path.join(tmpDir, 'dist'),
      sharedConfig: {
        localesDir: 'locales',
        bundling: { dynamicKeys: ['status.active', 'status.pending'] },
      },
      buildConfig: {
        pages: ['src/pages/**/*.tsx'],
        locales: ['en'],
        defaultLocale: 'en',
      },
    });

    // Scope bundle for status.dashboard must include the dynamic keys.
    const bundlePath = path.join(tmpDir, 'dist', '__i18n', 'en', 'status.dashboard.json');
    expect(fs.existsSync(bundlePath)).toBe(true);
    const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));
    expect(bundle.status).toBeDefined();
    expect(bundle.status.active).toBe('Active');
    expect(bundle.status.pending).toBe('Pending');
    // failed was NOT in dynamicKeys, NOT statically referenced — still tree-shaken
    expect(bundle.status.failed).toBeUndefined();
  });

  it('honors a custom pageIdentifier', () => {
    emitI18nBuildArtifacts({
      rootDir: tmpDir,
      viteOutDir: path.join(tmpDir, 'dist'),
      sharedConfig: { localesDir: 'locales' },
      buildConfig: {
        pages: ['src/pages/**/*.tsx'],
        locales: ['en'],
        defaultLocale: 'en',
        pageIdentifier: (abs) => `custom:${path.basename(abs, '.tsx')}`,
      },
    });

    const map = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'dist', '__i18n', 'scope-map.json'), 'utf-8'),
    );
    expect(Object.keys(map.pages)).toEqual(['custom:ProductsPage']);
  });
});
