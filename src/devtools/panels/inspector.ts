/**
 * Inspector panel — raw namespace data browser for debugging.
 * Each namespace is a collapsible section with formatted JSON.
 */

import type { NestedTranslations } from '../../core/types';
import { renderSection, escapeHtml, renderEmpty } from '../dom-helpers';

/** Count leaf string values in nested translations. */
function countKeys(data: NestedTranslations): number {
  let count = 0;
  for (const v of Object.values(data)) {
    count += typeof v === 'string' ? 1 : countKeys(v);
  }
  return count;
}

/**
 * Render the Inspector panel.
 *
 * @param namespaces - Loaded namespace names
 * @param store - Namespace → translation data map
 * @returns HTML string
 */
export function renderInspectorPanel(
  namespaces: string[],
  store: Record<string, NestedTranslations>,
): string {
  if (namespaces.length === 0) {
    return renderSection('Store Inspector', '0', renderEmpty('No namespaces loaded.'), false);
  }

  const parts: string[] = [];
  for (const ns of namespaces) {
    const data = store[ns];
    const keyCount = data ? countKeys(data) : 0;
    const json = data !== undefined ? JSON.stringify(data, null, 2) : '{}';
    parts.push(
      renderSection(
        ns,
        `${keyCount} keys`,
        `<pre class="vbi18n-pre">${escapeHtml(json)}</pre>`,
        false,
      ),
    );
  }

  return renderSection('Store Inspector', `${namespaces.length} ns`, parts.join(''), false);
}
