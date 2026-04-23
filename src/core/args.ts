/** Normalized result of resolving overloaded translation function arguments. */
export interface ResolvedArgs {
  key: string;
  params?: Record<string, unknown>;
  fallback?: string;
}

/**
 * Resolves the overloaded arguments of translation functions into a normalized form.
 *
 * The second argument can be either a fallback string or a params object.
 * Detection rules:
 * - `undefined` or `null` -> no params, no fallback
 * - `string` -> fallback
 * - plain object (`{}`) -> params
 * - anything else (arrays, numbers, booleans) -> ignored, treated as no params
 */
export function resolveArgs(
  args:
    | [string]
    | [string, string]
    | [string, Record<string, unknown>]
    | [string, Record<string, unknown>, string],
): ResolvedArgs {
  const [key, second, third] = args;

  if (second == null) {
    return { key, params: undefined, fallback: undefined };
  }

  if (typeof second === 'string') {
    return { key, params: undefined, fallback: second };
  }

  if (typeof second === 'object' && !Array.isArray(second)) {
    return { key, params: second, fallback: third };
  }

  return { key, params: undefined, fallback: undefined };
}
