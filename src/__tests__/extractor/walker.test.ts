import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  resolveImport,
  deriveRouteId,
  discoverNamespaces,
  walkRoute,
} from '../../extractor/walker';
import { createExtractionCache } from '../../extractor/extraction-cache';
import * as extractModule from '../../extractor/extract';

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

describe('walkRoute — scope registration patterns', () => {
  it('aggregates scopes declared by child components (pattern B)', () => {
    // Entry file composes children; children declare scopes.
    writeFile(
      'src/components/Sidebar.tsx',
      `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function Sidebar() {
        const { t } = useI18n('sidebar.admin');
        return <nav>{t('sidebar.admin.heading', 'Admin')}</nav>;
      }
    `,
    );
    writeFile(
      'src/components/MainContent.tsx',
      `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function MainContent() {
        // No scope argument — just reads from the already-loaded cache.
        const { t } = useI18n();
        return <main>{t('sidebar.admin.welcome', 'Welcome')}</main>;
      }
    `,
    );
    const entry = writeFile(
      'src/pages/Admin.tsx',
      `
      import { Sidebar } from '../components/Sidebar';
      import { MainContent } from '../components/MainContent';
      export function Admin() {
        // Entry itself composes — never calls useI18n with a scope literal.
        return <><Sidebar /><MainContent /></>;
      }
    `,
    );

    const result = walkRoute(entry, {
      rootDir: tmpDir,
      extractionScope: 'global',
    });

    // route.scopes aggregates across the graph — the child's scope counts.
    expect(result.scopes).toContain('sidebar.admin');
    // route.entryScopes stays empty — the entry file never declared a scope.
    expect(result.entryScopes).toEqual([]);
    // Both patterns coexist: a child using useI18n() (no args) still
    // contributes extracted keys to the route.
    expect(result.keys.map((k) => k.key).sort()).toEqual([
      'sidebar.admin.heading',
      'sidebar.admin.welcome',
    ]);
  });

  it('captures entryScopes only when the entry file itself declares a scope (pattern A)', () => {
    writeFile(
      'src/components/Details.tsx',
      `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function Details() {
        const { t } = useI18n();
        return <div>{t('products.show.price', '$0')}</div>;
      }
    `,
    );
    const entry = writeFile(
      'src/pages/ProductsShow.tsx',
      `
      import { useI18n } from 'vite-bundled-i18n/react';
      import { Details } from '../components/Details';
      export function ProductsShow() {
        const { t } = useI18n('products.show');
        return <section>{t('products.show.title', 'Product')}<Details /></section>;
      }
    `,
    );

    const result = walkRoute(entry, {
      rootDir: tmpDir,
      extractionScope: 'global',
    });

    expect(result.scopes).toContain('products.show');
    expect(result.entryScopes).toEqual(['products.show']);
  });
});

describe('walkRoute with ExtractionCache', () => {
  function makeCache() {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-walker-cache-'));
    return {
      cache: createExtractionCache({
        dir: cacheDir,
        pluginVersion: '0.4.1',
        configHash: 'test',
      }),
      cacheDir,
    };
  }

  it('populates the cache on a cold walk', () => {
    const entry = writeFile(
      'src/pages/Home.tsx',
      `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function Home() {
        const { t } = useI18n('home');
        return <h1>{t('home.title', 'Welcome')}</h1>;
      }
    `,
    );
    const { cache, cacheDir } = makeCache();

    walkRoute(entry, {
      rootDir: tmpDir,
      extractionScope: 'global',
      cache,
    });

    expect(cache.size()).toBe(1);
    const entryCache = cache.get(entry);
    expect(entryCache?.keys.map((k) => k.key)).toContain('home.title');
    expect(entryCache?.scopes).toContain('home');
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('skips the AST parse on a warm walk with unchanged mtime/size', () => {
    const entry = writeFile(
      'src/pages/Home.tsx',
      `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function Home() {
        const { t } = useI18n('home');
        return <h1>{t('home.title', 'Welcome')}</h1>;
      }
    `,
    );
    const { cache, cacheDir } = makeCache();

    // Cold walk populates the cache.
    walkRoute(entry, {
      rootDir: tmpDir,
      extractionScope: 'global',
      cache,
    });

    // Warm walk — spy on extractKeys and verify it's not called for the entry.
    const extractSpy = vi.spyOn(extractModule, 'extractKeys');
    const warm = walkRoute(entry, {
      rootDir: tmpDir,
      extractionScope: 'global',
      cache,
    });

    expect(extractSpy).not.toHaveBeenCalled();
    expect(warm.keys.map((k) => k.key)).toContain('home.title');
    expect(warm.scopes).toContain('home');

    extractSpy.mockRestore();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('re-parses a file when its mtime changes', () => {
    const entry = writeFile(
      'src/pages/Home.tsx',
      "export function Home() { return null; }",
    );
    const { cache, cacheDir } = makeCache();

    walkRoute(entry, { rootDir: tmpDir, extractionScope: 'global', cache });

    // Touch the file so mtime advances.
    const later = Date.now() + 5_000;
    fs.utimesSync(entry, later / 1000, later / 1000);
    fs.writeFileSync(
      entry,
      `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function Home() {
        const { t } = useI18n('home');
        return <h1>{t('home.title', 'Welcome')}</h1>;
      }
    `,
    );

    const extractSpy = vi.spyOn(extractModule, 'extractKeys');
    const warm = walkRoute(entry, {
      rootDir: tmpDir,
      extractionScope: 'global',
      cache,
    });

    expect(extractSpy).toHaveBeenCalledTimes(1);
    expect(warm.keys.map((k) => k.key)).toContain('home.title');
    extractSpy.mockRestore();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('follows cached import paths without re-resolving', () => {
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
      import { Header } from '../components/Header';
      export function Home() { return <Header />; }
    `,
    );
    const { cache, cacheDir } = makeCache();

    walkRoute(entry, { rootDir: tmpDir, extractionScope: 'global', cache });

    const extractSpy = vi.spyOn(extractModule, 'extractKeys');
    const warm = walkRoute(entry, { rootDir: tmpDir, extractionScope: 'global', cache });

    expect(extractSpy).not.toHaveBeenCalled();
    expect(warm.keys.map((k) => k.key)).toContain('global.appName');
    expect(warm.files).toHaveLength(2);
    extractSpy.mockRestore();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });
});
