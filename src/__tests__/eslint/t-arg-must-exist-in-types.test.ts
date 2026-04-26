import { describe, afterAll, beforeEach } from 'vitest';
import { RuleTester } from 'eslint';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import rule, { __clearKeyspaceCacheForTests } from '../../eslint/rules/t-arg-must-exist-in-types';

// RuleTester.run() is called at module-load time, so the fixture path must
// exist BEFORE the test cases are constructed (`options: [{ localesDir }]`
// is evaluated eagerly). Doing the mkdtemp + JSON write at module top-level
// guarantees the path is real by the time `it()` runs. afterAll cleans up.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-rule5-'));
const localesDir = path.join(tmpDir, 'locales');
fs.mkdirSync(path.join(localesDir, 'en'), { recursive: true });
fs.writeFileSync(
  path.join(localesDir, 'en', 'shared.json'),
  JSON.stringify({
    ok: 'OK',
    cancel: 'Cancel',
    forms: { validation: { required: 'This field is required' } },
  }),
);
fs.writeFileSync(
  path.join(localesDir, 'en', 'auth.json'),
  JSON.stringify({
    login: { failed: 'Login failed' },
    invitations: { messages: { success: { sent: 'Invite sent' } } },
  }),
);

const emptyTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-rule5-empty-'));
fs.mkdirSync(path.join(emptyTmpDir, 'locales/en'), { recursive: true });

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(emptyTmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  __clearKeyspaceCacheForTests();
});

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

const opts = [{ localesDir, defaultLocale: 'en' }];

describe('t-arg-must-exist-in-types', () => {
  ruleTester.run('t-arg-must-exist-in-types', rule, {
    valid: [
      // Existing keys.
      { code: `t('shared.ok');`, options: opts },
      { code: `t('shared.cancel');`, options: opts },
      { code: `t('shared.forms.validation.required');`, options: opts },
      { code: `t('auth.login.failed');`, options: opts },
      { code: `t('auth.invitations.messages.success.sent');`, options: opts },

      // Non-literal arg — no-non-literal-t-arg's domain. Skipped here.
      { code: `const k = 'shared.ok'; t(k);`, options: opts },
      { code: `t(\`shared.\${'ok'}\`);`, options: opts },
      { code: `t(cond ? 'shared.ok' : 'shared.cancel');`, options: opts },

      // Member-access — no-member-access-t's domain. Skipped here.
      { code: `props.t('totally.fake.key');`, options: opts },

      // t.dynamic with a prefix that matches at least one key.
      { code: `t.dynamic('shared.');`, options: opts },
      { code: `t.dynamic('auth.invitations.messages.');`, options: opts },
      { code: `t.dynamic('shared.forms.validation.');`, options: opts },

      // Calls without arguments (parser would normally still call this a
      // CallExpression). Not flagged.
      { code: `t();`, options: opts },
    ],

    invalid: [
      {
        code: `t('shared.totally.missing');`,
        options: opts,
        errors: [{ messageId: 'keyMissing' }],
      },
      {
        code: `t('typo.in.namespace');`,
        options: opts,
        errors: [{ messageId: 'keyMissing' }],
      },
      // Capitalization sensitivity.
      {
        code: `t('Shared.ok');`,
        options: opts,
        errors: [{ messageId: 'keyMissing' }],
      },
      // Trailing-dot common typo.
      {
        code: `t('shared.ok.');`,
        options: opts,
        errors: [{ messageId: 'keyMissing' }],
      },
      // Missing prefix (typo).
      {
        code: `t.dynamic('shered.');`,
        options: opts,
        errors: [{ messageId: 'dynamicPrefixMissing' }],
      },
      // Multiple invalid calls in one file → one error each.
      {
        code: `t('a'); t('b');`,
        options: opts,
        errors: [
          { messageId: 'keyMissing' },
          { messageId: 'keyMissing' },
        ],
      },
    ],
  });
});

describe('t-arg-must-exist-in-types: empty keyspace', () => {
  // A separate ruleTester run with an empty fixture confirms the
  // "warn once, then silent" behavior. The rule reports `keyspaceEmpty`
  // from the Program node — no spurious key-missing reports.
  ruleTester.run('t-arg-must-exist-in-types (empty)', rule, {
    valid: [],
    invalid: [
      {
        code: `t('anything.at.all'); t('and.again');`,
        options: [{ localesDir: path.join(emptyTmpDir, 'locales'), defaultLocale: 'en' }],
        errors: [{ messageId: 'keyspaceEmpty' }], // single warning at Program level
      },
    ],
  });
});
