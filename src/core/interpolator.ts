/**
 * Pattern matching `{{paramName}}` placeholders in translation strings.
 * Allows optional whitespace around the parameter name: `{{ name }}` works.
 */
const PLACEHOLDER_PATTERN = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * Replaces `{{paramName}}` placeholders in a translation string with
 * values from the provided params object.
 *
 * Rules:
 * - `{{param}}` and `{{ param }}` both resolve to the `param` key
 * - Missing params leave the placeholder as-is (aids debugging)
 * - Values are converted to strings via `String(value)`
 * - If no params are provided, the string is returned unchanged
 *
 * @param text - The translation string containing `{{placeholders}}`
 * @param params - Optional object mapping parameter names to values
 * @returns The interpolated string
 *
 * @example
 * ```ts
 * interpolate('Hello {{name}}', { name: 'Alice' });
 * // 'Hello Alice'
 *
 * interpolate('Price: {{amount}}', { amount: 29.99 });
 * // 'Price: 29.99'
 *
 * interpolate('Hello {{name}}', {});
 * // 'Hello {{name}}' — missing param left as-is
 * ```
 */
export function interpolate(
  text: string,
  params?: Record<string, unknown>,
): string {
  if (!params) return text;

  return text.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
    const value = params[key];
    return value !== undefined ? String(value) : match;
  });
}
