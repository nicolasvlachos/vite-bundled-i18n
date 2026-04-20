import { describe, it, expect } from 'vitest';
import {
  resolveDictionaryOwnership,
  normalizeDictionaries,
} from '../../extractor/dictionary-ownership';

describe('dictionary-ownership exclude patterns', () => {
  it('excludes keys matching exclude patterns from dictionary', () => {
    const ownership = resolveDictionaryOwnership(
      ['shared.ok', 'shared.cancel', 'shared.validation.required', 'shared.validation.email'],
      {
        global: {
          include: ['shared.*'],
          exclude: ['shared.validation.*'],
          priority: 1,
        },
      },
    );

    expect(ownership.keyOwner.get('shared.ok')).toBe('global');
    expect(ownership.keyOwner.get('shared.cancel')).toBe('global');
    expect(ownership.keyOwner.has('shared.validation.required')).toBe(false);
    expect(ownership.keyOwner.has('shared.validation.email')).toBe(false);
  });

  it('includes all keys when no exclude patterns are provided', () => {
    const ownership = resolveDictionaryOwnership(
      ['shared.ok', 'shared.cancel', 'shared.validation.required'],
      {
        global: {
          include: ['shared.*'],
          priority: 1,
        },
      },
    );

    expect(ownership.keyOwner.get('shared.ok')).toBe('global');
    expect(ownership.keyOwner.get('shared.cancel')).toBe('global');
    expect(ownership.keyOwner.get('shared.validation.required')).toBe('global');
  });

  it('excluded keys can be claimed by a lower-priority dictionary', () => {
    const ownership = resolveDictionaryOwnership(
      ['shared.ok', 'shared.validation.required'],
      {
        global: {
          include: ['shared.*'],
          exclude: ['shared.validation.*'],
          priority: 2,
        },
        validation: {
          include: ['shared.validation.*'],
          priority: 1,
        },
      },
    );

    expect(ownership.keyOwner.get('shared.ok')).toBe('global');
    expect(ownership.keyOwner.get('shared.validation.required')).toBe('validation');
  });

  it('normalizeDictionaries includes exclude array in rules', () => {
    const rules = normalizeDictionaries({
      global: {
        include: ['shared.*'],
        exclude: ['shared.validation.*'],
        priority: 1,
      },
    });

    expect(rules).toHaveLength(1);
    expect(rules[0].exclude).toEqual(['shared.validation.*']);
  });

  it('normalizeDictionaries defaults exclude to empty array', () => {
    const rules = normalizeDictionaries({
      global: {
        include: ['shared.*'],
      },
    });

    expect(rules).toHaveLength(1);
    expect(rules[0].exclude).toEqual([]);
  });

  it('exclude with exact key pattern works', () => {
    const ownership = resolveDictionaryOwnership(
      ['shared.ok', 'shared.cancel', 'shared.secret'],
      {
        global: {
          include: ['shared.*'],
          exclude: ['shared.secret'],
          priority: 1,
        },
      },
    );

    expect(ownership.keyOwner.get('shared.ok')).toBe('global');
    expect(ownership.keyOwner.get('shared.cancel')).toBe('global');
    expect(ownership.keyOwner.has('shared.secret')).toBe(false);
  });
});
