import { RuleTester } from 'eslint';
import noTDynamic from '../../eslint/rules/no-t-dynamic';

// RuleTester injects describe/it into the surrounding scope and must be
// called at module top-level (not inside an `it()`), otherwise it asserts
// that suites can't be nested inside test functions.

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

/**
 * `no-t-dynamic` — flags every `t.dynamic(...)` call. The runtime escape
 * hatch stays available, but the lint pass surfaces every site so the
 * developer either rewrites to a switch helper or registers the keys via
 * `bundling.dynamicKeys`.
 */
ruleTester.run('no-t-dynamic', noTDynamic, {
  valid: [
    // Plain literal `t()` is the canonical form.
    `const t = (k) => k;
     t('shared.ok');`,

    // `.dynamic` chain on a non-`t` identifier — unrelated.
    `const cache = { dynamic: () => '' };
     cache.dynamic('anything');`,

    // `.dynamic` accessed but not called — only call sites are flagged.
    `const t = { dynamic: () => '' };
     const ref = t.dynamic;`,

    // Nested object property named `dynamic` — not a `t.dynamic` call
    // because the receiver of `.dynamic` isn't the bare `t` identifier.
    `const obj = { t: { dynamic: () => '' } };
     obj.t.dynamic('x');`,

    // Helper that itself emits literal `t()` — the canonical replacement
    // pattern. Should pass without complaint.
    `function statusLabel(t, state) {
       switch (state) {
         case 'a': return t('status.a');
         case 'b': return t('status.b');
       }
     }`,
  ],

  invalid: [
    // Bare `t.dynamic(...)`.
    {
      code: `const t = null; t.dynamic('shared.ok');`,
      errors: [{ messageId: 'tDynamicForbidden' }],
    },

    // With template literal — same diagnosis.
    {
      code: `const t = null; const state = 'active'; t.dynamic(\`status.\${state}\`);`,
      errors: [{ messageId: 'tDynamicForbidden' }],
    },

    // Inside JSX expression container.
    {
      code: `const t = null; const useMemo = (fn) => fn();
             const v = (() => <span>{t.dynamic('shared.label')}</span>);`,
      errors: [{ messageId: 'tDynamicForbidden' }],
    },

    // Inside a callback (e.g. useMemo factory).
    {
      code: `const t = null; const useMemo = (fn) => fn();
             const v = useMemo(() => t.dynamic('x.y'), [t]);`,
      errors: [{ messageId: 'tDynamicForbidden' }],
    },

    // Multiple call sites — one error per call.
    {
      code: `const t = null;
             t.dynamic('a');
             t.dynamic('b');
             t('c');`,
      errors: [
        { messageId: 'tDynamicForbidden' },
        { messageId: 'tDynamicForbidden' },
      ],
    },

    // Bracket access — `t['dynamic'](...)` was previously a silent
    // workaround. Now flagged so the rule can't be sidestepped with a
    // one-character diff. (P1 fix.)
    {
      code: `const t = null; t['dynamic']('shared.ok');`,
      errors: [{ messageId: 'tDynamicForbidden' }],
    },
  ],
});
