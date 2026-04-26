import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { walkAll } from '../../extractor/walker';
import { generateBundles } from '../../extractor/bundle-generator';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-bug-e2e-'));
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

/**
 * Fully end-to-end reproduction of the user-reported bug. Goes through
 * walkAll → generateBundles instead of synthesizing the analysis.
 */
describe('bug e2e: cross-ns sub-namespace collision via real walker', () => {
  it('emits auth.invitations.messages.success.sent when both top-level messages.* and nested invitations.messages.* exist', () => {
    write('locales/en/auth.json', JSON.stringify({
      messages: { login: { failed: 'Login failed' } },
      invitations: {
        messages: { success: { sent: 'Invite sent' } },
        actions: { create: 'Create invitation' },
        pages: { index: { title: 'Invitations' } },
      },
    }));

    write('src/pages/auth/invitations/index.tsx', `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function InvitationsIndex() {
        const { t } = useI18n('auth.invitations.index');
        return (
          <div>
            <h1>{t('auth.invitations.pages.index.title')}</h1>
            <button>{t('auth.invitations.actions.create')}</button>
            <p>{t('auth.invitations.messages.success.sent')}</p>
          </div>
        );
      }
    `);

    const analysis = walkAll({
      pages: ['src/pages/**/*.tsx'],
      rootDir: tmpDir,
      localesDir: path.join(tmpDir, 'locales'),
      defaultLocale: 'en',
    });

    // Sanity: the walker extracted all three keys.
    const route = analysis.routes[0];
    const extracted = route.keys.map((k) => k.key).sort();
    expect(extracted).toContain('auth.invitations.actions.create');
    expect(extracted).toContain('auth.invitations.pages.index.title');
    // If the bug is in extraction, this assertion fails.
    expect(extracted).toContain('auth.invitations.messages.success.sent');

    const outDir = path.join(tmpDir, 'out');
    generateBundles(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en'],
      outDir,
      // Configure a named dictionary so the legacy inferred-shared heuristic
      // doesn't kick in (which would happen with 1 route — every namespace
      // is "shared" by >50% threshold). The user's real app has 150 pages
      // so auth isn't inferred-shared in their setup.
      dictionaries: { global: { include: ['shared.*'] } },
    });

    const bundlePath = path.join(outDir, 'en', 'auth.invitations.index.json');
    expect(fs.existsSync(bundlePath)).toBe(true);
    const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));

    expect(bundle.auth?.invitations?.actions?.create).toBe('Create invitation');
    expect(bundle.auth?.invitations?.pages?.index?.title).toBe('Invitations');
    // The bug — this is what the user reports as missing.
    expect(bundle.auth?.invitations?.messages?.success?.sent).toBe('Invite sent');
  });

  it('also works with crossNamespacePacking enabled and a non-claimed cross-ns extra', () => {
    write('locales/en/auth.json', JSON.stringify({
      messages: { login: { failed: 'Login failed' } },
      invitations: {
        messages: { success: { sent: 'Invite sent' } },
        actions: { create: 'Create invitation' },
      },
    }));
    write('locales/en/vendors.json', JSON.stringify({ name: 'Vendor' }));
    // Need a global dict so the inferred-shared heuristic doesn't trip.
    write('locales/en/global.json', JSON.stringify({ appName: 'App' }));

    write('src/pages/auth/invitations/index.tsx', `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function InvitationsIndex() {
        const { t } = useI18n('auth.invitations.index');
        return (
          <div>
            <button>{t('auth.invitations.actions.create')}</button>
            <p>{t('auth.invitations.messages.success.sent')}</p>
            <span>{t('vendors.name')}</span>
          </div>
        );
      }
    `);

    const analysis = walkAll({
      pages: ['src/pages/**/*.tsx'],
      rootDir: tmpDir,
      localesDir: path.join(tmpDir, 'locales'),
      defaultLocale: 'en',
    });

    const outDir = path.join(tmpDir, 'out');
    generateBundles(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en'],
      outDir,
      crossNamespacePacking: true,
      dictionaries: { global: { include: ['global.*'] } },
    });

    const bundle = JSON.parse(
      fs.readFileSync(path.join(outDir, 'en', 'auth.invitations.index.json'), 'utf-8'),
    );

    expect(bundle.auth?.invitations?.actions?.create).toBe('Create invitation');
    expect(bundle.auth?.invitations?.messages?.success?.sent).toBe('Invite sent');
    // vendors.name packed as cross-ns extra (not dict-owned).
    expect(bundle.vendors?.name).toBe('Vendor');
  });
});
