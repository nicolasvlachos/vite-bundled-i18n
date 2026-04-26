import type { Rule } from 'eslint';
import type {
  Identifier,
  Node,
  ObjectPattern,
  Property,
  VariableDeclarator,
} from 'estree';

/**
 * Forbid every form of renaming the `t` translator. The extractor walks
 * the AST looking for `t(<literal>)` calls — anything bound under a
 * different name is invisible.
 *
 * Three call-site shapes:
 *
 *   - **Destructure rename** — `const { t: tr } = useI18n()`. Autofixed:
 *     the destructure pattern is rewritten to `const { t } = useI18n()`,
 *     and every reference to the alias `tr` in the binding's scope is
 *     renamed to `t`. Safe because we use ESLint's scope manager to find
 *     every reference and reject the autofix if any usage looks ambiguous
 *     (shadowing).
 *   - **Variable alias** — `const tr = t`. Error only. The aliased usage
 *     could be a non-trivial expression elsewhere, so a blind rename
 *     across the file is risky.
 *   - **Function alias** — `function tr(k) { return t(k); }` and the
 *     arrow form. Error only.
 */
const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid renaming the `t` translator; the extractor matches the literal `t` identifier.',
      recommended: true,
    },
    schema: [],
    fixable: 'code',
    messages: {
      destructureRename:
        'Destructuring `t` under a different name (`{ t: {{name}} }`) hides calls from the extractor. Use `{ t }` directly. Autofix available.',
      variableAlias:
        'Variable alias of `t` hides calls from the extractor. Use `t` directly at call sites.',
      functionAlias:
        'Wrapping `t` in another function hides calls from the extractor. Inline the helper or accept `t` as a parameter and call it as `t(...)` inside.',
    },
  },

  create(context) {
    const sourceCode = context.getSourceCode();

    /**
     * Resolve the binding for the alias identifier and rewrite every
     * reference inside that binding's scope. Returns null if the rename
     * isn't safe (no scope info, shadowed elsewhere) so the rule can
     * fall back to error-only.
     */
    function makeRenameFix(
      destructureNode: ObjectPattern,
      property: Property,
      aliasIdentifier: Identifier,
    ): Rule.ReportFixer | null {
      // ESLint 9 dropped `context.getScope()` in favour of
       // `sourceCode.getScope(node)`. Cast for the v8 fallback path so the
       // type-only-emit declaration build doesn't trip over the missing
       // method on the modern RuleContext type.
      const startScope = sourceCode.getScope?.(destructureNode)
        ?? (context as unknown as { getScope: () => ReturnType<NonNullable<typeof sourceCode.getScope>> }).getScope();

      // The alias variable lives in the scope that contains the
      // destructure statement (or any ancestor — `let { t: tr } = ...`
      // declared in a block hoists to the block scope, but a `var`
      // declaration would float to the function scope). Walk upward
      // until we find a binding with the alias's name.
      type Scope = typeof startScope;
      function findVariable(name: string): { variable: Scope['variables'][number]; scope: Scope } | null {
        let s: Scope | null = startScope;
        while (s) {
          const v = s.variables.find((vv) => vv.name === name);
          if (v) return { variable: v, scope: s };
          s = (s.upper as Scope | null) ?? null;
        }
        return null;
      }

      const aliasFound = findVariable(aliasIdentifier.name);
      if (!aliasFound) return null;
      const variable = aliasFound.variable;

      // If renaming `<alias>` to `t` would collide with ANY other
      // identifier named `t` reachable from the alias's binding scope —
      // either a sibling binding in the same scope, or an outer
      // binding the rename would shadow — bail to error-only. The
      // outer-scope walk catches the case where the user has a
      // module-level `t` helper and the destructure happens inside a
      // function: blindly renaming would silently shadow that helper.
      const existingT = findVariable('t');
      if (existingT && existingT.variable !== variable) return null;

      return (fixer) => {
        const fixes: Rule.Fix[] = [];

        // 1. Rewrite the destructure pattern: replace the property
        //    `t: alias` with just `t`. Leave other properties alone.
        const propRange = (property as Node & { range?: [number, number] }).range;
        if (propRange) {
          fixes.push(fixer.replaceTextRange(propRange, 't'));
        }

        // 2. Rename every reference to the alias inside its scope to `t`.
        for (const ref of variable.references) {
          const id = ref.identifier as Node;
          // Skip the binding declaration itself (handled above).
          if (id === aliasIdentifier) continue;
          const refRange = (id as Node & { range?: [number, number] }).range;
          if (refRange) {
            fixes.push(fixer.replaceTextRange(refRange, 't'));
          }
        }
        return fixes;
      };
    }

    return {
      // Destructure rename: `const { t: <alias> } = ...;`
      ObjectPattern(node) {
        for (const prop of node.properties) {
          if (prop.type !== 'Property') continue;
          if (prop.key.type !== 'Identifier' || prop.key.name !== 't') continue;
          if (prop.value.type !== 'Identifier') continue;
          const alias = prop.value as Identifier;
          if (alias.name === 't') continue; // not a rename

          const fix = makeRenameFix(node, prop, alias);
          context.report({
            node: prop,
            messageId: 'destructureRename',
            data: { name: alias.name },
            fix: fix ?? undefined,
          });
        }
      },

      // Variable alias: `const tr = t;` and arrow-function alias
      // `const tr = (k) => t(k);` (the arrow form is detected here too
      // because it also lives on a VariableDeclarator).
      VariableDeclarator(node: VariableDeclarator) {
        if (node.id.type !== 'Identifier') return;
        if (node.id.name === 't') return; // not aliased
        if (!node.init) return;

        // `const tr = t;`
        if (
          node.init.type === 'Identifier' &&
          node.init.name === 't'
        ) {
          context.report({
            node,
            messageId: 'variableAlias',
          });
          return;
        }

        // `const tr = (k) => t(k);` — arrow function alias.
        if (node.init.type === 'ArrowFunctionExpression') {
          if (isReturnsTCallOf(node.init.body, node.init.params)) {
            context.report({
              node,
              messageId: 'variableAlias',
            });
          }
        }
      },

      // Function alias: `function tr(k) { return t(k); }`
      FunctionDeclaration(node) {
        if (!node.id) return;
        if (node.id.name === 't') return;
        if (isReturnsTCallOf(node.body, node.params)) {
          context.report({
            node,
            messageId: 'functionAlias',
          });
        }
      },
    };
  },
};

