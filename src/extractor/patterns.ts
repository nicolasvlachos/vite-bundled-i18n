import ts from 'typescript';
import { getStringValue, getStaticPrefix } from './ast-utils';
import type { ExtractionOptions, ExtractedKey } from './types';

const DEFAULT_KEY_FIELDS = ['labelKey', 'titleKey', 'translationKey'];

/** Function names recognized as translation calls even when not traced to useI18n(). */
const TRANSLATION_CALLEE_NAMES = new Set(['t', 'get']);

function getKeyFields(options: ExtractionOptions): Set<string> {
  if (!options.keyFields || options.keyFields.length === 0) {
    return new Set(DEFAULT_KEY_FIELDS);
  }
  return new Set([...DEFAULT_KEY_FIELDS, ...options.keyFields]);
}
const PACKAGE_NAMES = new Set([
  'vite-bundled-i18n',
  'vite-bundled-i18n/react',
  'vite-i18n-manager',
  'vite-i18n-manager/react',
]);

/**
 * Package specifiers recognized as ours.
 */
function isOurPackage(specifier: string): boolean {
  return (
    PACKAGE_NAMES.has(specifier) ||
    specifier.includes('/core/t') ||
    specifier.includes('/react/useI18n')
  );
}

/**
 * Checks if a module specifier is one that exports `useI18n`.
 */
function isUseI18nPackage(specifier: string): boolean {
  return (
    specifier === 'vite-bundled-i18n/react' ||
    specifier === 'vite-i18n-manager/react' ||
    specifier.includes('/react/useI18n')
  );
}

/**
 * Checks if a module specifier is one that exports the global `t`.
 */
function isGlobalTPackage(specifier: string): boolean {
  return (
    specifier === 'vite-bundled-i18n' ||
    specifier === 'vite-i18n-manager' ||
    specifier.includes('/core/t')
  );
}

/**
 * Extract the fallback string from a t() call's arguments.
 * - t(key, fallback) where fallback is a string literal
 * - t(key, params, fallback) where params is an object literal and fallback is a string literal
 */
function extractFallback(args: ts.NodeArray<ts.Expression>): string | undefined {
  if (args.length >= 2) {
    const second = args[1];
    // t(key, fallbackString)
    const secondStr = getStringValue(second);
    if (secondStr !== undefined) {
      return secondStr;
    }
    // t(key, paramsObject, fallbackString)
    if (args.length >= 3 && ts.isObjectLiteralExpression(second)) {
      const third = args[2];
      const thirdStr = getStringValue(third);
      if (thirdStr !== undefined) {
        return thirdStr;
      }
    }
  }
  return undefined;
}

/**
 * Finds all t() translation calls in a source file.
 */
