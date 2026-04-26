import type { Rule } from 'eslint';
import type { CallExpression, Node } from 'estree';

/**
 * Forbid `t(<arg>)` where the first argument isn't a `StringLiteral`.
 *
 * The extractor parses `t(<literal>, ...)` patterns by AST shape — only
 * literal first arguments contribute to scope bundles. Anything else
 * (ternary, template literal, identifier, member access, call expression)
 * is silently invisible, and at runtime the consumer sees raw key strings
 * instead of translations.
 *
 * Three subcases get distinct messages so the developer knows the
 * remediation for each shape:
 *
 *   - **Ternary** — `t(cond ? 'a' : 'b')` → autofix to
 *     `cond ? t('a') : t('b')`. Both branches become first-class literal
 *     calls the extractor sees. Extra arguments (params/fallback) are
 *     forwarded to both expanded calls.
 *   - **Template literal** — `` t(`x.${var}`) `` → no autofix. The
 *     remediation is a switch helper (or `bundling.dynamicKeys` if the
 *     dynamism is unavoidable). The conversion is non-trivial.
 *   - **Computed (Identifier / MemberExpression / CallExpression)** —
 *     `t(key)`, `t(MAP[x])`, `t(getKey(x))` → no autofix. Same remediation
 *     as the template-literal case.
 */
const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid `t(<non-literal>)`; the extractor only sees literal first arguments.',
      recommended: true,
    },
    schema: [],
    fixable: 'code',
    messages: {
      ternaryArg:
        'Ternary inside `t()` hides both branches from the extractor. Hoist the ternary outside: `cond ? t(\'a\') : t(\'b\')`. Autofix available.',
      templateLiteralArg:
        'Template literal inside `t()` is invisible to the extractor. Replace with a switch helper that returns `t(\'literal-key\')` per case, or declare the keys via `bundling.dynamicKeys`.',
      computedArg:
        'Computed argument inside `t()` is invisible to the extractor. Replace with a switch helper that returns `t(\'literal-key\')` per case.',
    },
  },

  create(context) {
    const sourceCode = context.getSourceCode();

    /**
     * Read original source text for a node — preserves whitespace +
     * comments so the autofix output is byte-identical to what the
     * developer would write.
     */
    function sourceOf(n: Node): string {
      const range = (n as Node & { range?: [number, number] }).range;
      if (!range) return '';
      return sourceCode.text.slice(range[0], range[1]);
    }

    return {
      CallExpression(node) {
        if (!isBareTCall(node)) return;
        const arg = node.arguments[0];
        if (!arg) return;
        if (arg.type === 'Literal' && typeof (arg as { value?: unknown }).value === 'string') return;

        if (arg.type === 'ConditionalExpression') {
          // Only autofix when both branches are string literals — otherwise
          // expanding just moves the non-literal one level out (it'd
          // re-trigger this rule on the expanded call). The plain report
          // surfaces it; the user resolves manually.
          const bothLiterals =
            arg.consequent.type === 'Literal' &&
            typeof (arg.consequent as { value?: unknown }).value === 'string' &&
            arg.alternate.type === 'Literal' &&
            typeof (arg.alternate as { value?: unknown }).value === 'string';

          // The fix duplicates the entire call into the two branches —
          // including every rest arg. If a rest arg has side effects
          // (function call, getter access, JSX), we'd silently double
          // them. Restrict the autofix to rest args that are safe to
          // duplicate: literals, identifiers, member access without
          // function calls. Anything else → report-only, user resolves.
          function isSafeToDuplicate(n: Node): boolean {
            switch (n.type) {
              case 'Literal':
              case 'Identifier':
              case 'TemplateLiteral': // expressions inside still get evaluated, but TL of literals is common + safe enough
                return n.type !== 'TemplateLiteral' || n.expressions.length === 0;
              case 'MemberExpression':
                return !n.computed && isSafeToDuplicate(n.object as Node);
              case 'ObjectExpression':
                // Only safe when every property value is itself safe (and no
                // computed keys / spread which could reference side-effecting
                // expressions).
                return n.properties.every((p) => {
                  if (p.type !== 'Property') return false;
                  if (p.computed) return false;
                  return isSafeToDuplicate(p.value as Node);
                });
              default:
                return false;
            }
          }

          const restArgsAreSafe = node.arguments
            .slice(1)
            .every((a) => isSafeToDuplicate(a as Node));

          context.report({
            node: arg,
            messageId: 'ternaryArg',
            fix: bothLiterals && restArgsAreSafe
              ? (fixer) => {
                  const calleeText = sourceOf(node.callee as Node);
                  const testText = sourceOf(arg.test as Node);
                  const consequentText = sourceOf(arg.consequent as Node);
                  const alternateText = sourceOf(arg.alternate as Node);
                  const restArgs = node.arguments.slice(1);
                  const restText = restArgs.length === 0
                    ? ''
                    : ', ' + restArgs.map((a) => sourceOf(a as Node)).join(', ');

                  return fixer.replaceText(
                    node,
                    `${testText} ? ${calleeText}(${consequentText}${restText}) : ${calleeText}(${alternateText}${restText})`,
                  );
                }
              : undefined,
          });
          return;
        }

        if (arg.type === 'TemplateLiteral') {
          context.report({
            node: arg,
            messageId: 'templateLiteralArg',
          });
          return;
        }

        // Identifier, MemberExpression, CallExpression, etc.
        context.report({
          node: arg,
          messageId: 'computedArg',
        });
      },
    };
  },
};

/**
 * Match `t(<args>)` exactly: callee is the bare `t` identifier (not
 * `props.t`, not `tr`). Member-access cases are handled by
 * `no-member-access-t`, rename cases by `no-renamed-t`.
 */
function isBareTCall(node: CallExpression): boolean {
  const callee = node.callee as Node;
  return callee.type === 'Identifier' && callee.name === 't';
}

export default rule;
