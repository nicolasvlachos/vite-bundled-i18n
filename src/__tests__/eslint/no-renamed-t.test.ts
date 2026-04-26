import { RuleTester } from 'eslint';
import noRenamedT from '../../eslint/rules/no-renamed-t';

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
 * `no-renamed-t` — flags every form of renaming the `t` translator
 * because the extractor matches the literal `t` identifier:
 *
 *   - Destructure rename: `const { t: tr } = useI18n()` — autofix to
 *     `const { t } = useI18n()` AND rename every `tr(...)` call in the
 *     binding's scope to `t(...)`. Safe because we use ESLint's scope
 *     analysis to find every reference.
 *   - Variable alias: `const tr = t;` — error only. Renaming all callsites
 *     across the file is risky for arbitrary expressions.
 *   - Function alias: `function tr(k) { return t(k) }` — error only.
 */
ruleTester.run('no-renamed-t', noRenamedT, {
  valid: [
    // Plain destructure — canonical.
    `const useI18n = () => ({ t: (k) => k });
     const { t } = useI18n();
     t('shared.ok');`,

    // Destructuring of OTHER props — irrelevant to this rule.
    `const useI18n = () => ({ t: (k) => k, locale: 'en' });
     const { locale } = useI18n();
     locale.toString();`,

    // Reassigning a non-`t` identifier — irrelevant.
    `const log = (m) => m; const tr = log; tr('x');`,

    // Function declaration that wraps something that isn't `t`.
    `const log = (m) => m; function tr(k) { return log(k); } tr('x');`,

    // Destructure with same name (no rename) — fine.
    `const obj = { t: () => '' };
     const { t } = obj;
     t();`,

    // Property destructure with computed key — no rename pattern.
    `const obj = { t: () => '' };
     const key = 't';
     const { [key]: alias } = obj;
     alias();`,
  ],

  invalid: [
    // Destructure rename — autofix renames the binding AND every
    // reference to the alias inside the same scope.
    {
      code: `const useI18n = () => ({ t: (k) => k });
const { t: tr } = useI18n();
tr('shared.ok');
tr('shared.cancel');`,
      errors: [{ messageId: 'destructureRename' }],
      output: `const useI18n = () => ({ t: (k) => k });
const { t } = useI18n();
t('shared.ok');
t('shared.cancel');`,
    },

    // Destructure rename with other properties present — only the `t`
    // property is rewritten; siblings are left alone.
    {
      code: `const useI18n = () => ({ t: (k) => k, locale: 'en' });
const { t: tr, locale } = useI18n();
tr('x');
locale.toString();`,
      errors: [{ messageId: 'destructureRename' }],
      output: `const useI18n = () => ({ t: (k) => k, locale: 'en' });
const { t, locale } = useI18n();
t('x');
locale.toString();`,
    },

    // Variable alias — error only, no autofix.
    {
      code: `const t = (k) => k; const tr = t; tr('shared.ok');`,
      errors: [{ messageId: 'variableAlias' }],
    },

    // Function alias — error only.
    {
      code: `const t = (k) => k; function tr(k) { return t(k); } tr('shared.ok');`,
      errors: [{ messageId: 'functionAlias' }],
    },

    // Arrow function alias — same shape as function alias.
    {
      code: `const t = (k) => k; const tr = (k) => t(k); tr('shared.ok');`,
      errors: [{ messageId: 'variableAlias' }],
    },

    // Destructure rename inside a callback — scope analysis must
    // limit renames to the inner scope.
    {
      code: `const useI18n = () => ({ t: (k) => k });
function C() {
  const { t: tr } = useI18n();
  return tr('x');
}`,
      errors: [{ messageId: 'destructureRename' }],
      output: `const useI18n = () => ({ t: (k) => k });
function C() {
  const { t } = useI18n();
  return t('x');
}`,
    },

    // C3 fix: when a SHADOWING `t` exists in an outer scope, the autofix
    // would silently shadow it. The rule still reports — but skips the
    // autofix (output stays equal to input). The user resolves manually.
    {
      code: `const useI18n = () => ({ t: (k) => k });
const t = (m) => 'outer-helper:' + m;
function C() {
  const { t: tr } = useI18n();
  return tr('x');
}`,
      errors: [{ messageId: 'destructureRename' }],
      output: null, // null = "no autofix applied"
    },
  ],
});
