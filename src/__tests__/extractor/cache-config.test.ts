import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveCacheConfig } from '../../extractor/cache-config';

describe('resolveCacheConfig', () => {
  const rootDir = '/projects/demo';

  it('defaults to enabled with standard dir when no input is given', () => {
    const resolved = resolveCacheConfig(undefined, { rootDir, env: {} });
    expect(resolved.enabled).toBe(true);
    expect(resolved.persist).toBe(true);
    expect(resolved.clearBeforeStart).toBe(false);
    expect(resolved.debug).toBe(false);
    expect(resolved.dir).toBe(path.join(rootDir, '.i18n', 'cache'));
  });

  it('disables cache when input is false', () => {
    const resolved = resolveCacheConfig(false, { rootDir, env: {} });
    expect(resolved.enabled).toBe(false);
  });

  it('stays enabled when input is true (same as default)', () => {
    const resolved = resolveCacheConfig(true, { rootDir, env: {} });
    expect(resolved.enabled).toBe(true);
  });

  it('respects { enabled: false } object form', () => {
    const resolved = resolveCacheConfig({ enabled: false }, { rootDir, env: {} });
    expect(resolved.enabled).toBe(false);
  });

  it('resolves a custom relative dir against rootDir', () => {
    const resolved = resolveCacheConfig(
      { dir: 'build/i18n-cache' },
      { rootDir, env: {} },
    );
    expect(resolved.dir).toBe(path.join(rootDir, 'build', 'i18n-cache'));
  });

  it('preserves an absolute custom dir', () => {
    const resolved = resolveCacheConfig(
      { dir: '/tmp/i18n-cache' },
      { rootDir, env: {} },
    );
    expect(resolved.dir).toBe('/tmp/i18n-cache');
  });

  it('respects persist: false', () => {
    const resolved = resolveCacheConfig({ persist: false }, { rootDir, env: {} });
    expect(resolved.persist).toBe(false);
  });

  it('VITE_I18N_NO_CACHE=1 disables cache even when config says enabled', () => {
    const resolved = resolveCacheConfig(true, {
      rootDir,
      env: { VITE_I18N_NO_CACHE: '1' },
    });
    expect(resolved.enabled).toBe(false);
  });

  it('VITE_I18N_CLEAR_CACHE=1 keeps cache enabled but flags a pre-start clear', () => {
    const resolved = resolveCacheConfig(undefined, {
      rootDir,
      env: { VITE_I18N_CLEAR_CACHE: '1' },
    });
    expect(resolved.enabled).toBe(true);
    expect(resolved.clearBeforeStart).toBe(true);
  });

  it('VITE_I18N_CACHE_DEBUG=1 turns on debug logging regardless of config', () => {
    const resolved = resolveCacheConfig({ enabled: true }, {
      rootDir,
      env: { VITE_I18N_CACHE_DEBUG: '1' },
    });
    expect(resolved.debug).toBe(true);
  });

  it('NODE_ENV=test disables cache by default', () => {
    const resolved = resolveCacheConfig(undefined, {
      rootDir,
      env: { NODE_ENV: 'test' },
    });
    expect(resolved.enabled).toBe(false);
  });

  it('NODE_ENV=test with explicit enabled:true keeps cache on', () => {
    const resolved = resolveCacheConfig({ enabled: true }, {
      rootDir,
      env: { NODE_ENV: 'test' },
    });
    expect(resolved.enabled).toBe(true);
  });

  it('env VITE_I18N_NO_CACHE overrides explicit enabled:true', () => {
    const resolved = resolveCacheConfig({ enabled: true }, {
      rootDir,
      env: { VITE_I18N_NO_CACHE: '1' },
    });
    expect(resolved.enabled).toBe(false);
  });

  it('ignores empty-string and falsey env values', () => {
    const resolved = resolveCacheConfig(undefined, {
      rootDir,
      env: {
        VITE_I18N_NO_CACHE: '',
        VITE_I18N_CLEAR_CACHE: '0',
        VITE_I18N_CACHE_DEBUG: 'false',
      },
    });
    expect(resolved.enabled).toBe(true);
    expect(resolved.clearBeforeStart).toBe(false);
    expect(resolved.debug).toBe(false);
  });
});
