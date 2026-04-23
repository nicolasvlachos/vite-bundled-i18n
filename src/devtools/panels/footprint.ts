/**
 * Footprint panel — shows the actual translation keys used on the current page,
 * their resolved values, resolution source, and highlights missing translations.
 */

import type { KeyUsageEntry, NestedTranslations } from '../../core/types';
import { escapeHtml, renderSection, renderEmpty } from '../dom-helpers';

const RESOLUTION_COLORS: Record<KeyUsageEntry['resolvedFrom'], string> = {
  primary: '#a6e3a1',
  'fallback-locale': '#f9e2af',
  'fallback-string': '#fab387',
  'key-as-value': '#f38ba8',
};

const RESOLUTION_LABELS: Record<KeyUsageEntry['resolvedFrom'], string> = {
  primary: 'Primary',
  'fallback-locale': 'Fallback',
  'fallback-string': 'Default',
  'key-as-value': 'Missing',
};

/** Count leaf string values in a nested translations object. */
function countLeafKeys(data: NestedTranslations): number {
  let count = 0;
  for (const v of Object.values(data)) {
    count += typeof v === 'string' ? 1 : countLeafKeys(v);
  }
  return count;
}

/** Resolve a dot-path key against nested translations to get the leaf value. */
function resolveValue(store: Record<string, NestedTranslations>, key: string): string | undefined {
  const dot = key.indexOf('.');
  if (dot === -1) return undefined;
  const ns = key.slice(0, dot);
  const rest = key.slice(dot + 1);
  const data = store[ns];
  if (!data) return undefined;

  const segments = rest.split('.');
  let current: NestedTranslations | string = data;
  for (const seg of segments) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = current[seg];
    if (current === undefined) return undefined;
  }
  return typeof current === 'string' ? current : undefined;
}

/**
 * Render the Footprint panel.
 *
 * @param locale - Active locale code
 * @param currentScope - Active scope, if any
 * @param keyUsage - Key usage entries from the runtime
 * @param store - Current translation store (namespace → data)
 * @returns HTML string
 */
