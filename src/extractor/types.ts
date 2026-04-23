/**
 * Options for the key extraction process.
 */
export interface ExtractionOptions {
  /**
   * What to scan for.
   * - `'global'` — extract from both `useI18n()` and global `t()` imports (default)
   * - `'scoped'` — only extract from files using `useI18n()`
   */
  scope: 'global' | 'scoped';
  /** File path for the result metadata. Source is passed directly, not read from disk. */
  filePath: string;
  /** Additional property names to scan as translation key fields. Additive to defaults. */
  keyFields?: string[];
  /** Additional module specifiers that export `useI18n`. */
  hookSources?: string[];
}

/**
 * Result of extracting translation keys from a single source file.
 */
export interface ExtractionResult {
  /** The file that was analyzed. */
  filePath: string;
  /** Scope strings passed to useI18n() calls in this file. */
  scopes: string[];
  /** All translation keys found in this file. */
  keys: ExtractedKey[];
  /** Raw import specifiers (for import graph walking). */
  imports: string[];
}

/**
 * A single translation key extracted from source code.
 */
export interface ExtractedKey {
  /** The fully qualified key (e.g., 'products.show.title'). */
  key: string;
  /** The fallback text, if provided as a string literal. */
  fallback?: string;
  /** Whether this key contains dynamic parts (variables, expressions). */
  dynamic: boolean;
  /** Longest static prefix for dynamic keys. */
  staticPrefix?: string;
  /** Line number in the source file (1-based). */
  line: number;
  /** Column number in the source file (0-based). */
  column: number;
}
