import fs from 'node:fs';
import path from 'node:path';
import type { Rule } from 'eslint';
import type { Node, CallExpression, Literal } from 'estree';

/**
 * Forbid `t('key')` calls whose key argument doesn't exist in the
 * project's locale files. The complement of `no-non-literal-t-arg`:
 * that rule guarantees the argument is a string literal we can verify
 * against the keyspace; this rule does the verification.
 *
 * The keyspace is loaded from `<localesDir>/<defaultLocale>/*.json` —
 * one JSON-per-namespace, flat keys joined by dots. Cached per
 * `(localesDir, defaultLocale)` and invalidated by mtime so editing a
 * locale file mid-edit re-validates without an ESLint restart.
 *
 * Two call shapes are checked:
 *
 *  1. `t('foo.bar')` — must equal a flat key in the keyspace.
 *  2. `t.dynamic('foo.')` — the (string-literal) prefix must match at
 *     least one flat key. The remainder is opaque by definition; we
 *     can't validate it, but we CAN catch typos in the prefix itself.
 *
 * Non-literal arguments (variables, ternaries, templates) are skipped —
 * `no-non-literal-t-arg` is the rule that flags those. This rule trusts
 * its sibling rule to fire elsewhere if the argument isn't a literal.
 *
 * The rule is intentionally tolerant of misconfiguration: if the
 * locales directory doesn't exist or yields no keys, the rule emits a
 * single one-time warning and otherwise falls silent. The alternative
 * — flagging every single `t()` call as "key not found" because the
 * keyspace was empty — would be hostile to bootstrap projects.
 */

interface RuleOptions {
  /** Path to the locales directory, relative to ESLint's CWD. */
  localesDir?: string;
  /** Default locale name used as the canonical keyspace. */
  defaultLocale?: string;
}

interface CachedKeyspace {
  keys: Set<string>;
  /** mtime of the locale directory at load time — used to detect staleness. */
  signature: string;
  /** True when the directory was missing/empty; suppresses every-call warnings. */
  empty: boolean;
}

const keyspaceCache = new Map<string, CachedKeyspace>();
const warnedAbout = new Set<string>();

function flattenJsonKeys(data: unknown, prefix: string): string[] {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenJsonKeys(v, next));
    } else {
      out.push(next);
    }
  }
  return out;
}

/**
 * Build a stable signature for the locale directory: per-file mtime+size.
 * Cheap (one stat per file) and detects every shape of edit. Returned
 * as a sorted string so identical states produce identical signatures.
 */
function signatureFor(dir: string): string {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return 'missing';
  }

  const parts: string[] = [];
  for (const name of entries) {
    try {
      const stat = fs.statSync(path.join(dir, name));
      parts.push(`${name}:${stat.mtimeMs}:${stat.size}`);
    } catch {
      parts.push(`${name}:missing`);
    }
  }
  return parts.join('|');
}

function loadKeyspace(localesDir: string, defaultLocale: string): CachedKeyspace {
  const dir = path.resolve(localesDir, defaultLocale);
  const signature = signatureFor(dir);
  const cached = keyspaceCache.get(dir);
  if (cached && cached.signature === signature) return cached;

  const keys = new Set<string>();
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch { /* missing dir → empty keyspace */ }

  for (const name of entries) {
    const namespace = name.slice(0, -'.json'.length);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8'));
    } catch { continue; }
    for (const key of flattenJsonKeys(parsed, namespace)) {
      keys.add(key);
    }
  }

  const result: CachedKeyspace = {
    keys,
    signature,
    empty: keys.size === 0,
  };
  keyspaceCache.set(dir, result);

  // If the previous result for this dir was empty AND we'd warned
  // about it, drop the warning so subsequent populated re-loads
  // start producing real findings instead of staying silent. Without
  // this the IDE / ESLint daemon would refuse to ever fire the rule
  // for a project that bootstrapped with no JSON files.
  if (!result.empty) {
    warnedAbout.delete(`${dir}|empty`);
  }
  return result;
}