export function renderFootprintPanel(
  locale: string,
  currentScope: string | undefined,
  keyUsage: KeyUsageEntry[],
  store: Record<string, NestedTranslations>,
): string {
  // Deduplicate by key
  const seen = new Set<string>();
  const unique: KeyUsageEntry[] = [];
  for (const entry of keyUsage) {
    if (!seen.has(entry.key)) {
      seen.add(entry.key);
      unique.push(entry);
    }
  }

  if (unique.length === 0) {
    return renderSection(
      `Translation Keys`,
      '0',
      renderEmpty('No key usage recorded yet. Navigate to a page that uses translations.'),
      true,
    );
  }

  // Count by status
  const counts = { primary: 0, 'fallback-locale': 0, 'fallback-string': 0, 'key-as-value': 0 };
  for (const e of unique) counts[e.resolvedFrom]++;

  // Stats bar
  const statsBar = `
    <div style="display:flex;gap:12px;padding:4px 0;font-size:11px;color:#a6adc8">
      <span style="color:#a6e3a1">${counts.primary} resolved</span>
      ${counts['fallback-locale'] ? `<span style="color:#f9e2af">${counts['fallback-locale']} fallback</span>` : ''}
      ${counts['fallback-string'] ? `<span style="color:#fab387">${counts['fallback-string']} default</span>` : ''}
      ${counts['key-as-value'] ? `<span style="color:#f38ba8;font-weight:700">${counts['key-as-value']} missing</span>` : ''}
    </div>
  `;

  // Group by namespace
  const groups = new Map<string, KeyUsageEntry[]>();
  for (const entry of unique) {
    let list = groups.get(entry.namespace);
    if (!list) { list = []; groups.set(entry.namespace, list); }
    list.push(entry);
  }

  // Render key rows with actual values
  const parts: string[] = [statsBar];

  // Missing keys first (prominent)
  const missing = unique.filter(e => e.resolvedFrom === 'key-as-value');
  if (missing.length > 0) {
    const missingRows = missing.map(e => `
      <div class="vbi18n-filterable" data-key="${escapeHtml(e.key)}" style="display:flex;align-items:baseline;gap:8px;padding:3px 0;font-size:11px">
        <span style="color:#f38ba8;flex-shrink:0">&#x2717;</span>
        <code style="color:#f38ba8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all">${escapeHtml(e.key)}</code>
      </div>
    `).join('');
    const searchInput = missing.length > 8 ? `
      <input type="text" placeholder="Search missing keys..." class="vbi18n-search" data-target="missing-list" style="width:100%;padding:5px 8px;margin-bottom:4px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;color:#cdd6f4;font-size:11px;outline:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace" />
    ` : '';
    parts.push(renderSection('Missing Translations', String(missing.length),
      `${searchInput}<div id="missing-list" style="max-height:240px;overflow-y:auto">${missingRows}</div>`,
      true));
  }

  // Per-namespace key tables with bundle efficiency
  for (const [ns, entries] of groups) {
    const nsData = store[ns];
    const totalInNamespace = nsData ? countLeafKeys(nsData) : 0;
    const usedOnPage = entries.length;
    const dropped = totalInNamespace - usedOnPage;
    const savedPct = totalInNamespace > 0 ? Math.round((dropped / totalInNamespace) * 100) : 0;

    // Bundle efficiency insight
    const efficiencyHtml = totalInNamespace > 0 ? `
      <div style="padding:4px 0 6px;font-size:11px;color:#6c7086;border-bottom:1px solid rgba(255,255,255,0.04);margin-bottom:4px">
        <span style="color:#cdd6f4">${usedOnPage}</span> of <span style="color:#cdd6f4">${totalInNamespace}</span> keys used on this page
        ${dropped > 0 ? ` &mdash; <span style="color:#a6e3a1">${dropped} keys treeshaken (${savedPct}% smaller bundle)</span>` : ''}
      </div>
    ` : '';

    const listId = `ns-${ns}`;
    const rows = entries.map(e => {
      const value = resolveValue(store, e.key);
      const color = RESOLUTION_COLORS[e.resolvedFrom];
      const label = RESOLUTION_LABELS[e.resolvedFrom];
      const valueDisplay = value
        ? `<span style="color:#a6adc8;font-size:11px">${escapeHtml(value.length > 60 ? value.slice(0, 57) + '...' : value)}</span>`
        : `<span style="color:#585b70;font-size:11px;font-style:italic">no value</span>`;

      return `
        <div class="vbi18n-filterable" data-key="${escapeHtml(e.key)}" style="border-bottom:1px solid rgba(255,255,255,0.03)">
          <div style="display:flex;align-items:baseline;gap:6px;padding:2px 0;font-size:11px">
            <span style="width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0;margin-top:4px"></span>
            <code style="color:#cdd6f4;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;min-width:0;word-break:break-all;flex:1">${escapeHtml(e.key)}</code>
            <span style="color:${color};font-size:10px;flex-shrink:0;text-transform:uppercase;letter-spacing:0.04em">${label}</span>
          </div>
          <div style="padding:0 0 3px 12px">${valueDisplay}</div>
        </div>
      `;
    }).join('');

    const searchInput = entries.length > 8 ? `
      <input type="text" placeholder="Search ${ns} keys..." class="vbi18n-search" data-target="${listId}" style="width:100%;padding:5px 8px;margin-bottom:4px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;color:#cdd6f4;font-size:11px;outline:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace" />
    ` : '';

    parts.push(renderSection(
      ns,
      `${usedOnPage} / ${totalInNamespace} keys`,
      `${efficiencyHtml}${searchInput}<div id="${listId}" style="max-height:300px;overflow-y:auto">${rows}</div>`,
      entries.some(e => e.resolvedFrom === 'key-as-value'),
    ));
  }

  return renderSection(
    `Translation Keys`,
    `${unique.length} used`,
    parts.join(''),
    true,
  );
}
