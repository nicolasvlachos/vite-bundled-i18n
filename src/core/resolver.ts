import type { NestedTranslations } from './types';

/**
 * Extracts the namespace from a fully qualified key.
 *
 * The namespace is the first dot-separated segment. This determines
 * which JSON file to load (e.g., `'products'` loads `products.json`).
 *
 * @param key - Fully qualified key (e.g., `'products.show.title'`)
 * @returns The namespace name (e.g., `'products'`)
 *
 * @example
 * ```ts
 * inferNamespace('products.show.title'); // 'products'
 * inferNamespace('shared.ok');           // 'shared'
 * inferNamespace('checkout');            // 'checkout'
 * ```
 */
export function inferNamespace(key: string): string {
  const dotIndex = key.indexOf('.');
  return dotIndex === -1 ? key : key.slice(0, dotIndex);
}

/**
 * Extracts the subkey path from a fully qualified key (everything after the namespace).
 *
 * @param key - Fully qualified key (e.g., `'products.show.title'`)
 * @returns The subkey path (e.g., `'show.title'`), or empty string if no subkey
 *
 * @example
 * ```ts
 * extractSubkey('products.show.title'); // 'show.title'
 * extractSubkey('shared.ok');           // 'ok'
 * extractSubkey('checkout');            // ''
 * ```
 */
export function extractSubkey(key: string): string {
  const dotIndex = key.indexOf('.');
  return dotIndex === -1 ? '' : key.slice(dotIndex + 1);
}

/**
 * Resolves a dot-separated key path against a nested translations object.
 *
 * Traverses the object tree following each segment of the key path.
 * Returns the string value at the leaf, or `undefined` if the path
 * doesn't exist or resolves to a non-string (branch node).
 *
 * @param data - The nested translations object to search
 * @param keyPath - Dot-separated path (e.g., `'show.title'`)
 * @returns The translated string, or `undefined` if not found
 *
 * @example
 * ```ts
 * const data = { show: { title: 'Product Details' } };
 * resolveKey(data, 'show.title'); // 'Product Details'
 * resolveKey(data, 'show.missing'); // undefined
 * ```
 */
export function resolveKey(
  data: NestedTranslations,
  keyPath: string,
): string | undefined {
  if (!keyPath) return undefined;

  const segments = keyPath.split('.');
  let current: NestedTranslations | string = data;

  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = current[segment];
    if (current === undefined) {
      return undefined;
    }
  }

  return typeof current === 'string' ? current : undefined;
}
