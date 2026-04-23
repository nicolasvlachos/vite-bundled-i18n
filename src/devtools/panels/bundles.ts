/**
 * Bundles panel — shows loaded dictionaries, scopes, namespace residency
 * with key counts and byte sizes, and cache efficiency metrics.
 */

import type { CacheStats, NestedTranslations } from '../../core/types';
import {
  renderSection,
  renderEmpty,
  formatBytes,
  escapeHtml,
  renderProgressBar,
} from '../dom-helpers';

/** Detail record for a single namespace currently resident in the store. */
export interface NamespaceDetail {
  namespace: string;
  source: 'dictionary' | 'scope' | 'manual';
  pinned: boolean;
  approxBytes: number;
  keyCount: number;
}

/** Data required by the bundles panel renderer. */
export interface BundlesPanelData {
  loadedDictionaries: string[];
  loadedScopes: string[];
  loadedNamespaces: string[];
  cacheStats: CacheStats;
  residentKeyCount: number;
  namespaceDetails: NamespaceDetail[];
  store: Record<string, NestedTranslations>;
}

/** Count leaf strings in nested translations. */
function countKeys(data: NestedTranslations): number {
  let count = 0;
  for (const v of Object.values(data)) {
    count += typeof v === 'string' ? 1 : countKeys(v);
  }
  return count;
}

/**
 * Render the Bundles panel.
 *
 * @param data - Bundle panel data
 * @returns HTML string
 */
export function renderBundlesPanel(data: BundlesPanelData): string {
  const {
    loadedDictionaries,
    loadedScopes,
    loadedNamespaces,
    cacheStats,
    residentKeyCount,
    namespaceDetails,
    store,
  } = data;

  const parts: string[] = [];

  // --- Summary bar ---
  const totalBytes = cacheStats.approxTotalBytes;
  parts.push(`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:12px">
      <span style="color:#cdd6f4;font-weight:600">${residentKeyCount} keys</span>
      <span style="color:#6c7086">${loadedNamespaces.length} namespaces &middot; ${formatBytes(totalBytes)}</span>
    </div>
  `);

  // Efficiency bar
  const pct = cacheStats.totalNamespaces > 0
    ? Math.round((loadedNamespaces.length / cacheStats.totalNamespaces) * 100)
    : 0;
  parts.push(renderProgressBar(pct, `${loadedNamespaces.length} of ${cacheStats.totalNamespaces} namespaces loaded`));

  // --- Dictionaries ---
  if (loadedDictionaries.length > 0) {
    const dictRows = loadedDictionaries.map(name => {
      // Find namespaces that belong to this dictionary
      const dictNs = namespaceDetails.filter(d => d.source === 'dictionary');
      const totalKeys = dictNs.reduce((sum, d) => sum + d.keyCount, 0);
      const totalSize = dictNs.reduce((sum, d) => sum + d.approxBytes, 0);
      return `
        <div style="padding:6px 8px;border-radius:6px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);margin-bottom:4px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <code style="color:#89b4fa;font-weight:700;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(name)}</code>
            <span style="color:#6c7086;font-size:11px">${totalKeys} keys &middot; ${formatBytes(totalSize)}</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">
            ${dictNs.map(d => `<span style="font-size:10px;color:#7f849c;background:rgba(255,255,255,0.03);padding:1px 6px;border-radius:4px">${escapeHtml(d.namespace)}</span>`).join('')}
          </div>
        </div>
      `;
    }).join('');
    parts.push(renderSection('Dictionaries', String(loadedDictionaries.length), dictRows, true));
  }

  // --- Scopes ---
  if (loadedScopes.length > 0) {
    const scopeRows = loadedScopes.map(scope => {
      const ns = scope.indexOf('.') === -1 ? scope : scope.slice(0, scope.indexOf('.'));
      const nsData = store[ns];
      const keyCount = nsData ? countKeys(nsData) : 0;
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;font-size:11px;border-bottom:1px solid rgba(255,255,255,0.03)">
          <code style="color:#94e2d5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(scope)}</code>
          <span style="color:#6c7086">${keyCount} keys</span>
        </div>
      `;
    }).join('');
    parts.push(renderSection('Scopes', String(loadedScopes.length), scopeRows, true));
  }

  // --- Namespace residency table ---
  const nsRows = namespaceDetails.map(d => {
    const sourceColor = d.source === 'dictionary' ? '#89b4fa' : d.source === 'scope' ? '#94e2d5' : '#7f849c';
    const pinnedBadge = d.pinned ? '<span style="color:#f9e2af;font-size:9px;margin-left:4px">PINNED</span>' : '';
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;font-size:11px;border-bottom:1px solid rgba(255,255,255,0.03)">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="width:5px;height:5px;border-radius:50%;background:${sourceColor};flex-shrink:0"></span>
          <code style="color:#cdd6f4;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(d.namespace)}</code>
          ${pinnedBadge}
        </div>
        <span style="color:#6c7086">${d.keyCount} keys &middot; ${formatBytes(d.approxBytes)}</span>
      </div>
    `;
  }).join('');
  parts.push(renderSection(
    'Namespaces',
    `${namespaceDetails.length}`,
    nsRows || renderEmpty('No namespaces loaded.'),
    false,
  ));

  // --- Cache stats (compact) ---
  parts.push(`
    <div style="display:flex;gap:12px;padding:4px 0;font-size:10px;color:#585b70;text-transform:uppercase;letter-spacing:0.05em">
      <span>${cacheStats.totalLocales} locale${cacheStats.totalLocales !== 1 ? 's' : ''}</span>
      <span>${cacheStats.pinnedNamespaces} pinned</span>
      <span>${cacheStats.loadedDictionaries} dict${cacheStats.loadedDictionaries !== 1 ? 's' : ''}</span>
      <span>${cacheStats.loadedScopes} scope${cacheStats.loadedScopes !== 1 ? 's' : ''}</span>
    </div>
  `);

  return renderSection('Bundles & Cache', `${residentKeyCount} keys`, parts.join(''), true);
}
