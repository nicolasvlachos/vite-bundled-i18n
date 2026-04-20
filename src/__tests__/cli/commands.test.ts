import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { analyze, generate, report } from '../../cli/commands';
import type { CliConfig } from '../../cli/commands';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-cli-'));

  // Create locale files
  fs.mkdirSync(path.join(tmpDir, 'locales/en'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'locales/en/shared.json'),
    JSON.stringify({
      ok: 'OK',
      cancel: 'Cancel',
      loading: 'Loading...',
    }),
  );
  fs.writeFileSync(
    path.join(tmpDir, 'locales/en/products.json'),
    JSON.stringify({
      show: { title: 'Product Details', price: 'Price: {{amount}}' },
      index: { heading: 'All Products' },
    }),
  );

  // Create source files
  fs.mkdirSync(path.join(tmpDir, 'src/pages'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'src/components'), { recursive: true });

  fs.writeFileSync(
    path.join(tmpDir, 'src/components/Header.tsx'),
    `
    import { useI18n } from 'vite-bundled-i18n/react';
    export function Header() {
      const { t } = useI18n();
      return <header>{t('shared.ok', 'OK')}</header>;
    }
  `,
  );

  fs.writeFileSync(
    path.join(tmpDir, 'src/pages/ProductsPage.tsx'),
    `
    import { useI18n } from 'vite-bundled-i18n/react';
    import { Header } from '../components/Header';
    export function ProductsPage() {
      const { t, ready } = useI18n('products.index');
      if (!ready) return <div>{t('shared.loading', 'Loading...')}</div>;
      return <div><Header /><h1>{t('products.index.heading', 'All')}</h1></div>;
    }
  `,
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeConfig(overrides?: Partial<CliConfig>): CliConfig {
  return {
    pages: ['src/pages/**/*.tsx'],
    localesDir: 'locales',
    locales: ['en'],
    defaultLocale: 'en',
    rootDir: tmpDir,
    outDir: path.join(tmpDir, '.i18n'),
    typesOutPath: path.join(tmpDir, 'src/i18n-types.d.ts'),
    ...overrides,
  };
}

describe('analyze', () => {
  it('returns project analysis with routes and keys', () => {
    const result = analyze(makeConfig());
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].routeId).toContain('ProductsPage');
    expect(result.routes[0].keys.length).toBeGreaterThan(0);
    expect(result.availableNamespaces).toContain('shared');
    expect(result.availableNamespaces).toContain('products');
  });
});

describe('generate', () => {
  it('generates bundle files and types', () => {
    const config = makeConfig();
    generate(config);

    // Check bundles exist
    const bundleDir = path.join(config.outDir!, 'en');
    expect(fs.existsSync(bundleDir)).toBe(true);

    // Check types file exists
    expect(fs.existsSync(config.typesOutPath!)).toBe(true);
    const typesContent = fs.readFileSync(config.typesOutPath!, 'utf-8');
    expect(typesContent).toContain('TranslationKey');
  });
});

describe('report', () => {
  it('generates report files', () => {
    const config = makeConfig();
    report(config);

    const outDir = config.outDir!;
    expect(fs.existsSync(path.join(outDir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'missing.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'unused.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'stats.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'ownership.json'))).toBe(true);

    const stats = JSON.parse(
      fs.readFileSync(path.join(outDir, 'stats.json'), 'utf-8'),
    );
    expect(stats.routes).toBe(1);
    expect(stats.totalKeysInCode).toBeGreaterThan(0);
  });
});
