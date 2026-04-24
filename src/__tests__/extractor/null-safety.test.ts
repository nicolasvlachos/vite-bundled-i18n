import { describe, it, expect } from 'vitest';
import {
  flattenKeys,
  pruneNamespace,
} from '../../extractor/bundle-generator';
import {
  flattenToKeyPaths,
  flattenToLeafValues,
} from '../../extractor/type-generator';

/**
 * Defensive null-safety contract: every function that walks user-provided
 * translation JSON must tolerate `null` / `undefined` at the entry and at
 * any subtree. Users hit these when:
 *
 * - A namespace is registered but its payload is still fetching
 * - Locale JSON contains `null` leaves ("not translated yet")
 * - Partial cross-namespace packing delivers a subtree without siblings
 *
 * Throwing in any of those states bricks the dev toolbar and/or SSR,
 * which is worse than silently returning an empty result.
 */

describe('null-safe store traversal', () => {
  it('flattenKeys returns [] for null/undefined input', () => {
    expect(flattenKeys(null as unknown as object)).toEqual([]);
    expect(flattenKeys(undefined as unknown as object)).toEqual([]);
  });

  it('flattenKeys returns [] for an empty object', () => {
    expect(flattenKeys({})).toEqual([]);
  });

  it('flattenKeys treats a null leaf as a regular key path', () => {
    // `null` is a legal placeholder — "no translation yet".
    expect(flattenKeys({ a: { b: null, c: 'x' } })).toEqual(['a.b', 'a.c']);
  });

  it('flattenKeys ignores arrays (not a translations shape)', () => {
    expect(flattenKeys({ a: ['not', 'translations'] })).toEqual(['a']);
  });

  it('flattenKeys recovers when a nested branch is null mid-tree', () => {
    expect(flattenKeys({ a: { b: { c: null } }, d: null })).toEqual(['a.b.c', 'd']);
  });

  it('flattenToKeyPaths returns [] for null/undefined input', () => {
    expect(flattenToKeyPaths(null as unknown as object)).toEqual([]);
    expect(flattenToKeyPaths(undefined as unknown as object)).toEqual([]);
  });

  it('flattenToLeafValues returns an empty Map for null/undefined input', () => {
    expect(flattenToLeafValues(null as unknown as object).size).toBe(0);
    expect(flattenToLeafValues(undefined as unknown as object).size).toBe(0);
  });

  it('flattenToLeafValues skips null leaves but records string leaves', () => {
    const result = flattenToLeafValues({ a: { b: null, c: 'x' }, d: 'y' });
    expect(Array.from(result.entries()).sort()).toEqual([
      ['a.c', 'x'],
      ['d', 'y'],
    ]);
  });

  it('pruneNamespace returns empty object when fullData is null-empty', () => {
    const result = pruneNamespace({}, ['a.b']);
    expect(result).toEqual({});
  });
});

/**
 * Property-ish test: randomly-ish generated JSON trees with nullable leaves
 * must never throw. We don't need a fuzzer to validate this — a handful of
 * hand-picked edge cases covers the contract.
 */
describe('null-safe walkers never throw on pathological shapes', () => {
  const pathologicalInputs: unknown[] = [
    null,
    undefined,
    {},
    { a: null },
    { a: { b: null } },
    { a: { b: { c: null, d: null } } },
    { a: [1, 2, 3] },
    { a: { b: [] } },
    { a: 'string', b: null, c: { d: 'x', e: null } },
    { '': null },
    { '0': null, '1': 'x' },
  ];

  for (const input of pathologicalInputs) {
    it(`flattenKeys(${JSON.stringify(input)}) does not throw`, () => {
      expect(() => flattenKeys(input as object)).not.toThrow();
    });

    it(`flattenToKeyPaths(${JSON.stringify(input)}) does not throw`, () => {
      expect(() => flattenToKeyPaths(input as object)).not.toThrow();
    });

    it(`flattenToLeafValues(${JSON.stringify(input)}) does not throw`, () => {
      expect(() => flattenToLeafValues(input as object)).not.toThrow();
    });
  }
});
