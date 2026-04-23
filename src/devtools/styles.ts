/**
 * Devtools CSS injection.
 *
 * This is the **only** module in the devtools package that touches the DOM.
 * It injects a single `<style>` element into `document.head` when
 * {@link ensureStyle} is called and is idempotent — subsequent calls are
 * no-ops.
 *
 * All class names use the `vbi18n-` prefix. Pure CSS — no Tailwind or
 * external framework dependency.
 *
 * Theme: dark mode with compact layout optimized for developer tooling.
 */

const STYLE_ID = 'vite-bundled-i18n-devtools-style';

/**
 * Inject the devtools stylesheet into the document head.
 *
 * The style element is identified by `id="vite-bundled-i18n-devtools-style"`.
 * Calling this function multiple times is safe — the `<style>` element is
 * created only once.
 */
export function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* ===== Dialog / drawer shell ===== */

    dialog.vbi18n-dialog {
      margin: 0 0 0 auto;
      width: min(560px, 94vw);
      max-width: 560px;
      height: 100dvh;
      max-height: 100dvh;
      border: 0;
      padding: 0;
      background: transparent;
      overflow: visible;
    }

    dialog.vbi18n-dialog::backdrop {
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(3px);
    }

    /* ===== Toggle button ===== */

    .vbi18n-toggle {
      position: fixed;
      right: 14px;
      bottom: 14px;
      z-index: 99999;
      border: 0;
      border-radius: 10px;
      background: #1e1e2e;
      color: #cdd6f4;
      min-width: 44px;
      height: 44px;
      padding: 0 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font: 700 12px/1 system-ui, -apple-system, sans-serif;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.06);
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .vbi18n-toggle:hover {
      background: #2a2a3c;
    }

    .vbi18n-toggle-badge {
      min-width: 18px;
      height: 18px;
      border-radius: 6px;
      padding: 0 5px;
      background: rgba(137, 180, 250, 0.15);
      color: #89b4fa;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
    }

    /* ===== Drawer container ===== */

    .vbi18n-drawer {
      height: 100%;
      background: #1e1e2e;
      color: #cdd6f4;
      border-left: 1px solid rgba(255, 255, 255, 0.06);
      box-shadow: -8px 0 32px rgba(0, 0, 0, 0.4);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font: 12px/1.5 system-ui, -apple-system, sans-serif;
    }

    /* Body MUST be able to scroll — flex:1 + min-height:0 breaks the
       overflow:hidden on the parent so the flex child can shrink and scroll. */

    /* ===== Header ===== */

    .vbi18n-header {
      padding: 10px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      background: #181825;
      position: sticky;
      top: 0;
      z-index: 1;
      flex-shrink: 0;
    }

    .vbi18n-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .vbi18n-title {
      font-size: 14px;
      font-weight: 700;
      color: #cdd6f4;
      letter-spacing: 0.02em;
    }

    .vbi18n-actions {
      display: flex;
      gap: 6px;
    }

    .vbi18n-action {
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.04);
      color: #bac2de;
      border-radius: 6px;
      padding: 5px 10px;
      font: 600 11px/1 system-ui, -apple-system, sans-serif;
      cursor: pointer;
      transition: background 0.12s ease, border-color 0.12s ease;
    }

    .vbi18n-action:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.12);
    }

    /* ===== Meta cards (header area) ===== */

    .vbi18n-meta {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }

    .vbi18n-meta-card {
      border-radius: 8px;
      padding: 6px 10px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.04);
    }

    .vbi18n-meta-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6c7086;
      margin-bottom: 2px;
    }

    .vbi18n-meta-value {
      font-weight: 600;
      font-size: 12px;
      color: #cdd6f4;
      word-break: break-word;
    }

    /* ===== Body ===== */

    .vbi18n-body {
      flex: 1 1 0;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 12px 14px 32px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .vbi18n-body::-webkit-scrollbar {
      width: 6px;
    }

    .vbi18n-body::-webkit-scrollbar-track {
      background: transparent;
    }

    .vbi18n-body::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
    }

    .vbi18n-body::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.16);
    }

    /* ===== Collapsible section ===== */

    .vbi18n-section {
      border: 1px solid rgba(255, 255, 255, 0.05);
      background: rgba(255, 255, 255, 0.02);
      border-radius: 10px;
    }

    .vbi18n-section > summary {
      list-style: none;
      cursor: pointer;
      padding: 8px 12px;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      color: #bac2de;
      transition: background 0.1s ease;
    }

    .vbi18n-section > summary:hover {
      background: rgba(255, 255, 255, 0.03);
    }

    .vbi18n-section > summary::-webkit-details-marker {
      display: none;
    }

    .vbi18n-section-body {
      padding: 4px 12px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    /* Nested sections inside a section body don't need extra padding */
    .vbi18n-section-body > .vbi18n-section {
      margin: 0;
    }

    .vbi18n-count {
      color: #6c7086;
      font-weight: 600;
      font-size: 11px;
    }

    /* ===== Chip list ===== */

    .vbi18n-chip-list {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .vbi18n-chip {
      border-radius: 6px;
      background: rgba(137, 180, 250, 0.1);
      color: #89b4fa;
      padding: 3px 8px;
      font: 600 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
      word-break: break-word;
      border: 1px solid rgba(137, 180, 250, 0.08);
    }

    .vbi18n-chip-muted {
      background: rgba(255, 255, 255, 0.03);
      color: #7f849c;
      border-color: rgba(255, 255, 255, 0.04);
    }

    /* ===== KV grid ===== */

    .vbi18n-kv {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }

    .vbi18n-kv-card {
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.04);
    }

    .vbi18n-kv-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6c7086;
      margin-bottom: 2px;
    }

    .vbi18n-kv-value {
      font-weight: 700;
      font-size: 13px;
      color: #cdd6f4;
    }

    /* ===== Row list ===== */

    .vbi18n-table {
      display: grid;
      gap: 4px;
    }

    .vbi18n-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.03);
    }

    .vbi18n-row:hover {
      background: rgba(255, 255, 255, 0.04);
    }

    .vbi18n-row-marker {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      margin-top: 5px;
      flex-shrink: 0;
      background: #89b4fa;
    }

    .vbi18n-row-body {
      min-width: 0;
      flex: 1;
    }

    .vbi18n-row-title {
      font: 600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #cdd6f4;
      word-break: break-word;
    }

    .vbi18n-row-subtitle {
      color: #6c7086;
      font-size: 11px;
      margin-top: 1px;
      word-break: break-word;
    }

    /* ===== Pre / code ===== */

    .vbi18n-pre {
      margin: 0;
      padding: 8px 10px;
      border-radius: 6px;
      background: #11111b;
      color: #a6adc8;
      overflow: auto;
      font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
      border: 1px solid rgba(255, 255, 255, 0.03);
      max-height: 50vh;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .vbi18n-pre::-webkit-scrollbar {
      width: 4px;
    }

    .vbi18n-pre::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.08);
      border-radius: 2px;
    }

    /* ===== Empty / warning ===== */

    .vbi18n-empty {
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.02);
      color: #585b70;
      border: 1px dashed rgba(255, 255, 255, 0.06);
      font-size: 11px;
    }

    .vbi18n-warning {
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(243, 139, 168, 0.08);
      color: #f38ba8;
      border: 1px solid rgba(243, 139, 168, 0.15);
      font-size: 11px;
    }

    .vbi18n-loading {
      padding: 20px;
      color: #6c7086;
      text-align: center;
      font-size: 12px;
    }

    /* ===== Progress bar ===== */

    .vbi18n-progress-wrapper {
      display: grid;
      gap: 3px;
    }

    .vbi18n-progress {
      height: 6px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.04);
      overflow: hidden;
    }

    .vbi18n-progress-fill {
      height: 100%;
      border-radius: 999px;
      background: linear-gradient(90deg, #a6e3a1, #94e2d5);
      transition: width 0.3s ease;
    }

    .vbi18n-progress-label {
      font-size: 11px;
      color: #6c7086;
    }

    /* ===== Generic list ===== */

    .vbi18n-list {
      display: grid;
      gap: 4px;
    }
  `;
  document.head.append(style);
}