export function findTranslationCalls(
  sourceFile: ts.SourceFile,
  options: ExtractionOptions,
): ExtractedKey[] {
  const results: ExtractedKey[] = [];
  const seenStaticFieldKeys = new Set<string>();

  // Track which local identifiers map to our global `t`
  // key = local name, value = 'global' | 'useI18n'
  const trackedNames = new Map<string, 'global' | 'useI18n'>();

  // Set of local names bound to our `useI18n` import
  const useI18nNames = new Set<string>();
  const i18nKeyNames = new Set<string>();
  const literalConstants = new Map<string, string>();
  /** Tracks `as const` objects and string enums: varName → (propName → stringValue) */
  const constObjectMaps = new Map<string, Map<string, string>>();

  // Pass 1: Walk imports
  ts.forEachChild(sourceFile, (node) => {
    if (!ts.isImportDeclaration(node)) return;
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    const specifier = node.moduleSpecifier.text;
    if (!isOurPackage(specifier)) return;

    const clause = node.importClause;
    if (!clause) return;
    const bindings = clause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return;

    for (const element of bindings.elements) {
      const importedName = (element.propertyName ?? element.name).text;
      const localName = element.name.text;

      if (importedName === 't' && isGlobalTPackage(specifier)) {
        if (options.scope !== 'scoped') {
          trackedNames.set(localName, 'global');
        }
      }

      if (importedName === 'useI18n' && isUseI18nPackage(specifier)) {
        useI18nNames.add(localName);
      }

      if (importedName === 'i18nKey' && isOurPackage(specifier)) {
        i18nKeyNames.add(localName);
      }
    }
  });

  // Pass 1b: Collect `as const` objects and string enums
  ts.forEachChild(sourceFile, (node) => {
    // as const objects: const X = { ... } as const
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        if (!ts.isAsExpression(decl.initializer)) continue;
        const init = decl.initializer.expression;
        if (!ts.isObjectLiteralExpression(init)) continue;

        const entries = new Map<string, string>();
        for (const prop of init.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const propName = ts.isIdentifier(prop.name)
            ? prop.name.text
            : ts.isStringLiteral(prop.name)
              ? prop.name.text
              : undefined;
          if (!propName) continue;
          const value = getStringValue(prop.initializer);
          if (value !== undefined) {
            entries.set(propName, value);
          }
        }
        if (entries.size > 0) {
          constObjectMaps.set(decl.name.text, entries);
        }
      }
    }

    // String enums
    if (ts.isEnumDeclaration(node) && ts.isIdentifier(node.name)) {
      const entries = new Map<string, string>();
      for (const member of node.members) {
        const memberName = ts.isIdentifier(member.name)
          ? member.name.text
          : ts.isStringLiteral(member.name)
            ? member.name.text
            : undefined;
        if (!memberName || !member.initializer) continue;
        const value = getStringValue(member.initializer);
        if (value !== undefined) {
          entries.set(memberName, value);
        }
      }
      if (entries.size > 0) {
        constObjectMaps.set(node.name.text, entries);
      }
    }
  });

  // Pass 2: Walk entire AST to find useI18n destructuring and t() calls
  const keyFields = getKeyFields(options);
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      getStringValue(node.initializer) !== undefined
    ) {
      literalConstants.set(node.name.text, getStringValue(node.initializer)!);
    }

    // Look for: const { t } = useI18n(...)  or  const { t: alias } = useI18n(...)
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      useI18nNames.has(node.initializer.expression.text) &&
      node.name &&
      ts.isObjectBindingPattern(node.name)
    ) {
      for (const element of node.name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const propName = element.propertyName
          ? ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : undefined
          : element.name.text;

        if (propName === 't') {
          const localName = element.name.text;
          trackedNames.set(localName, 'useI18n');
        }
      }
    }

    // Look for calls to tracked identifiers
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      trackedNames.has(node.expression.text)
    ) {
      const args = node.arguments;
      if (args.length === 0) {
        ts.forEachChild(node, visit);
        return;
      }

      const keyArg = args[0];
      let staticKey = getStringValue(keyArg)
        ?? (ts.isIdentifier(keyArg) ? literalConstants.get(keyArg.text) : undefined);

      // Const object / enum property access: KEYS.active
      if (staticKey === undefined && ts.isPropertyAccessExpression(keyArg) && ts.isIdentifier(keyArg.expression)) {
        const objMap = constObjectMaps.get(keyArg.expression.text);
        if (objMap) {
          const value = objMap.get(keyArg.name.text);
          if (value !== undefined) {
            staticKey = value;
          }
        }
      }

      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

      // Const object / enum element access with dynamic index: KEYS[status]
      if (staticKey === undefined && ts.isElementAccessExpression(keyArg) && ts.isIdentifier(keyArg.expression)) {
        const objMap = constObjectMaps.get(keyArg.expression.text);
        if (objMap) {
          for (const value of objMap.values()) {
            results.push({
              key: value,
              dynamic: false,
              line: line + 1,
              column: character,
            });
          }
          ts.forEachChild(node, visit);
          return;
        }
      }

      if (staticKey !== undefined) {
        // Static key
        results.push({
          key: staticKey,
          fallback: extractFallback(args),
          dynamic: false,
          line: line + 1,
          column: character,
        });
      } else {
        // Dynamic key
        const prefix = getStaticPrefix(keyArg);
        results.push({
          key: prefix ? `${prefix}.*` : '*',
          dynamic: true,
          staticPrefix: prefix || undefined,
          line: line + 1,
          column: character,
        });
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      i18nKeyNames.has(node.expression.text) &&
      node.arguments.length > 0
    ) {
      const keyArg = node.arguments[0];
      let staticKey = getStringValue(keyArg)
        ?? (ts.isIdentifier(keyArg) ? literalConstants.get(keyArg.text) : undefined);

      // Const object / enum property access: KEYS.active
      if (staticKey === undefined && ts.isPropertyAccessExpression(keyArg) && ts.isIdentifier(keyArg.expression)) {
        const objMap = constObjectMaps.get(keyArg.expression.text);
        if (objMap) {
          const value = objMap.get(keyArg.name.text);
          if (value !== undefined) {
            staticKey = value;
          }
        }
      }

      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

      // Const object / enum element access with dynamic index: KEYS[status]
      if (staticKey === undefined && ts.isElementAccessExpression(keyArg) && ts.isIdentifier(keyArg.expression)) {
        const objMap = constObjectMaps.get(keyArg.expression.text);
        if (objMap) {
          for (const value of objMap.values()) {
            results.push({
              key: value,
              dynamic: false,
              line: line + 1,
              column: character,
            });
          }
          ts.forEachChild(node, visit);
          return;
        }
      }

      if (staticKey !== undefined) {
        results.push({
          key: staticKey,
          dynamic: false,
          line: line + 1,
          column: character,
        });
      } else {
        const prefix = getStaticPrefix(keyArg);
        results.push({
          key: prefix ? `${prefix}.*` : '*',
          dynamic: true,
          staticPrefix: prefix || undefined,
          line: line + 1,
          column: character,
        });
      }
    }

    // Catch t() / get() calls from untracked sources (e.g., t passed as argument to helpers).
    // Only fires in global extraction mode — scoped mode only tracks traced identifiers.
    if (
      options.scope !== 'scoped' &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      !trackedNames.has(node.expression.text) &&
      !i18nKeyNames.has(node.expression.text) &&
      TRANSLATION_CALLEE_NAMES.has(node.expression.text) &&
      node.arguments.length > 0
    ) {
      const keyArg = node.arguments[0];
      const staticKey = getStringValue(keyArg)
        ?? (ts.isIdentifier(keyArg) ? literalConstants.get(keyArg.text) : undefined);
      // Only extract if it looks like a dotted translation key (has at least one dot)
      if (staticKey !== undefined && staticKey.includes('.')) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        results.push({
          key: staticKey,
          dynamic: false,
          line: line + 1,
          column: character,
        });
      }
    }

    if (
      ts.isPropertyAssignment(node) &&
      ((ts.isIdentifier(node.name) && keyFields.has(node.name.text))
        || (ts.isStringLiteral(node.name) && keyFields.has(node.name.text)))
    ) {
      const staticKey = getStringValue(node.initializer)
        ?? (ts.isIdentifier(node.initializer) ? literalConstants.get(node.initializer.text) : undefined);
      if (staticKey !== undefined && !seenStaticFieldKeys.has(staticKey)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        seenStaticFieldKeys.add(staticKey);
        results.push({
          key: staticKey,
          dynamic: false,
          line: line + 1,
          column: character,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

/**
 * Extracts scope strings from all useI18n() calls in a source file.
 */
export function extractScopes(sourceFile: ts.SourceFile): string[] {
  const scopes: string[] = [];

  // First check that useI18n is actually imported from our package
  const useI18nNames = new Set<string>();

  ts.forEachChild(sourceFile, (node) => {
    if (!ts.isImportDeclaration(node)) return;
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    const specifier = node.moduleSpecifier.text;
    if (!isUseI18nPackage(specifier)) return;

    const clause = node.importClause;
    if (!clause) return;
    const bindings = clause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return;

    for (const element of bindings.elements) {
      const importedName = (element.propertyName ?? element.name).text;
      const localName = element.name.text;
      if (importedName === 'useI18n') {
        useI18nNames.add(localName);
      }
    }
  });

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      useI18nNames.has(node.expression.text) &&
      node.arguments.length > 0
    ) {
      const scopeArg = node.arguments[0];
      const scopeStr = getStringValue(scopeArg);
      if (scopeStr !== undefined) {
        scopes.push(scopeStr);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return scopes;
}
