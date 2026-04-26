import type { Rule } from 'eslint';
import type { Node } from 'estree';

/**
 * Forbid `<expr>.t(...)` calls — the extractor only recognizes the bare
 * `t` identifier, never reached through an object.
 *
 * The rule deliberately skips `t.dynamic(...)` since that's the dedicated
 * `no-t-dynamic` rule's domain (different remediation, dedicated message).
 *
 * Bracket access (`obj['t'](...)`) is also out of scope here — it's a
 * less common pattern and benefits from a separate rule with its own
 * detection heuristics.
 */
const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid `<expr>.t(...)` member-access calls; the extractor only sees the bare `t` identifier.',
      recommended: true,
    },
    schema: [],
    messages: {
      memberAccessT:
        '`t` reached via `<expr>.t` is invisible to the extractor. Get `t` directly from `useI18n()` (React) or via `getTranslations()` and bind to a local `const { t } = ...` in this file.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee as Node;
        if (callee.type !== 'MemberExpression') return;
        if (callee.property.type !== 'Identifier' && callee.property.type !== 'Literal') return;

        // Resolve the property name from either dot or bracket access.
        // Bracket access with a non-string-literal key (`obj[someVar]`)
        // is dynamic and not flaggable here — skip.
        let propName: string | undefined;
        if (!callee.computed && callee.property.type === 'Identifier') {
          propName = callee.property.name;
        } else if (callee.computed && callee.property.type === 'Literal') {
          const v = (callee.property as { value?: unknown }).value;
          if (typeof v === 'string') propName = v;
        }
        if (propName !== 't') return;

        // Skip `t.dynamic(...)` / `t['dynamic'](...)` — that's no-t-dynamic's
        // job. We only flag when the property IS `t`, so `t.dynamic()`
        // never matches above. We also skip the case where `<expr>` is
        // itself the bare `t` — `t.t()` / `t['t']()` is exotic, probably
        // a bug, leave to a separate rule.
        if (
          callee.object.type === 'Identifier' &&
          (callee.object as { name: string }).name === 't'
        ) {
          return;
        }

        context.report({
          node,
          messageId: 'memberAccessT',
        });
      },
    };
  },
};

export default rule;
