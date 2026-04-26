import type { Rule } from 'eslint';

/**
 * Forbid `t.dynamic(...)` calls.
 *
 * The runtime escape hatch is intentionally kept available for cases where
 * a key is genuinely runtime-computed, but the **scope-bundle pipeline**
 * can't see those calls and won't ship the keys unless they're declared in
 * `bundling.dynamicKeys`. The lint rule's job is to surface every call
 * site so the developer either:
 *
 *   1. Replaces `t.dynamic(\`prefix.${var}\`)` with a switch helper that
 *      emits literal `t('prefix.<value>')` per case (the canonical fix), or
 *   2. Adds the key to `bundling.dynamicKeys` after deciding the dynamism
 *      is unavoidable.
 *
 * No autofix — the conversion to a switch helper is non-trivial and is
 * the codemod's job (`vite-bundled-i18n migrate dynamic-to-switch`).
 */
const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid `t.dynamic(...)` calls; build a switch helper that emits literal `t(...)` instead.',
      recommended: true,
    },
    schema: [],
    messages: {
      tDynamicForbidden:
        '`t.dynamic` hides keys from the static extractor. Build a switch helper that returns `t(\'literal-key\')` per case, or declare the keys in `bundling.dynamicKeys`. See the no-t-dynamic docs for the canonical pattern.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        // Match `t.dynamic(...)` AND `t['dynamic'](...)`. The bracket
        // form would otherwise let users sidestep the rule with a
        // one-character diff. The receiver must be the bare `t`
        // identifier in both cases.
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') return;
        if (callee.object.type !== 'Identifier' || callee.object.name !== 't') return;

        if (callee.computed) {
          // `t['dynamic']` — only flag when the bracket holds the
          // literal string 'dynamic'. Anything dynamic in there is
          // `<expr>.t[<expr>]()` which is no-member-access-t's domain.
          const prop = callee.property as { type: string; value?: unknown };
          if (prop.type !== 'Literal' || prop.value !== 'dynamic') return;
        } else {
          if (callee.property.type !== 'Identifier' || callee.property.name !== 'dynamic') return;
        }

        context.report({
          node,
          messageId: 'tDynamicForbidden',
        });
      },
    };
  },
};

export default rule;
