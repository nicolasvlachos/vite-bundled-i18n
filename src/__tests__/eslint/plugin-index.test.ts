import { describe, it, expect } from 'vitest';
import plugin, { rules, flatConfigs, configs } from '../../eslint/index';

/**
 * Smoke + shape tests for the plugin's public surface. These guard
 * against accidental rule removal, preset drift, or naming changes
 * that would silently break consumers' configs.
 */

describe('plugin: rules registry', () => {
  it('exposes every shipped rule by short name (no `vite-bundled-i18n/` prefix)', () => {
    expect(Object.keys(rules).sort()).toEqual([
      'no-member-access-t',
      'no-non-literal-t-arg',
      'no-renamed-t',
      'no-t-dynamic',
      't-arg-must-exist-in-types',
    ]);
  });

  it('every rule module has a `meta` and `create`', () => {
    for (const [name, mod] of Object.entries(rules)) {
      expect(mod, `rule ${name} missing module`).toBeDefined();
      expect(mod.meta, `rule ${name} missing meta`).toBeDefined();
      expect(typeof mod.create, `rule ${name} missing create`).toBe('function');
    }
  });

  it('every rule\'s meta declares schema (even if empty array)', () => {
    for (const [name, mod] of Object.entries(rules)) {
      expect(mod.meta?.schema, `rule ${name} missing schema`).toBeDefined();
    }
  });
});

describe('plugin: presets', () => {
  it('flatConfigs.recommended turns the four extractor-invisibility rules to warn', () => {
    const r = flatConfigs.recommended.rules;
    expect(r).toBeDefined();
    expect(r!['vite-bundled-i18n/no-t-dynamic']).toBe('warn');
    expect(r!['vite-bundled-i18n/no-non-literal-t-arg']).toBe('warn');
    expect(r!['vite-bundled-i18n/no-renamed-t']).toBe('warn');
    expect(r!['vite-bundled-i18n/no-member-access-t']).toBe('warn');
    // recommended deliberately excludes t-arg-must-exist-in-types
    expect(r!['vite-bundled-i18n/t-arg-must-exist-in-types']).toBeUndefined();
  });

  it('flatConfigs.strict turns every rule to error and includes t-arg-must-exist-in-types', () => {
    const r = flatConfigs.strict.rules;
    expect(r!['vite-bundled-i18n/no-t-dynamic']).toBe('error');
    expect(r!['vite-bundled-i18n/no-non-literal-t-arg']).toBe('error');
    expect(r!['vite-bundled-i18n/no-renamed-t']).toBe('error');
    expect(r!['vite-bundled-i18n/no-member-access-t']).toBe('error');
    const tArgRule = r!['vite-bundled-i18n/t-arg-must-exist-in-types'];
    expect(Array.isArray(tArgRule)).toBe(true);
    expect((tArgRule as [string, object])[0]).toBe('error');
  });

  it('flatConfigs entries register the plugin under its short name', () => {
    expect(flatConfigs.recommended.plugins).toHaveProperty('vite-bundled-i18n');
    expect(flatConfigs.strict.plugins).toHaveProperty('vite-bundled-i18n');
  });

  it('legacy configs.recommended/strict have the same rules but no inline plugins object', () => {
    expect(configs.recommended.plugins).toEqual(['vite-bundled-i18n']);
    expect(configs.strict.plugins).toEqual(['vite-bundled-i18n']);
    expect(configs.recommended.rules['vite-bundled-i18n/no-t-dynamic']).toBe('warn');
    expect(configs.strict.rules['vite-bundled-i18n/no-t-dynamic']).toBe('error');
  });
});

describe('plugin: default export', () => {
  it('default export carries meta, rules, and both config namespaces', () => {
    expect(plugin.meta?.name).toBe('vite-bundled-i18n');
    expect(typeof plugin.meta?.version).toBe('string');
    expect(plugin.rules).toBeDefined();
    expect(plugin.configs).toBeDefined();
    // flatConfigs is our extension on top of ESLint.Plugin — present on default.
    expect((plugin as unknown as { flatConfigs: unknown }).flatConfigs).toBeDefined();
  });
});