function isStringLiteral(node: Node | undefined): node is Literal & { value: string } {
  return !!node && node.type === 'Literal' && typeof (node as Literal).value === 'string';
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Validate that the static argument to `t()` / `t.dynamic()` exists in the project\'s locale files.',
      recommended: false,
    },
    schema: [
      {
        type: 'object',
        properties: {
          localesDir: { type: 'string' },
          defaultLocale: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      keyMissing:
        'Translation key "{{key}}" does not exist in {{localesDir}}/{{defaultLocale}}/. ' +
        'Add it to a namespace JSON file, or remove the `t()` call.',
      dynamicPrefixMissing:
        'Dynamic prefix "{{prefix}}" matches no key under {{localesDir}}/{{defaultLocale}}/. ' +
        'Either the prefix is misspelled or the matching keys haven\'t been added yet.',
      keyspaceEmpty:
        'vite-bundled-i18n/t-arg-must-exist-in-types: locale directory at {{path}} is missing or empty. ' +
        'The rule cannot validate keys; it will silently pass until at least one .json file with one key is present.',
    },
  },

  create(context) {
    const options: RuleOptions = (context.options[0] as RuleOptions | undefined) ?? {};
    const localesDir = options.localesDir ?? 'locales';
    const defaultLocale = options.defaultLocale ?? 'en';

    const keyspace = loadKeyspace(localesDir, defaultLocale);
    const warningKey = `${path.resolve(localesDir, defaultLocale)}|empty`;

    if (keyspace.empty && !warnedAbout.has(warningKey)) {
      warnedAbout.add(warningKey);
      // Synthesize a Program-level report so the warning lands once per
      // project rather than per-file. ESLint surfaces this as a normal
      // diagnostic — no `console.warn` side channel.
      return {
        Program(node) {
          context.report({
            node,
            messageId: 'keyspaceEmpty',
            data: { path: path.resolve(localesDir, defaultLocale) },
          });
        },
      };
    }

    if (keyspace.empty) {
      return {}; // silent — already warned this run
    }

    function checkLiteralKey(callNode: CallExpression, arg: Literal & { value: string }): void {
      if (!keyspace.keys.has(arg.value)) {
        context.report({
          node: callNode,
          messageId: 'keyMissing',
          data: { key: arg.value, localesDir, defaultLocale },
        });
      }
    }

    function checkDynamicPrefix(callNode: CallExpression, arg: Literal & { value: string }): void {
      const prefix = arg.value;
      // A bare prefix without a separator is unusual but still flaggable:
      // require at least one matching key starts with `prefix`.
      let matched = false;
      for (const k of keyspace.keys) {
        if (k.startsWith(prefix)) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        context.report({
          node: callNode,
          messageId: 'dynamicPrefixMissing',
          data: { prefix, localesDir, defaultLocale },
        });
      }
    }

    return {
      CallExpression(node) {
        const callee = node.callee;

        // `t.dynamic('prefix')` — only when the receiver is exactly `t`.
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'dynamic' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 't'
        ) {
          const arg = node.arguments[0];
          if (isStringLiteral(arg)) checkDynamicPrefix(node, arg);
          return;
        }

        // `t('key')` — bare identifier only. Member-access (`obj.t(...)`)
        // is the no-member-access-t rule's domain.
        if (callee.type !== 'Identifier' || callee.name !== 't') return;

        const arg = node.arguments[0];
        if (!isStringLiteral(arg)) return;
        checkLiteralKey(node, arg);
      },
    };
  },
};

export default rule;

/**
 * Test-only: clear the per-locales-dir keyspace cache. Useful in
 * RuleTester suites that mutate locale fixtures between cases.
 */
export function __clearKeyspaceCacheForTests(): void {
  keyspaceCache.clear();
  warnedAbout.clear();
}
