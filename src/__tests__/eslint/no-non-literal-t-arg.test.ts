import { RuleTester } from 'eslint';
import noNonLiteralTArg from '../../eslint/rules/no-non-literal-t-arg';

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
 * `no-non-literal-t-arg` — flags `t(<arg>)` where the first argument
 * isn't a `StringLiteral`. The extractor only reads literal arguments,
 * so anything else is a silent miss.
 *
 * Three subcases with distinct messages:
 *   - Ternary: `t(cond ? 'a' : 'b')` → autofix to `cond ? t('a') : t('b')`
 *   - Template literal: `` t(`x.${var}`) `` → no autofix; suggest helper
 *   - Identifier / member / call: `t(key)` / `t(MAP[x])` / `t(getKey(x))`
 *     → no autofix; suggest helper
 */
ruleTester.run('no-non-literal-t-arg', noNonLiteralTArg, {
  valid: [
    // Plain literal — the canonical form.
    `const t = (k) => k;
     t('shared.ok');`,

    // Literal + params object.
    `const t = (k, p) => k;
     t('cart.total', { amount: 9.99 });`,

    // Literal + fallback + params.
    `const t = (k, p, f) => k;
     t('cart.total', { amount: 9.99 }, '{{amount}} EUR');`,

    // Calling a non-`t` function with non-literal — unrelated.
    `const log = (msg) => msg;
     const x = 'foo';
     log(\`logged \${x}\`);`,

    // `t.dynamic(...)` is no-t-dynamic's job, not ours.
    `const t = { dynamic: () => '' };
     t.dynamic('anything');`,

    // Empty string literal — still a literal.
    `const t = (k) => k;
     t('');`,

    // Nested t inside JSX with literal arg.
    `const t = (k) => k;
     const C = () => <span>{t('shared.ok')}</span>;`,
  ],

  invalid: [
    // Ternary — autofixable to `cond ? t('a') : t('b')`.
    {
      code: `const t = (k) => k; const cond = true; t(cond ? 'shared.ok' : 'shared.cancel');`,
      errors: [{ messageId: 'ternaryArg' }],
      output: `const t = (k) => k; const cond = true; cond ? t('shared.ok') : t('shared.cancel');`,
    },

    // Template literal — no autofix; specific message.
    {
      code: `const t = (k) => k; const v = 'active'; t(\`status.\${v}\`);`,
      errors: [{ messageId: 'templateLiteralArg' }],
    },

    // Identifier — no autofix.
    {
      code: `const t = (k) => k; const key = 'shared.ok'; t(key);`,
      errors: [{ messageId: 'computedArg' }],
    },

    // Member access — no autofix.
    {
      code: `const t = (k) => k; const KEY_MAP = { a: 'shared.ok' }; t(KEY_MAP['a']);`,
      errors: [{ messageId: 'computedArg' }],
    },

    // Call expression — no autofix.
    {
      code: `const t = (k) => k; const getKey = (x) => 'shared.' + x; t(getKey('ok'));`,
      errors: [{ messageId: 'computedArg' }],
    },

    // Ternary with fallback string — autofix preserves the second arg.
    {
      code: `const t = (k, f) => k; const cond = true; t(cond ? 'a' : 'b', 'fallback');`,
      errors: [{ messageId: 'ternaryArg' }],
      output: `const t = (k, f) => k; const cond = true; cond ? t('a', 'fallback') : t('b', 'fallback');`,
    },

    // Ternary with non-literal branches — still flagged but not autofixed
    // (expanding would propagate the non-literal arg into the new t calls).
    {
      code: `const t = (k) => k; const a = 'x'; const b = 'y'; const cond = true; t(cond ? a : b);`,
      errors: [{ messageId: 'ternaryArg' }],
    },

    // Inside JSX, ternary still autofixed.
    {
      code: `const t = (k) => k; const cond = true; const C = () => <span>{t(cond ? 'shared.ok' : 'shared.cancel')}</span>;`,
      errors: [{ messageId: 'ternaryArg' }],
      output: `const t = (k) => k; const cond = true; const C = () => <span>{cond ? t('shared.ok') : t('shared.cancel')}</span>;`,
    },

    // Multiple call sites — one error per call. The ternary has literal
    // branches so it gets autofixed; the others are reported but not fixed.
    {
      code: `const t = (k) => k; const a = 'x'; const cond = true;
             t(a);
             t(cond ? 'a' : 'b');
             t(\`x.\${a}\`);`,
      errors: [
        { messageId: 'computedArg' },
        { messageId: 'ternaryArg' },
        { messageId: 'templateLiteralArg' },
      ],
      output: `const t = (k) => k; const a = 'x'; const cond = true;
             t(a);
             cond ? t('a') : t('b');
             t(\`x.\${a}\`);`,
    },

    // C8 fix: when the rest args contain a function call (potential side
    // effect), the autofix must NOT duplicate them. Report only — output
    // unchanged.
    {
      code: `const t = (k, p) => k; const cond = true; const sideEffect = () => ({ x: 1 });
             t(cond ? 'a' : 'b', sideEffect());`,
      errors: [{ messageId: 'ternaryArg' }],
      output: null, // no autofix — would have duplicated sideEffect()
    },

    // C8 fix: rest args with safe-to-duplicate object literal (no
    // computed keys, no nested function calls) — autofix proceeds.
    {
      code: `const t = (k, p) => k; const cond = true;
             t(cond ? 'a' : 'b', { count: 1 });`,
      errors: [{ messageId: 'ternaryArg' }],
      output: `const t = (k, p) => k; const cond = true;
             cond ? t('a', { count: 1 }) : t('b', { count: 1 });`,
    },

    // C8 fix: rest args with identifier (cheap to duplicate) — autofix proceeds.
    {
      code: `const t = (k, p) => k; const cond = true; const params = { x: 1 };
             t(cond ? 'a' : 'b', params);`,
      errors: [{ messageId: 'ternaryArg' }],
      output: `const t = (k, p) => k; const cond = true; const params = { x: 1 };
             cond ? t('a', params) : t('b', params);`,
    },
  ],
});
