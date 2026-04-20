import ts from 'typescript';
import { collectImports } from './ast-utils';
import { findTranslationCalls, extractScopes } from './patterns';
import type { ExtractionOptions, ExtractionResult } from './types';

const DEFAULT_OPTIONS: ExtractionOptions = {
  scope: 'global',
  filePath: '',
};

/**
 * Extracts translation keys, scopes, and imports from a TypeScript/TSX source string.
 *
 * Parses the source with the TypeScript compiler, walks the AST to find
 * `t()` and `useI18n()` patterns, and returns structured extraction data.
 *
 * @param source - The TypeScript/TSX source code to analyze
 * @param options - Extraction options (scope mode, file path for metadata)
 * @returns The extraction result with keys, scopes, and imports
 */
export function extractKeys(
  source: string,
  options?: Partial<ExtractionOptions>,
): ExtractionResult {
  const opts: ExtractionOptions = { ...DEFAULT_OPTIONS, ...options };

  if (!source.trim()) {
    return { filePath: opts.filePath, scopes: [], keys: [], imports: [] };
  }

  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(
      opts.filePath || 'source.tsx',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
  } catch {
    console.warn('vite-bundled-i18n: Failed to parse ' + opts.filePath);
    return { filePath: opts.filePath, scopes: [], keys: [], imports: [] };
  }

  const keys = findTranslationCalls(sourceFile, opts);
  const scopes = extractScopes(sourceFile);
  const imports = collectImports(sourceFile);

  return {
    filePath: opts.filePath,
    scopes,
    keys,
    imports,
  };
}
