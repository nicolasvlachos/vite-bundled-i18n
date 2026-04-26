import { describe, it, expect } from 'vitest';
import { pruneNamespace, generateBundles } from '../../extractor/bundle-generator';
import type { ProjectAnalysis } from '../../extractor/walker-types';
import type { ExtractedKey } from '../../extractor/types';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * User-reported bug:
 *
 *   Cross-namespace packing drops sub-namespace keys when they collide
 *   with a top-level sibling key under the same root namespace.
 *
 * Repro fixture:
 *   - locales/en/auth.json has BOTH:
 *       messages: { login: { failed: '...' } }            // top-level
 *       invitations: { messages: { success: { sent: '...' } } }  // nested
 *   - Page registers scope `auth.invitations.index`
 *   - Page calls `t('auth.invitations.messages.success.sent')` (literal)
 *
 * Expected: the emitted scope bundle includes
 *   `auth.invitations.messages.success.sent`.
 *
 * Bug: the bundle has other auth.invitations.* keys but is missing
 * `auth.invitations.messages.*`. The user's hypothesis: dedupe step
 * normalizes `auth.messages` and `auth.invitations.messages` to the
 * same path somewhere.
 */

describe('bug: cross-ns sub-namespace collision', () => {
  it('pruneNamespace keeps both top-level and nested same-named keys', () => {
    const fullData = {
      messages: {
        login: { failed: 'Login failed' },
      },
      invitations: {
        messages: {
          success: { sent: 'Invite sent' },
        },
        actions: { create: 'Create' },
        pages: { index: { title: 'Invitations' } },
      },
    };

    // Both keys requested — both should land in the result.
    const result = pruneNamespace(fullData, [
      'messages.login.failed',
      'invitations.messages.success.sent',
      'invitations.actions.create',
      'invitations.pages.index.title',
    ]) as Record<string, unknown>;

    expect((result.messages as { login: { failed: string } }).login.failed).toBe('Login failed');
    // The bug: this assertion will fail if the dedupe collision exists.
    expect(((result.invitations as { messages: { success: { sent: string } } }).messages.success.sent)).toBe('Invite sent');
    expect(((result.invitations as { actions: { create: string } }).actions.create)).toBe('Create');
  });

  it('end-to-end: scope bundle for auth.invitations.index includes the nested messages.success.sent key', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-bug-cross-ns-'));
    try {
      // locales/en/auth.json
      fs.mkdirSync(path.join(tmpDir, 'locales/en'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'locales/en/auth.json'),
        JSON.stringify({
          messages: { login: { failed: 'Login failed' } },
          invitations: {
            messages: { success: { sent: 'Invite sent' } },
            actions: { create: 'Create invitation' },
            pages: { index: { title: 'Invitations' } },
          },
        }),
      );

      // Synthesize a ProjectAnalysis with the route + extracted keys.
      const makeKey = (key: string): ExtractedKey => ({ key, dynamic: false, line: 1, column: 0 });
      const analysis: ProjectAnalysis = {
        routes: [
          {
            entryPoint: '/fake/pages/auth/invitations/index.tsx',
            routeId: 'auth-invitations-index',
            scopes: ['auth.invitations.index'],
            entryScopes: ['auth.invitations.index'],
            keys: [
              makeKey('auth.invitations.messages.success.sent'),
              makeKey('auth.invitations.actions.create'),
              makeKey('auth.invitations.pages.index.title'),
            ],
            files: [],
          },
        ],
        availableNamespaces: ['auth'],
        allKeys: [],
        sharedNamespaces: [],
      };

      const outDir = path.join(tmpDir, 'out');
      generateBundles(analysis, {
        localesDir: path.join(tmpDir, 'locales'),
        locales: ['en'],
        outDir,
      });

      const bundlePath = path.join(outDir, 'en', 'auth.invitations.index.json');
      expect(fs.existsSync(bundlePath)).toBe(true);
      const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));

      // Ought to contain the nested key — currently dropped per the bug.
      expect(bundle.auth?.invitations?.messages?.success?.sent).toBe('Invite sent');
      expect(bundle.auth?.invitations?.actions?.create).toBe('Create invitation');
      expect(bundle.auth?.invitations?.pages?.index?.title).toBe('Invitations');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
