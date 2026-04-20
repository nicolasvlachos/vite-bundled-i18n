import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  resolveImport,
  deriveRouteId,
  discoverNamespaces,
  walkRoute,
} from '../../extractor/walker';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-walker-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relativePath: string, content: string) {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  return fullPath;
}

describe('resolveImport', () => {
  it('resolves a relative .tsx import', () => {
    writeFile('src/components/Header.tsx', 'export function Header() {}');
    const from = path.join(tmpDir, 'src/App.tsx');
    const result = resolveImport('./components/Header', from);
    expect(result).toBe(path.join(tmpDir, 'src/components/Header.tsx'));
  });

  it('resolves a relative .ts import', () => {
    writeFile('src/utils/helpers.ts', 'export const x = 1;');
    const from = path.join(tmpDir, 'src/App.tsx');
    const result = resolveImport('./utils/helpers', from);
    expect(result).toBe(path.join(tmpDir, 'src/utils/helpers.ts'));
  });

  it('resolves index files', () => {
    writeFile('src/components/index.tsx', 'export function C() {}');
    const from = path.join(tmpDir, 'src/App.tsx');
    const result = resolveImport('./components', from);
    expect(result).toBe(path.join(tmpDir, 'src/components/index.tsx'));
  });

  it('returns undefined for package imports', () => {
    const from = path.join(tmpDir, 'src/App.tsx');
    expect(resolveImport('react', from)).toBeUndefined();
    expect(resolveImport('vite-bundled-i18n', from)).toBeUndefined();
  });

  it('resolves tsconfig path aliases', () => {
    writeFile('tsconfig.app.json', JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '@/*': ['src/*'],
        },
      },
    }));
    writeFile('src/components/Header.tsx', 'export function Header() {}');
    const from = path.join(tmpDir, 'src/App.tsx');
    const result = resolveImport('@/components/Header', from, tmpDir);
    expect(result).toBe(path.join(tmpDir, 'src/components/Header.tsx'));
  });

  it('returns undefined for unresolvable imports', () => {
    const from = path.join(tmpDir, 'src/App.tsx');
    expect(resolveImport('./nonexistent', from)).toBeUndefined();
  });
});

describe('deriveRouteId', () => {
  it('derives route id from entry point', () => {
    expect(
      deriveRouteId('/project/src/pages/products/index.tsx', '/project'),
    ).toBe('products/index');
  });

  it('handles nested routes', () => {
    expect(
      deriveRouteId('/project/src/pages/admin/users/list.tsx', '/project'),
    ).toBe('admin/users/list');
  });

  it('handles root page', () => {
    expect(deriveRouteId('/project/src/pages/index.tsx', '/project')).toBe(
      'index',
    );
  });

  it('handles non-pages paths gracefully', () => {
    expect(deriveRouteId('/project/src/views/Home.tsx', '/project')).toBe(
      'src/views/Home',
    );
  });
});

describe('discoverNamespaces', () => {
  it('discovers namespace files from locale directory', () => {
    writeFile('locales/en/shared.json', '{}');
    writeFile('locales/en/products.json', '{}');
    writeFile('locales/en/global.json', '{}');
    const result = discoverNamespaces(path.join(tmpDir, 'locales'), 'en');
    expect(result.sort()).toEqual(['global', 'products', 'shared']);
  });

  it('returns empty array for missing directory', () => {
    expect(
      discoverNamespaces(path.join(tmpDir, 'nonexistent'), 'en'),
    ).toEqual([]);
  });
});

describe('walkRoute', () => {
  it('walks a single file and extracts keys', () => {
    const entry = writeFile(
      'src/pages/Home.tsx',
      `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function Home() {
        const { t } = useI18n();
        return <h1>{t('shared.ok', 'OK')}</h1>;
      }
    `,
    );

    const result = walkRoute(entry, {
      rootDir: tmpDir,
      extractionScope: 'global',
    });
    expect(result.keys).toHaveLength(1);
    expect(result.keys[0].key).toBe('shared.ok');
    expect(result.files).toContain(entry);
  });

  it('follows imports and extracts keys from the full tree', () => {
    writeFile(
      'src/components/Header.tsx',
      `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function Header() {
        const { t } = useI18n();
        return <header>{t('global.appName', 'Store')}</header>;
      }
    `,
    );

    const entry = writeFile(
      'src/pages/Home.tsx',
      `
      import { useI18n } from 'vite-bundled-i18n/react';
      import { Header } from '../components/Header';
      export function Home() {
        const { t } = useI18n('home');
        return <div><Header /><h1>{t('home.title', 'Welcome')}</h1></div>;
      }
    `,
    );

    const result = walkRoute(entry, {
      rootDir: tmpDir,
      extractionScope: 'global',
    });
    expect(result.keys).toHaveLength(2);
    expect(result.keys.map((k) => k.key).sort()).toEqual([
      'global.appName',
      'home.title',
    ]);
    expect(result.scopes).toContain('home');
    expect(result.files).toHaveLength(2);
  });

  it('handles circular imports without infinite loop', () => {
    writeFile(
      'src/a.tsx',
      `
      import { useI18n } from 'vite-bundled-i18n/react';
      import { B } from './b';
      export function A() {
        const { t } = useI18n();
        return <B>{t('shared.a', 'A')}</B>;
      }
    `,
    );
    writeFile(
      'src/b.tsx',
      `
      import { useI18n } from 'vite-bundled-i18n/react';
      import { A } from './a';
      export function B({ children }: any) {
        const { t } = useI18n();
        return <div>{t('shared.b', 'B')}{children}</div>;
      }
    `,
    );

    const entry = path.join(tmpDir, 'src/a.tsx');
    const result = walkRoute(entry, {
      rootDir: tmpDir,
      extractionScope: 'global',
    });
    expect(result.keys).toHaveLength(2);
    expect(result.keys.map((k) => k.key).sort()).toEqual([
      'shared.a',
      'shared.b',
    ]);
  });

  it('deduplicates keys from multiple files using the same key', () => {
    writeFile(
      'src/components/Footer.tsx',
      `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function Footer() {
        const { t } = useI18n();
        return <footer>{t('shared.ok', 'OK')}</footer>;
      }
    `,
    );

    const entry = writeFile(
      'src/pages/Home.tsx',
      `
      import { useI18n } from 'vite-bundled-i18n/react';
      import { Footer } from '../components/Footer';
      export function Home() {
        const { t } = useI18n();
        return <div>{t('shared.ok', 'OK')}<Footer /></div>;
      }
    `,
    );

    const result = walkRoute(entry, {
      rootDir: tmpDir,
      extractionScope: 'global',
    });
    // shared.ok appears in both files but should be deduplicated
    expect(result.keys.filter((k) => k.key === 'shared.ok')).toHaveLength(1);
  });

  it('follows tsconfig path alias imports in the route tree', () => {
    writeFile('tsconfig.app.json', JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '@/*': ['src/*'],
        },
      },
    }));

    writeFile(
      'src/components/Header.tsx',
      `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function Header() {
        const { t } = useI18n();
        return <header>{t('global.appName', 'Store')}</header>;
      }
    `,
    );

    const entry = writeFile(
      'src/pages/Home.tsx',
      `
      import { Header } from '@/components/Header';
      export function Home() {
        return <Header />;
      }
    `,
    );

    const result = walkRoute(entry, {
      rootDir: tmpDir,
      extractionScope: 'global',
    });

    expect(result.keys.map((k) => k.key)).toContain('global.appName');
    expect(result.files).toContain(path.join(tmpDir, 'src/components/Header.tsx'));
  });
});
