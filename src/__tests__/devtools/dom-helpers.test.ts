import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  formatBytes,
  renderChipList,
  renderEmpty,
  renderKvCard,
  renderKvGrid,
  renderProgressBar,
  renderRows,
  renderSection,
} from '../../devtools/dom-helpers';

describe('dom-helpers', () => {
  // -------------------------------------------------------------------
  // escapeHtml
  // -------------------------------------------------------------------

  it('escapes HTML entities', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
    expect(escapeHtml("it's & fun")).toBe('it&#39;s &amp; fun');
    expect(escapeHtml('plain text')).toBe('plain text');
  });

  // -------------------------------------------------------------------
  // formatBytes
  // -------------------------------------------------------------------

  it('formats byte sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });

  // -------------------------------------------------------------------
  // renderChipList
  // -------------------------------------------------------------------

  it('renders a chip list', () => {
    const html = renderChipList(['alpha', 'beta']);
    expect(html).toContain('vbi18n-chip-list');
    expect(html).toContain('vbi18n-chip');
    expect(html).toContain('alpha');
    expect(html).toContain('beta');
    expect(html).not.toContain('vbi18n-chip-muted');
  });

  it('renders muted chip list', () => {
    const html = renderChipList(['one'], true);
    expect(html).toContain('vbi18n-chip-muted');
  });

  it('renders empty state for empty chip list', () => {
    const html = renderChipList([]);
    expect(html).toContain('vbi18n-empty');
    expect(html).toContain('Nothing to show.');
  });

  // -------------------------------------------------------------------
  // renderSection
  // -------------------------------------------------------------------

  it('renders a collapsible section', () => {
    const html = renderSection('My Section', '3 items', '<p>body</p>', true);
    expect(html).toContain('<details');
    expect(html).toContain('vbi18n-section');
    expect(html).toContain(' open');
    expect(html).toContain('My Section');
    expect(html).toContain('3 items');
    expect(html).toContain('<p>body</p>');
  });

  it('renders a closed section when open is false', () => {
    const html = renderSection('Closed', '0', '', false);
    expect(html).not.toContain(' open');
  });

  // -------------------------------------------------------------------
  // renderProgressBar
  // -------------------------------------------------------------------

  it('renders a progress bar', () => {
    const html = renderProgressBar(75, '75% efficient');
    expect(html).toContain('vbi18n-progress');
    expect(html).toContain('vbi18n-progress-fill');
    expect(html).toContain('width:75%');
    expect(html).toContain('75% efficient');
  });

  it('clamps progress bar percentage to 0-100', () => {
    expect(renderProgressBar(-10, 'low')).toContain('width:0%');
    expect(renderProgressBar(200, 'high')).toContain('width:100%');
  });

  // -------------------------------------------------------------------
  // renderKvGrid
  // -------------------------------------------------------------------

  it('renders KV grid', () => {
    const html = renderKvGrid([
      { label: 'Locale', value: 'en' },
      { label: 'Keys', value: '42' },
    ]);
    expect(html).toContain('vbi18n-kv');
    expect(html).toContain('vbi18n-kv-card');
    expect(html).toContain('Locale');
    expect(html).toContain('en');
    expect(html).toContain('Keys');
    expect(html).toContain('42');
  });

  it('renders a single KV card', () => {
    const html = renderKvCard('Size', '1.2 KB');
    expect(html).toContain('vbi18n-kv-card');
    expect(html).toContain('Size');
    expect(html).toContain('1.2 KB');
  });

  // -------------------------------------------------------------------
  // renderRows
  // -------------------------------------------------------------------

  it('renders rows with colored markers', () => {
    const html = renderRows([
      { title: 'home.title', subtitle: 'Primary / common', markerColor: '#16a34a' },
      { title: 'nav.back', markerColor: '#ca8a04' },
    ]);
    expect(html).toContain('vbi18n-table');
    expect(html).toContain('vbi18n-row');
    expect(html).toContain('vbi18n-row-marker');
    expect(html).toContain('home.title');
    expect(html).toContain('Primary / common');
    expect(html).toContain('#16a34a');
    expect(html).toContain('nav.back');
    // second row has no subtitle
    expect(html).toContain('#ca8a04');
  });

  it('renders empty state for empty rows', () => {
    const html = renderRows([]);
    expect(html).toContain('vbi18n-empty');
  });

  it('uses default marker color when none provided', () => {
    const html = renderRows([{ title: 'key' }]);
    expect(html).toContain('#2563eb');
  });

  // -------------------------------------------------------------------
  // renderEmpty
  // -------------------------------------------------------------------

  it('renders default empty message', () => {
    const html = renderEmpty();
    expect(html).toContain('Nothing to show.');
    expect(html).toContain('vbi18n-empty');
  });

  it('renders custom empty message', () => {
    const html = renderEmpty('No data available.');
    expect(html).toContain('No data available.');
  });
});
