import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { getStringValue, getStaticPrefix, collectImports } from '../../extractor/ast-utils';

function parse(source: string) {
  return ts.createSourceFile('test.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function firstCallArg(source: string): ts.Expression {
  const sf = parse(source);
  let arg: ts.Expression | undefined;
  ts.forEachChild(sf, function visit(node) {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      arg = node.arguments[0];
      return;
    }
    ts.forEachChild(node, visit);
  });
  return arg!;
}

describe('getStringValue', () => {
  it('extracts from a string literal', () => {
    const node = firstCallArg("t('shared.ok')");
    expect(getStringValue(node)).toBe('shared.ok');
  });

  it('extracts from a no-substitution template literal', () => {
    const node = firstCallArg('t(`shared.ok`)');
    expect(getStringValue(node)).toBe('shared.ok');
  });

  it('returns undefined for a template literal with expressions', () => {
    const node = firstCallArg('t(`shared.${x}`)');
    expect(getStringValue(node)).toBeUndefined();
  });

  it('returns undefined for a variable reference', () => {
    const node = firstCallArg('t(key)');
    expect(getStringValue(node)).toBeUndefined();
  });

  it('returns undefined for a binary expression', () => {
    const node = firstCallArg("t('shared.' + x)");
    expect(getStringValue(node)).toBeUndefined();
  });
});

describe('getStaticPrefix', () => {
  it('returns the full string for a string literal', () => {
    const node = firstCallArg("t('shared.ok')");
    expect(getStaticPrefix(node)).toBe('shared.ok');
  });

  it('extracts the head from a template literal with expressions', () => {
    const node = firstCallArg('t(`products.${type}.title`)');
    expect(getStaticPrefix(node)).toBe('products');
  });

  it('extracts the left side of a binary concatenation', () => {
    const node = firstCallArg("t('products.' + category)");
    expect(getStaticPrefix(node)).toBe('products');
  });

  it('extracts nested left side of chained concatenation', () => {
    const node = firstCallArg("t('products.' + category + '.name')");
    expect(getStaticPrefix(node)).toBe('products');
  });

  it('returns undefined for a variable with no static start', () => {
    const node = firstCallArg('t(keyVariable)');
    expect(getStaticPrefix(node)).toBeUndefined();
  });

  it('extracts multi-segment prefix from template literal', () => {
    const node = firstCallArg('t(`products.show.${field}`)');
    expect(getStaticPrefix(node)).toBe('products.show');
  });

  it('returns undefined when template starts with expression', () => {
    const node = firstCallArg('t(`${ns}.something`)');
    expect(getStaticPrefix(node)).toBeUndefined();
  });

  it('handles template with no dot before expression', () => {
    const node = firstCallArg('t(`products${suffix}`)');
    expect(getStaticPrefix(node)).toBe('products');
  });
});

describe('collectImports', () => {
  it('collects import specifiers', () => {
    const sf = parse("import { Foo } from './components/Foo';\nimport Bar from '../Bar';");
    expect(collectImports(sf)).toEqual(['./components/Foo', '../Bar']);
  });

  it('collects export-from specifiers', () => {
    const sf = parse("export { Baz } from './Baz';");
    expect(collectImports(sf)).toEqual(['./Baz']);
  });

  it('skips type-only imports', () => {
    const sf = parse("import type { T } from './types';\nimport { Foo } from './Foo';");
    expect(collectImports(sf)).toEqual(['./Foo']);
  });

  it('returns empty for no imports', () => {
    const sf = parse('const x = 1;');
    expect(collectImports(sf)).toEqual([]);
  });
});
