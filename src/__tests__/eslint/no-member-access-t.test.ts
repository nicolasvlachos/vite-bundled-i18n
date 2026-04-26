import { RuleTester } from 'eslint';
import noMemberAccessT from '../../eslint/rules/no-member-access-t';

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
 * `no-member-access-t` — flags every `<expr>.t(...)` member-access call
 * (props.t, this.i18n.t, show.t, etc.). The extractor only matches the
 * bare `t` identifier; reaching it through any object hides the call
 * site. Note: `t.dynamic(...)` is the special case owned by no-t-dynamic
 * and skipped here.
 */
ruleTester.run('no-member-access-t', noMemberAccessT, {
  valid: [
    // Bare `t()` — fine.
    `const t = (k) => k;
     t('shared.ok');`,

    // Chain that doesn't end in `.t()`.
    `const obj = { foo: () => '' };
     obj.foo();`,

    // `obj.translate(...)` — different method name.
    `const obj = { translate: (k) => k };
     obj.translate('shared.ok');`,

    // `t.dynamic(...)` — skip; that's no-t-dynamic's domain. The rule
    // only fires on `<expr>.t(...)` where `t` is the property name.
    `const t = { dynamic: () => '' };
     t.dynamic('shared.ok');`,

    // Member access without invocation — not a call.
    `const props = { t: () => '' };
     const ref = props.t;
     ref();`,

    // Computed bracket access with a non-string key — dynamic, not
    // flaggable here. Stays valid.
    `const props = { t: () => '' };
     const k = 't';
     props[k]('shared.ok');`,
  ],

  invalid: [
    // `props.t(...)` — common Inertia / page-context anti-pattern.
    {
      code: `const props = { t: (k) => k }; props.t('shared.ok');`,
      errors: [{ messageId: 'memberAccessT' }],
    },

    // `this.i18n.t(...)` — class-style.
    {
      code: `const obj = { i18n: { t: (k) => k }, run() { return this.i18n.t('shared.ok'); } };
             obj.run();`,
      errors: [{ messageId: 'memberAccessT' }],
    },

    // `show.t(...)` — Inertia page object.
    {
      code: `const show = { t: (k) => k }; show.t('shared.ok');`,
      errors: [{ messageId: 'memberAccessT' }],
    },

    // Nested member access: `app.context.i18n.t(...)`.
    {
      code: `const app = { context: { i18n: { t: (k) => k } } }; app.context.i18n.t('shared.ok');`,
      errors: [{ messageId: 'memberAccessT' }],
    },

    // Inside JSX.
    {
      code: `const props = { t: (k) => k };
             const C = () => <span>{props.t('shared.label')}</span>;`,
      errors: [{ messageId: 'memberAccessT' }],
    },

    // Multiple call sites — one error per call.
    {
      code: `const props = { t: (k) => k };
             props.t('a');
             props.t('b');`,
      errors: [
        { messageId: 'memberAccessT' },
        { messageId: 'memberAccessT' },
      ],
    },

    // Bracket access with a string-literal key — equivalent to dot
    // access for the extractor's purposes, so flag it. (P1 fix.)
    {
      code: `const props = { t: (k) => k }; props['t']('shared.ok');`,
      errors: [{ messageId: 'memberAccessT' }],
    },
  ],
});
