import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { walkAll } from '../../extractor/walker';
import { generateBundles } from '../../extractor/bundle-generator';
import { createExtractionCache, computeConfigHash } from '../../extractor/extraction-cache';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-bug-stale-'));
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
 * Bug recipe (verbatim from the user):
 *
 *   1. Initial build: scope `auth.invitations.index` registered, hook calls
 *      t('auth.invitations.messages.success.sent'). Bundle emitted correctly.
 *   2. Without changing the hook: edit any unrelated file, rebuild. Bundle still correct.
 *   3. Edit the hook (e.g. add a new t() call to a different namespace; can be unrelated).
 *      Rebuild WITHOUT clearing .i18n/. Re-check the bundle.
 *
 * Expected (after the fix): step 3's bundle still contains all the original
 * `auth.invitations.messages.*` keys.
 *
 * Symptom (pre-fix): the messages subtree under auth.invitations is dropped.
 *
 * The walker uses a per-file mtime+size cache. When the hook is edited, the
 * walker should re-extract the hook AND the per-scope output bundle should
 * still include all of the hook's keys (existing + new). This test asserts
 * that contract end-to-end.
 */
describe('bug: cache-staleness across incremental rebuilds', () => {
  function buildOnce(opts: { cacheDir: string }): void {
    const cache = createExtractionCache({
      dir: opts.cacheDir,
      pluginVersion: '0.0.0-test',
      configHash: computeConfigHash({ pages: ['src/pages/**/*.tsx'] }),
    });
    const analysis = walkAll({
      pages: ['src/pages/**/*.tsx'],
      rootDir: tmpDir,
      localesDir: path.join(tmpDir, 'locales'),
      defaultLocale: 'en',
      cache,
    });
    cache.persistToDisk();

    const outDir = path.join(tmpDir, 'out');
    generateBundles(analysis, {
      localesDir: path.join(tmpDir, 'locales'),
      locales: ['en'],
      outDir,
      crossNamespacePacking: true,
      dictionaries: { global: { include: ['shared.*', 'navigation.*'], priority: 1, pinned: true } },
    });
  }

  type AuthBundle = {
    auth?: {
      invitations?: {
        messages?: {
          success?: { sent?: string; resent?: string; revoked?: string };
          error?: { operation_failed?: string };
        };
        actions?: { create?: string };
        pages?: { index?: { title?: string } };
      };
    };
  };

  function readBundle(): AuthBundle {
    const bundlePath = path.join(tmpDir, 'out', 'en', 'auth.invitations.index.json');
    return JSON.parse(fs.readFileSync(bundlePath, 'utf-8')) as AuthBundle;
  }

  it('preserves the hook-extracted messages subtree after editing the hook', () => {
    // Source: full auth.json (top-level messages + nested invitations.messages).
    write('locales/en/auth.json', JSON.stringify({
      messages: { login: { failed: 'Login failed' } },
      invitations: {
        messages: {
          success: { sent: 'Invite sent', resent: 'Invite resent', revoked: 'Invite revoked' },
          error: { operation_failed: 'Operation failed' },
        },
        actions: { create: 'Create invitation' },
        pages: { index: { title: 'Invitations' } },
      },
    }));
    write('locales/en/cart.json', JSON.stringify({ index: { heading: 'Cart' } }));
    write('locales/en/products.json', JSON.stringify({ index: { heading: 'Products' } }));
    write('locales/en/shared.json', JSON.stringify({ ok: 'OK' }));
    write('locales/en/navigation.json', JSON.stringify({ home: 'Home' }));

    // Initial hook with 4 messages keys.
    const hookPath = 'src/pages/admin/invitations/hooks/use-actions.tsx';
    write(hookPath, `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function useInvitationsActions() {
        const { t } = useI18n();
        return {
          onSent: () => t('auth.invitations.messages.success.sent'),
          onResent: () => t('auth.invitations.messages.success.resent'),
          onRevoked: () => t('auth.invitations.messages.success.revoked'),
          onFailed: () => t('auth.invitations.messages.error.operation_failed'),
        };
      }
    `);

    // Page that registers the scope and imports the hook.
    write('src/pages/admin/invitations/pages/invitations-index.page.tsx', `
      import { useI18n } from 'vite-bundled-i18n/react';
      import { useInvitationsActions } from '../hooks/use-actions';
      export function InvitationsIndex() {
        const { t } = useI18n('auth.invitations.index');
        const actions = useInvitationsActions();
        return (
          <div>
            <h1>{t('auth.invitations.pages.index.title')}</h1>
            <button onClick={actions.onSent}>{t('auth.invitations.actions.create')}</button>
          </div>
        );
      }
    `);

    // Two unrelated routes to keep auth below the 50% inferred-shared threshold.
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

    const cacheDir = path.join(tmpDir, '.i18n/cache');

    // ----- STEP 1: initial build -----
    buildOnce({ cacheDir });
    const bundle1 = readBundle();
    expect(bundle1.auth).toBeDefined();
    expect(bundle1.auth?.invitations?.messages?.success?.sent).toBe('Invite sent');
    expect(bundle1.auth?.invitations?.messages?.success?.resent).toBe('Invite resent');
    expect(bundle1.auth?.invitations?.messages?.error?.operation_failed).toBe('Operation failed');

    // ----- STEP 2: edit an unrelated file, rebuild -----
    // (mtime resolution: write a sentinel and bump time.)
    write('src/pages/products/index.tsx', `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function ProductsIndex() {
        const { t } = useI18n('products.index');
        return <div>{t('products.index.heading')}{/* edit */}</div>;
      }
    `);
    // Force a different mtime so the cache invalidates this file.
    const future = new Date(Date.now() + 2000);
    fs.utimesSync(path.join(tmpDir, 'src/pages/products/index.tsx'), future, future);

    buildOnce({ cacheDir });
    const bundle2 = readBundle();
    expect(bundle2.auth?.invitations?.messages?.success?.sent).toBe('Invite sent');
    expect(bundle2.auth?.invitations?.messages?.success?.resent).toBe('Invite resent');

    // ----- STEP 3: edit the hook, rebuild -----
    // Add a NEW t() call to a different namespace (the user's exact recipe).
    write(hookPath, `
      import { useI18n } from 'vite-bundled-i18n/react';
      export function useInvitationsActions() {
        const { t } = useI18n();
        return {
          onSent: () => t('auth.invitations.messages.success.sent'),
          onResent: () => t('auth.invitations.messages.success.resent'),
          onRevoked: () => t('auth.invitations.messages.success.revoked'),
          onFailed: () => t('auth.invitations.messages.error.operation_failed'),
          // NEW: an unrelated key in a different namespace.
          onShared: () => t('shared.ok'),
        };
      }
    `);
    fs.utimesSync(path.join(tmpDir, hookPath), future, future);

    buildOnce({ cacheDir });
    const bundle3 = readBundle();

    // The user's reported symptom: messages subtree disappears here.
    expect(bundle3.auth?.invitations?.messages?.success?.sent).toBe('Invite sent');
    expect(bundle3.auth?.invitations?.messages?.success?.resent).toBe('Invite resent');
    expect(bundle3.auth?.invitations?.messages?.success?.revoked).toBe('Invite revoked');
    expect(bundle3.auth?.invitations?.messages?.error?.operation_failed).toBe('Operation failed');
    // Pre-existing siblings still present.
    expect(bundle3.auth?.invitations?.actions?.create).toBe('Create invitation');
    expect(bundle3.auth?.invitations?.pages?.index?.title).toBe('Invitations');
  });
});