/**
 * Heuristic: does the function's body just return `t(<the params>)`?
 * Matches `function tr(k) { return t(k); }`, the arrow `(k) => t(k)`, and
 * `(k, p) => t(k, p)`. Avoids false positives on wrappers that do real work.
 */
function isReturnsTCallOf(
  body: Node,
  params: Node[],
): boolean {
  // Arrow body can be an expression or a block statement.
  let returnExpr: Node | undefined;
  if (body.type === 'BlockStatement') {
    const stmts = (body as { body: Node[] }).body;
    if (stmts.length !== 1) return false;
    if (stmts[0].type !== 'ReturnStatement') return false;
    returnExpr = (stmts[0] as { argument?: Node }).argument;
  } else {
    returnExpr = body;
  }
  if (!returnExpr) return false;
  if (returnExpr.type !== 'CallExpression') return false;

  const callee = (returnExpr as { callee: Node }).callee;
  if (callee.type !== 'Identifier' || (callee as Identifier).name !== 't') return false;

  // Args must mirror the params positionally, and only forward params
  // (no extra args, no transformations).
  const args = (returnExpr as { arguments: Node[] }).arguments;
  if (args.length !== params.length) return false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const p = params[i];
    if (a.type !== 'Identifier' || p.type !== 'Identifier') return false;
    if ((a as Identifier).name !== (p as Identifier).name) return false;
  }
  return true;
}

export default rule;
