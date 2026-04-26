import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clean, rebuild, inspectStaleness } from '../../cli/commands';
import type { CliConfig } from '../../cli/commands';
import { BUILD_STAMP_FILE_NAME } from '../../extractor/build-stamp';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-cli-clean-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(rel: string, content: string): string {
  const full = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

describe('cli: clean', () => {
  it('removes the default outDir (.i18n/) including all generated artifacts', () => {
    write('.i18n/cache/extraction-v2.json', '{}');
    write('.i18n/manifest.json', '{}');
    write('.i18n/i18n-generated.ts', '');
    write('.i18n/build-stamp.json', '{}');

    const result = clean({ rootDir: tmpDir, quiet: true });

    expect(result.removed).toContain(path.join(tmpDir, '.i18n'));
    expect(fs.existsSync(path.join(tmpDir, '.i18n'))).toBe(false);
  });

  it('respects a custom outDir', () => {
    write('custom-out/extraction-v2.json', '{}');
    const result = clean({ rootDir: tmpDir, outDir: 'custom-out', quiet: true });
    expect(result.removed).toContain(path.join(tmpDir, 'custom-out'));
    expect(fs.existsSync(path.join(tmpDir, 'custom-out'))).toBe(false);
  });

  it('removes extra paths inside rootDir', () => {
    write('public/__i18n/scope-map.json', '{}');
    write('public/build/__i18n/auth.json', '{}');

    const result = clean({
      rootDir: tmpDir,
      quiet: true,
      extraPaths: ['public/__i18n', 'public/build/__i18n'],
    });

    expect(result.removed).toContain(path.join(tmpDir, 'public/__i18n'));
    expect(result.removed).toContain(path.join(tmpDir, 'public/build/__i18n'));
    expect(fs.existsSync(path.join(tmpDir, 'public/__i18n'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'public/build/__i18n'))).toBe(false);
    expect(result.rejected).toEqual([]);
  });

  it('rejects extraPaths outside rootDir by default (safety rail)', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-outside-'));
    fs.writeFileSync(path.join(outside, 'sentinel'), 'x');

    const result = clean({
      rootDir: tmpDir,
      quiet: true,
      extraPaths: [outside, '../../../etc'],
    });

    expect(result.rejected).toEqual([outside, '../../../etc']);
    expect(result.removed).not.toContain(outside);
    expect(fs.existsSync(outside)).toBe(true);

    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('honors allowOutsideRoot=true to wipe paths outside rootDir', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-outside-ok-'));
    fs.writeFileSync(path.join(outside, 'sentinel'), 'x');

    const result = clean({
      rootDir: tmpDir,
      quiet: true,
      extraPaths: [outside],
      allowOutsideRoot: true,
    });

    expect(result.removed).toContain(outside);
    expect(result.rejected).toEqual([]);
    expect(fs.existsSync(outside)).toBe(false);
  });

  it('rejects extraPaths that resolve to rootDir itself', () => {
    const result = clean({
      rootDir: tmpDir,
      quiet: true,
      extraPaths: ['.'],
    });
    expect(result.rejected).toContain('.');
    expect(fs.existsSync(tmpDir)).toBe(true);
  });

  it('reports missing paths without erroring', () => {
    const result = clean({ rootDir: tmpDir, quiet: true });
    expect(result.removed).toEqual([]);
    expect(result.missing).toContain(path.join(tmpDir, '.i18n'));
  });

  it('is idempotent (running twice on a clean tree is a no-op)', () => {
    write('.i18n/x.json', '{}');
    clean({ rootDir: tmpDir, quiet: true });
    const second = clean({ rootDir: tmpDir, quiet: true });
    expect(second.removed).toEqual([]);
  });
});

describe('cli: rebuild', () => {
  function setupProject() {
    write('locales/en/auth.json', JSON.stringify({
      messages: { login: { failed: 'Login failed' } },
      invitations: {
        messages: { success: { sent: 'Invite sent' } },
        actions: { create: 'Create' },
      },
    }));
    write('locales/en/shared.json', JSON.stringify({ ok: 'OK' }));

    write('src/pages/auth/invitations/index.tsx', `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function Page() {
        const { t } = useI18n('auth.invitations.index');
        return t('auth.invitations.messages.success.sent');
      }
    `);
  }

  it('cleans first then rebuilds — outputs reflect current source', () => {
    setupProject();
    // Plant a stale fingerprint file so we can prove it gets blown away.
    write('.i18n/manifest.json', JSON.stringify({ stale: true }));

    const config: CliConfig = {
      pages: ['src/pages/**/*.tsx'],
      localesDir: 'locales',
      locales: ['en'],
      defaultLocale: 'en',
      rootDir: tmpDir,
      outDir: path.join(tmpDir, '.i18n'),
      typesOutPath: path.join(tmpDir, '.i18n/i18n-generated.ts'),
    };

    // Suppress console output from the build pipeline.
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    rebuild(config, { quiet: true });

    logSpy.mockRestore();
    warnSpy.mockRestore();

    // The stale manifest should have been replaced.
    const manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, '.i18n/manifest.json'), 'utf-8'));
    expect(manifest.stale).toBeUndefined();
    // Build-stamp must exist.
    expect(fs.existsSync(path.join(tmpDir, '.i18n', BUILD_STAMP_FILE_NAME))).toBe(true);
  });
});

describe('cli: inspectStaleness', () => {
  it('returns cache-without-stamp when extraction cache exists but no stamp', () => {
    write('.i18n/cache/extraction-v2.json', '{}');
    const config: CliConfig = {
      pages: ['src/pages/**/*.tsx'],
      localesDir: 'locales',
      locales: ['en'],
      defaultLocale: 'en',
      rootDir: tmpDir,
      outDir: path.join(tmpDir, '.i18n'),
    };
    const r = inspectStaleness(config);
    expect(r?.reason).toBe('cache-without-stamp');
  });

  it('returns null when nothing has been built yet', () => {
    const config: CliConfig = {
      pages: ['src/pages/**/*.tsx'],
      localesDir: 'locales',
      locales: ['en'],
      defaultLocale: 'en',
      rootDir: tmpDir,
      outDir: path.join(tmpDir, '.i18n'),
    };
    expect(inspectStaleness(config)).toBeNull();
  });
});
