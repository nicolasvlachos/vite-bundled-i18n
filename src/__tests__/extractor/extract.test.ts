import { describe, it, expect } from 'vitest';
import { extractKeys } from '../../extractor/extract';

describe('extractKeys', () => {
  it('extracts keys from a simple component with useI18n', () => {
    const result = extractKeys(`
      import { useI18n } from 'vite-bundled-i18n/react';
      function ProductPage() {
        const { t, ready } = useI18n('products.show');
        if (!ready) return null;
        return <h1>{t('products.show.title', 'Details')}</h1>;
      }
    `);
    expect(result.scopes).toEqual(['products.show']);
    expect(result.keys).toHaveLength(1);
    expect(result.keys[0].key).toBe('products.show.title');
    expect(result.keys[0].fallback).toBe('Details');
    expect(result.keys[0].dynamic).toBe(false);
    expect(result.imports).toContain('vite-bundled-i18n/react');
  });

  it('extracts keys from global t import', () => {
    const result = extractKeys(`
      import { t } from 'vite-bundled-i18n';
      const label = t('shared.ok', 'OK');
    `);
    expect(result.keys).toHaveLength(1);
    expect(result.keys[0].key).toBe('shared.ok');
    expect(result.imports).toContain('vite-bundled-i18n');
  });

  it('skips global t in scoped mode', () => {
    const result = extractKeys(`
      import { t } from 'vite-bundled-i18n';
      t('shared.ok');
    `, { scope: 'scoped' });
    expect(result.keys).toHaveLength(0);
  });

  it('extracts multiple keys and scopes', () => {
    const result = extractKeys(`
      import { useI18n } from 'vite-bundled-i18n/react';
      function Page() {
        const { t } = useI18n('products.index');
        t('products.index.heading', 'All Products');
        t('products.index.subheading', { count: 5 }, 'Browse {{count}} items');
        t('shared.ok', 'OK');
      }
    `);
    expect(result.scopes).toEqual(['products.index']);
    expect(result.keys).toHaveLength(3);
    expect(result.keys[0]).toMatchObject({ key: 'products.index.heading', fallback: 'All Products' });
    expect(result.keys[1]).toMatchObject({ key: 'products.index.subheading', fallback: 'Browse {{count}} items' });
    expect(result.keys[2]).toMatchObject({ key: 'shared.ok', fallback: 'OK' });
  });

  it('handles dynamic keys', () => {
    const result = extractKeys(`
      import { t } from 'vite-bundled-i18n';
      t(\`products.\${type}.title\`);
      t(keyVariable);
    `);
    expect(result.keys).toHaveLength(2);
    expect(result.keys[0]).toMatchObject({ dynamic: true, staticPrefix: 'products' });
    expect(result.keys[1]).toMatchObject({ dynamic: true, staticPrefix: undefined });
  });

  it('collects imports excluding type-only', () => {
    const result = extractKeys(`
      import { useI18n } from 'vite-bundled-i18n/react';
      import { Header } from './components/Header';
      import type { Props } from './types';
      function Page() {
        const { t } = useI18n();
        t('shared.ok');
      }
    `);
    expect(result.imports).toEqual(['vite-bundled-i18n/react', './components/Header']);
  });

  it('returns empty result for files with no translations', () => {
    const result = extractKeys(`
      function NotATranslation() {
        return <div>Hello</div>;
      }
    `);
    expect(result.scopes).toEqual([]);
    expect(result.keys).toEqual([]);
  });

  it('returns empty result for empty source', () => {
    const result = extractKeys('');
    expect(result.keys).toEqual([]);
  });

  it('handles a realistic component with nested children', () => {
    const result = extractKeys(`
      import { useI18n } from 'vite-bundled-i18n/react';
      import { SearchBar } from '../components/SearchBar';
      import { ProductCard } from '../components/ProductCard';
      export function ProductsPage() {
        const { t, ready } = useI18n('products.index');
        if (!ready) return <div>{t('shared.loading', 'Loading...')}</div>;
        return (
          <div>
            <h1>{t('products.index.heading', 'All Products')}</h1>
            <p>{t('products.index.subheading', { count: 3 }, 'Browse {{count}} items')}</p>
            <SearchBar />
            <button>{t('actions.addToCart', 'Add to cart')}</button>
          </div>
        );
      }
    `);
    expect(result.scopes).toEqual(['products.index']);
    expect(result.keys).toHaveLength(4);
    expect(result.keys.map(k => k.key)).toEqual([
      'shared.loading',
      'products.index.heading',
      'products.index.subheading',
      'actions.addToCart',
    ]);
    expect(result.imports).toContain('../components/SearchBar');
    expect(result.imports).toContain('../components/ProductCard');
  });

  it('sets filePath from options', () => {
    const result = extractKeys('const x = 1;', { filePath: 'src/pages/Home.tsx' });
    expect(result.filePath).toBe('src/pages/Home.tsx');
  });

  it('extracts keys from shallow literal constants and data key fields', () => {
    const result = extractKeys(`
      import { t } from 'vite-bundled-i18n';
      const homeKey = 'global.nav.home';
      const nav = [
        { href: '/', labelKey: homeKey },
        { href: '/cart', titleKey: 'global.nav.cart' },
      ];
      t(homeKey);
    `);

    expect(result.keys.map((key) => key.key)).toEqual([
      'global.nav.home',
      'global.nav.cart',
      'global.nav.home',
    ]);
  });

  it('extracts keys from defineI18nData + i18nKey helper usage', () => {
    const result = extractKeys(`
      import { defineI18nData, i18nKey } from 'vite-bundled-i18n';
      export const nav = defineI18nData([
        { href: '/', key: i18nKey('global.nav.home') },
        { href: '/cart', key: i18nKey('global.nav.cart') },
      ]);
    `);

    expect(result.keys.map((key) => key.key)).toEqual([
      'global.nav.home',
      'global.nav.cart',
    ]);
  });

  it('extracts scopes and keys from custom hookSources', () => {
    const result = extractKeys(`
      import { useI18n } from '@/hooks/use-page-i18n-scope';
      function QuizzesPage() {
        const { t, ready } = useI18n('quizzes.index');
        if (!ready) return null;
        return <h1>{t('quizzes.index.title', 'Quizzes')}</h1>;
      }
    `, {
      hookSources: ['@/hooks/use-page-i18n-scope'],
    });
    expect(result.scopes).toEqual(['quizzes.index']);
    expect(result.keys).toHaveLength(1);
    expect(result.keys[0].key).toBe('quizzes.index.title');
  });

  it('does not extract scopes from unknown imports without hookSources', () => {
    const result = extractKeys(`
      import { useI18n } from '@/hooks/use-page-i18n-scope';
      function QuizzesPage() {
        const { t } = useI18n('quizzes.index');
        return <h1>{t('quizzes.index.title')}</h1>;
      }
    `);
    // Without hookSources, the custom import is not recognized
    expect(result.scopes).toEqual([]);
    // t() is still picked up by the untracked callee fallback (global mode)
    expect(result.keys).toHaveLength(1);
  });
});
