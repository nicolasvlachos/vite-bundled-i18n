import ts from 'typescript';

/**
 * Extracts a string value from a node if it's a string literal or
 * a no-substitution template literal. Returns undefined for anything else.
 */
export function getStringValue(node: ts.Expression): string | undefined {
  if (ts.isStringLiteral(node)) {
    return node.text;
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

/**
 * Extracts the longest static prefix from an expression.
 *
 * For string literals, returns the full string.
 * For template literals, returns the head text (before the first expression), trimmed of trailing dots.
 * For binary `+` expressions, recursively extracts from the left side.
 * For anything else, returns undefined.
 */
export function getStaticPrefix(node: ts.Expression): string | undefined {
  if (ts.isStringLiteral(node)) {
    const text = node.text;
    return text.endsWith('.') ? text.slice(0, -1) : text || undefined;
  }

  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    const text = node.text;
    return text.endsWith('.') ? text.slice(0, -1) : text || undefined;
  }

  if (ts.isTemplateExpression(node)) {
    const head = node.head.text;
    return head.endsWith('.') ? head.slice(0, -1) : head || undefined;
  }

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return getStaticPrefix(node.left);
  }

  return undefined;
}

/**
 * Collects all non-type-only import and export-from specifiers from a source file.
 */
export function collectImports(sourceFile: ts.SourceFile): string[] {
  const imports: string[] = [];

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isImportDeclaration(node)) {
      if (node.importClause?.isTypeOnly) return;
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push(node.moduleSpecifier.text);
      }
    }

    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (node.isTypeOnly) return;
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push(node.moduleSpecifier.text);
      }
    }
  });

  return imports;
}
