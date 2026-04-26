import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { walkAll } from '../../extractor/walker';
import { generateBundles } from '../../extractor/bundle-generator';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-bug-hook-'));
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
 * Reproduce the user-reported topology exactly:
 *
 *   - Page registers `useI18n('auth.invitations.index')`
 *   - Page imports a HOOK
 *   - Hook calls `useI18n()` (BARE, no scope) and has static t() calls
 *     to `auth.invitations.messages.success.sent` (and siblings)
 *   - Source `auth.json` has BOTH top-level `messages.*` AND nested
 *     `invitations.messages.*`
 *   - Multiple unrelated routes so `auth` isn't inferred-shared
 *
 * Expected: build bundle for auth.invitations.index includes
 * `auth.invitations.messages.success.sent`.
 *
 * User's bug: the entire `messages` subtree under `auth.invitations` is
 * absent from the build bundle while the dev namespace bundle has it.
 */
describe('bug: hook-extracted nested messages key drops in build bundle', () => {
  it('preserves auth.invitations.messages.success.sent when hook (bare useI18n) is the source', () => {
    write('locales/en/auth.json', JSON.stringify({
      messages: {
        login: { failed: 'Login failed', success: 'Logged in' },
        logout: { success: 'Logged out' },
      },
      invitations: {
        messages: {
          success: { sent: 'Invite sent', resent: 'Invite resent', revoked: 'Invite revoked' },
          error: { operation_failed: 'Operation failed' },
        },
        actions: { create: 'Create invitation', resend: 'Resend' },
        pages: { index: { title: 'Invitations' } },
        filters: { all: 'All' },
        tables: { columns: { email: 'Email' } },
      },
    }));
    write('locales/en/global.json', JSON.stringify({ appName: 'App' }));
    write('locales/en/cart.json', JSON.stringify({ index: { heading: 'Cart' } }));
    write('locales/en/products.json', JSON.stringify({ index: { heading: 'Products' } }));

    // Hook with bare useI18n() and static t() calls — exactly the user's pattern.
    write('src/pages/admin/users/relations/invitations/hooks/use-invitations-index-actions.tsx', `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function useInvitationsIndexActions() {
        const { t } = useI18n();
        return {
          onSent: () => t('auth.invitations.messages.success.sent'),
          onResent: () => t('auth.invitations.messages.success.resent'),
          onRevoked: () => t('auth.invitations.messages.success.revoked'),
          onFailed: () => t('auth.invitations.messages.error.operation_failed'),
          onCreate: () => t('auth.invitations.actions.create'),
        };
      }
    `);

    // Page that registers the scope and imports the hook.
    write('src/pages/admin/users/relations/invitations/pages/invitations-index.page.tsx', `
      import { useI18n } from 'vite-bundled-i18n/react';
      import { useInvitationsIndexActions } from '../hooks/use-invitations-index-actions';
      export function InvitationsIndex() {
        const { t } = useI18n('auth.invitations.index');
        const actions = useInvitationsIndexActions();
        return (
          <div>
            <h1>{t('auth.invitations.pages.index.title')}</h1>
            <button onClick={actions.onCreate}>{t('auth.invitations.actions.create')}</button>
            <span>{t('auth.invitations.tables.columns.email')}</span>
            <span>{t('auth.invitations.filters.all')}</span>
          </div>
        );
      }
    `);

    // Two unrelated routes to keep the auth-namespace ratio below 50%.
    write('src/pages/cart/index.tsx', `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function CartIndex() {
        const { t } = useI18n('cart.index');
        return <div>{t('cart.index.heading')}</div>;
      }
    `);
    write('src/pages/products/index.tsx', `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function ProductsIndex() {
        const { t } = useI18n('products.index');
        return <div>{t('products.index.heading')}</div>;
      }
    `);

    const analysis = walkAll({
      pages: ['src/pages/**/*.tsx'],
      rootDir: tmpDir,
      localesDir: path.join(tmpDir, 'locales'),
      defaultLocale: 'en',
    });

    // Sanity: the route must include all 4 hook-extracted invitations.messages keys.
    const route = analysis.routes.find((r) => r.scopes.includes('auth.invitations.index'));
    expect(route).toBeDefined();
    const keys = route!.keys.map((k) => k.key).sort();
    expect(keys).toContain('auth.invitations.messages.success.sent');
    expect(keys).toContain('auth.invitations.messages.success.resent');
    expect(keys).toContain('auth.invitations.messages.success.revoked');
    expect(keys).toContain('auth.invitations.messages.error.operation_failed');

    const outDir = path.join(tmpDir, 'out');
    generateBundles(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en'],
      outDir,
      dictionaries: { global: { include: ['global.*', 'shared.*', 'navigation.*'] } },
      crossNamespacePacking: true,
    });

    const bundlePath = path.join(outDir, 'en', 'auth.invitations.index.json');
    expect(fs.existsSync(bundlePath)).toBe(true);
    const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));

    // Inspect the actual structure (uncomment if it fails again):
    // console.log(JSON.stringify(bundle, null, 2));

    // The user's symptom: messages subtree is absent.
    expect(bundle.auth?.invitations?.messages).toBeDefined();
    expect(bundle.auth?.invitations?.messages?.success?.sent).toBe('Invite sent');
    expect(bundle.auth?.invitations?.messages?.success?.resent).toBe('Invite resent');
    expect(bundle.auth?.invitations?.messages?.error?.operation_failed).toBe('Operation failed');

    // Sibling subtrees (which DO ship in the user's bundle).
    expect(bundle.auth?.invitations?.actions?.create).toBe('Create invitation');
    expect(bundle.auth?.invitations?.pages?.index?.title).toBe('Invitations');
    expect(bundle.auth?.invitations?.filters?.all).toBe('All');
    expect(bundle.auth?.invitations?.tables?.columns?.email).toBe('Email');

    // The TOP-LEVEL auth.messages should NOT be in this scope's bundle (the
    // route doesn't reference them) — extra sanity check.
    expect(bundle.auth?.messages).toBeUndefined();
  });
});
