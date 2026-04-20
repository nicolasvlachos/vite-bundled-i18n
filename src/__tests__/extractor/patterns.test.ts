import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { findTranslationCalls, extractScopes } from '../../extractor/patterns';
import type { ExtractionOptions } from '../../extractor/types';

function parse(source: string) {
  return ts.createSourceFile('test.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

const globalOpts: ExtractionOptions = { scope: 'global', filePath: 'test.tsx' };
const scopedOpts: ExtractionOptions = { scope: 'scoped', filePath: 'test.tsx' };

describe('findTranslationCalls', () => {
  it('finds t() from global import', () => {
    const sf = parse("import { t } from 'vite-bundled-i18n';\nconst x = t('shared.ok', 'OK');");
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('shared.ok');
    expect(calls[0].fallback).toBe('OK');
    expect(calls[0].dynamic).toBe(false);
  });

  it('finds renamed global t import', () => {
    const sf = parse("import { t as translate } from 'vite-bundled-i18n';\ntranslate('shared.ok');");
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('shared.ok');
  });

  it('skips global t in scoped mode', () => {
    const sf = parse("import { t } from 'vite-bundled-i18n';\nt('shared.ok');");
    const calls = findTranslationCalls(sf, scopedOpts);
    expect(calls).toHaveLength(0);
  });

  it('finds t from useI18n() destructuring', () => {
    const sf = parse("import { useI18n } from 'vite-bundled-i18n/react';\nfunction Page() {\n  const { t } = useI18n('products.show');\n  return t('products.show.title', 'Details');\n}");
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('products.show.title');
    expect(calls[0].fallback).toBe('Details');
  });

  it('finds renamed t from useI18n', () => {
    const sf = parse("import { useI18n } from 'vite-bundled-i18n/react';\nfunction Page() {\n  const { t: tProducts } = useI18n('products.show');\n  tProducts('products.show.title');\n}");
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('products.show.title');
  });

  it('extracts fallback with params (third arg)', () => {
    const sf = parse("import { useI18n } from 'vite-bundled-i18n/react';\nfunction Page() {\n  const { t } = useI18n();\n  t('products.show.price', { amount: 29.99 }, 'Price: {{amount}}');\n}");
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('products.show.price');
    expect(calls[0].fallback).toBe('Price: {{amount}}');
  });

  it('detects dynamic template literal keys', () => {
    const sf = parse("import { t } from 'vite-bundled-i18n';\nt(`products.${type}.title`);");
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls).toHaveLength(1);
    expect(calls[0].dynamic).toBe(true);
    expect(calls[0].staticPrefix).toBe('products');
  });

  it('detects dynamic concatenation keys', () => {
    const sf = parse("import { t } from 'vite-bundled-i18n';\nt('products.' + category + '.name');");
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls).toHaveLength(1);
    expect(calls[0].dynamic).toBe(true);
    expect(calls[0].staticPrefix).toBe('products');
  });

  it('detects fully dynamic keys', () => {
    const sf = parse("import { t } from 'vite-bundled-i18n';\nt(keyVariable);");
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls).toHaveLength(1);
    expect(calls[0].dynamic).toBe(true);
    expect(calls[0].staticPrefix).toBeUndefined();
  });

  it('finds multiple t calls in one file', () => {
    const sf = parse("import { useI18n } from 'vite-bundled-i18n/react';\nfunction Page() {\n  const { t } = useI18n();\n  t('shared.ok');\n  t('shared.cancel');\n  t('actions.save');\n}");
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls).toHaveLength(3);
    expect(calls.map(c => c.key)).toEqual(['shared.ok', 'shared.cancel', 'actions.save']);
  });

  it('handles both global t and useI18n t in same file', () => {
    const sf = parse("import { t } from 'vite-bundled-i18n';\nimport { useI18n } from 'vite-bundled-i18n/react';\nconst x = t('global.appName');\nfunction Page() {\n  const { t: tLocal } = useI18n();\n  tLocal('shared.ok');\n}");
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls).toHaveLength(2);
  });

  it('ignores t identifiers not from our package', () => {
    const sf = parse("import { t } from 'other-library';\nt('some.key');");
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls).toHaveLength(0);
  });

  it('ignores t variables not from useI18n', () => {
    const sf = parse("const t = (x: string) => x;\nt('some.key');");
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls).toHaveLength(0);
  });

  it('resolves shallow string-literal constants passed to t()', () => {
    const sf = parse("import { t } from 'vite-bundled-i18n';\nconst homeKey = 'global.nav.home';\nt(homeKey);");
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('global.nav.home');
    expect(calls[0].dynamic).toBe(false);
  });

  it('extracts translation key fields from object literals', () => {
    const sf = parse(`
      export const nav = [
        { href: '/', labelKey: 'global.nav.home' },
        { href: '/cart', titleKey: 'global.nav.cart' },
      ];
    `);
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls.map((call) => call.key)).toEqual([
      'global.nav.home',
      'global.nav.cart',
    ]);
  });

  it('extracts keys from i18nKey() helper calls', () => {
    const sf = parse(`
      import { i18nKey } from 'vite-bundled-i18n';
      const nav = [{ href: '/', key: i18nKey('global.nav.home') }];
    `);
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('global.nav.home');
  });

  it('resolves property access on as-const object', () => {
    const sf = parse(`
      import { t } from 'vite-bundled-i18n';
      const KEYS = { active: 'status.active', inactive: 'status.inactive' } as const;
      t(KEYS.active);
    `);
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('status.active');
    expect(calls[0].dynamic).toBe(false);
  });

  it('resolves element access on as-const object to all values', () => {
    const sf = parse(`
      import { t } from 'vite-bundled-i18n';
      const KEYS = { active: 'status.active', inactive: 'status.inactive' } as const;
      t(KEYS[status]);
    `);
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls).toHaveLength(2);
    expect(calls.map(c => c.key).sort()).toEqual(['status.active', 'status.inactive']);
    expect(calls.every(c => !c.dynamic)).toBe(true);
  });

  it('resolves string enum member access', () => {
    const sf = parse(`
      import { t } from 'vite-bundled-i18n';
      enum Status { Active = 'status.active', Inactive = 'status.inactive' }
      t(Status.Active);
    `);
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('status.active');
    expect(calls[0].dynamic).toBe(false);
  });

  it('resolves dynamic enum access to all string values', () => {
    const sf = parse(`
      import { t } from 'vite-bundled-i18n';
      enum Status { Active = 'status.active', Inactive = 'status.inactive' }
      t(Status[someVar]);
    `);
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls).toHaveLength(2);
    expect(calls.map(c => c.key).sort()).toEqual(['status.active', 'status.inactive']);
  });

  it('ignores non-string enum members for property access', () => {
    const sf = parse(`
      import { t } from 'vite-bundled-i18n';
      enum Mixed { A = 0, B = 'status.b' }
      t(Mixed.A);
    `);
    const calls = findTranslationCalls(sf, globalOpts);
    expect(calls).toHaveLength(1);
    expect(calls[0].dynamic).toBe(true);
  });

  it('extracts keys from custom key fields', () => {
    const sf = parse(`
      export const columns = [
        { messageKey: 'admin.columns.name' },
        { columnLabel: 'admin.columns.email' },
      ];
    `);
    const calls = findTranslationCalls(sf, {
      ...globalOpts,
      keyFields: ['messageKey', 'columnLabel'],
    });
    expect(calls.map(c => c.key)).toEqual([
      'admin.columns.name',
      'admin.columns.email',
    ]);
  });

  it('custom key fields are additive to defaults', () => {
    const sf = parse(`
      export const items = [
        { labelKey: 'shared.label' },
        { messageKey: 'shared.message' },
      ];
    `);
    const calls = findTranslationCalls(sf, {
      ...globalOpts,
      keyFields: ['messageKey'],
    });
    expect(calls.map(c => c.key)).toEqual(['shared.label', 'shared.message']);
  });
});

describe('extractScopes', () => {
  it('extracts scope from useI18n call', () => {
    const sf = parse("import { useI18n } from 'vite-bundled-i18n/react';\nfunction P() { const { t } = useI18n('products.show'); }");
    expect(extractScopes(sf)).toEqual(['products.show']);
  });

  it('returns empty for useI18n without scope', () => {
    const sf = parse("import { useI18n } from 'vite-bundled-i18n/react';\nfunction P() { const { t } = useI18n(); }");
    expect(extractScopes(sf)).toEqual([]);
  });

  it('extracts multiple scopes', () => {
    const sf = parse("import { useI18n } from 'vite-bundled-i18n/react';\nfunction A() { useI18n('a'); }\nfunction B() { useI18n('b'); }");
    expect(extractScopes(sf)).toEqual(['a', 'b']);
  });
});
