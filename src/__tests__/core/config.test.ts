import { describe, it, expect, vi } from 'vitest';
import { defineI18nConfig } from '../../core/config';

describe('defineI18nConfig', () => {
  it('returns valid config unchanged', () => {
    const config = defineI18nConfig({
      localesDir: 'locales',
      dictionaries: {
        global: { keys: ['shared', 'global'] },
      },
    });
    expect(config.localesDir).toBe('locales');
    expect(config.dictionaries?.global.keys).toEqual(['shared', 'global']);
  });

  it('accepts config without dictionaries', () => {
    const config = defineI18nConfig({ localesDir: 'locales' });
    expect(config.localesDir).toBe('locales');
  });

  it('throws for empty localesDir', () => {
    expect(() => defineI18nConfig({ localesDir: '' })).toThrow('localesDir');
  });

  it('throws for missing localesDir', () => {
    expect(() => defineI18nConfig({ localesDir: undefined as unknown as string })).toThrow('localesDir');
  });

  it('throws for empty dictionary keys array', () => {
    expect(() => defineI18nConfig({
      localesDir: 'locales',
      dictionaries: { global: { keys: [] } },
    })).toThrow('empty');
  });

  it('throws for invalid namespace in dictionary keys', () => {
    expect(() => defineI18nConfig({
      localesDir: 'locales',
      dictionaries: { global: { keys: ['shared', ''] } },
    })).toThrow('invalid key');
  });

  it('warns about duplicate namespaces across dictionaries', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    defineI18nConfig({
      localesDir: 'locales',
      dictionaries: {
        global: { keys: ['shared', 'global'] },
        ui: { keys: ['shared', 'actions'] },  // 'shared' is duplicate
      },
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('shared'),
    );
    warnSpy.mockRestore();
  });

  it('does not warn when no duplicates exist', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    defineI18nConfig({
      localesDir: 'locales',
      dictionaries: {
        global: { keys: ['shared'] },
        ui: { keys: ['actions'] },
      },
    });

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('accepts include patterns and priority', () => {
    const config = defineI18nConfig({
      localesDir: 'locales',
      dictionaries: {
        global: { include: ['shared.*', 'global.nav.*'], priority: 10, pinned: true },
      },
    });
    expect(config.dictionaries?.global.include).toEqual(['shared.*', 'global.nav.*']);
    expect(config.dictionaries?.global.priority).toBe(10);
    expect(config.dictionaries?.global.pinned).toBe(true);
  });

  it('throws for invalid include wildcard pattern', () => {
    expect(() => defineI18nConfig({
      localesDir: 'locales',
      dictionaries: { global: { include: ['shared.*.bad'] } },
    })).toThrow('invalid key pattern');
  });

  it('throws when dictionary has neither keys nor include', () => {
    expect(() => defineI18nConfig({
      localesDir: 'locales',
      dictionaries: { global: {} },
    })).toThrow('must define keys or include patterns');
  });
});
