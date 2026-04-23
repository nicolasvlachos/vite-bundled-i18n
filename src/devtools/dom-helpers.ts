/**
 * Pure DOM rendering helpers for the i18n devtools panel.
 *
 * Every function in this module is side-effect-free: it accepts data and
 * returns an HTML string. The actual DOM injection lives in `styles.ts`.
 *
 * All CSS classes use the `vbi18n-` prefix.
 */

/* ------------------------------------------------------------------ */
/*  Utility helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Escape a string for safe insertion into HTML.
 *
 * @param value - The raw string to escape.
 * @returns The HTML-safe string with entities replaced.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

/**
 * Format a byte count into a human-readable string.
 *
 * @param value - Size in bytes.
 * @returns A formatted string such as `"1.2 KB"` or `"3.4 MB"`.
 */
export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ */
/*  Rendering helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Render a flex-wrap list of chip elements.
 *
 * When `values` is empty an {@link renderEmpty} placeholder is returned
 * instead.
 *
 * @param values - Strings to display as chips.
 * @param muted  - When `true` chips use the muted colour variant.
 * @returns An HTML string containing the chip list.
 */
export function renderChipList(values: string[], muted = false): string {
  if (values.length === 0) {
    return renderEmpty();
  }

  return `<div class="vbi18n-chip-list">${values
    .map(
      (value) =>
        `<span class="vbi18n-chip${muted ? ' vbi18n-chip-muted' : ''}">${escapeHtml(value)}</span>`,
    )
    .join('')}</div>`;
}

/**
 * Render an empty-state placeholder message.
 *
 * @param message - Optional custom message. Defaults to `"Nothing to show."`.
 * @returns An HTML string for the empty state.
 */
export function renderEmpty(message?: string): string {
  return `<div class="vbi18n-empty">${escapeHtml(message ?? 'Nothing to show.')}</div>`;
}

/**
 * Render a single stat card with a label and a value.
 *
 * @param label - The uppercase label text.
 * @param value - The display value.
 * @returns An HTML string for one KV card.
 */
export function renderKvCard(label: string, value: string): string {
  return `<div class="vbi18n-kv-card"><div class="vbi18n-kv-label">${escapeHtml(label)}</div><div class="vbi18n-kv-value">${escapeHtml(value)}</div></div>`;
}

/**
 * Render a two-column grid of {@link renderKvCard} elements.
 *
 * @param cards - Array of label/value pairs.
 * @returns An HTML string containing the grid.
 */
export function renderKvGrid(cards: Array<{ label: string; value: string }>): string {
  return `<div class="vbi18n-kv">${cards.map((card) => renderKvCard(card.label, card.value)).join('')}</div>`;
}

/**
 * Render a percentage progress bar with a label.
 *
 * @param percentage - A number between 0 and 100.
 * @param label      - Descriptive text rendered after the bar.
 * @returns An HTML string for the progress bar.
 */
export function renderProgressBar(percentage: number, label: string): string {
  const clamped = Math.max(0, Math.min(100, percentage));
  return `<div class="vbi18n-progress-wrapper"><div class="vbi18n-progress"><div class="vbi18n-progress-fill" style="width:${clamped}%"></div></div><div class="vbi18n-progress-label">${escapeHtml(label)}</div></div>`;
}

/**
 * Render a vertical list of rows with coloured markers.
 *
 * When `rows` is empty an {@link renderEmpty} placeholder is returned
 * instead.
 *
 * @param rows - Array of row descriptors.
 * @returns An HTML string containing the row list.
 */
export function renderRows(
  rows: Array<{ title: string; subtitle?: string; markerColor?: string }>,
): string {
  if (rows.length === 0) {
    return renderEmpty();
  }

  return `<div class="vbi18n-table">${rows
    .map(
      (row) =>
        `<div class="vbi18n-row"><span class="vbi18n-row-marker" style="background:${escapeHtml(row.markerColor ?? '#2563eb')}"></span><div class="vbi18n-row-body"><div class="vbi18n-row-title">${escapeHtml(row.title)}</div>${row.subtitle ? `<div class="vbi18n-row-subtitle">${escapeHtml(row.subtitle)}</div>` : ''}</div></div>`,
    )
    .join('')}</div>`;
}

/**
 * Render a collapsible `<details>` section.
 *
 * @param title      - Section heading text.
 * @param countLabel - Badge text shown to the right of the title.
 * @param body       - Pre-rendered HTML body of the section.
 * @param open       - Whether the section starts expanded. Defaults to `true`.
 * @returns An HTML string for the collapsible section.
 */
export function renderSection(
  title: string,
  countLabel: string,
  body: string,
  open = true,
): string {
  return `<details class="vbi18n-section"${open ? ' open' : ''}><summary><span>${escapeHtml(title)}</span><span class="vbi18n-count">${escapeHtml(countLabel)}</span></summary><div class="vbi18n-section-body">${body}</div></details>`;
}
