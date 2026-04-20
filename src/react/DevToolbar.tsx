import { useContext, useState } from 'react';
import { I18nContext } from './context';
import type { KeyUsageEntry } from '../core/types';

const RESOLUTION_COLORS: Record<KeyUsageEntry['resolvedFrom'], string> = {
  primary: '#4ade80',
  'fallback-locale': '#facc15',
  'fallback-string': '#fb923c',
  'key-as-value': '#f87171',
};

const RESOLUTION_LABELS: Record<KeyUsageEntry['resolvedFrom'], string> = {
  primary: 'Primary',
  'fallback-locale': 'Fallback Locale',
  'fallback-string': 'Fallback String',
  'key-as-value': 'Key as Value',
};

/**
 * Dev-only toolbar overlay that displays translation diagnostics
 * for the current page. Reads key usage data from the i18n instance
 * via {@link I18nContext}.
 *
 * Renders nothing in production or when used outside an `I18nProvider`.
 *
 * @example
 * ```tsx
 * import { DevToolbar } from 'vite-bundled-i18n/react';
 *
 * function App() {
 *   return (
 *     <I18nProvider instance={i18n}>
 *       <Router />
 *       <DevToolbar />
 *     </I18nProvider>
 *   );
 * }
 * ```
 */
export function DevToolbar() {
  // Skip in production — always render in test (import.meta.env may not exist)
  const isDev =
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.DEV
      : true;

  const ctx = useContext(I18nContext);

  const [open, setOpen] = useState(false);

  if (!isDev) return null;
  if (!ctx) return null;

  const { instance } = ctx;
  const usage = instance.getKeyUsage();
  const locale = instance.getLocale();

  // Deduplicate keys for display — keep the first occurrence
  const uniqueKeys = new Map<string, KeyUsageEntry>();
  for (const entry of usage) {
    if (!uniqueKeys.has(entry.key)) {
      uniqueKeys.set(entry.key, entry);
    }
  }

  const groups: Array<{ type: KeyUsageEntry['resolvedFrom']; entries: KeyUsageEntry[] }> = [
    { type: 'primary', entries: [] },
    { type: 'fallback-locale', entries: [] },
    { type: 'fallback-string', entries: [] },
    { type: 'key-as-value', entries: [] },
  ];

  for (const entry of uniqueKeys.values()) {
    const group = groups.find((g) => g.type === entry.resolvedFrom);
    if (group) group.entries.push(entry);
  }

  const primaryCount = groups[0].entries.length;
  const fallbackCount =
    groups[1].entries.length + groups[2].entries.length;
  const missingCount = groups[3].entries.length;
  const totalKeys = uniqueKeys.size;

  return (
    <>
      {/* Toggle button */}
      <button
        data-testid="i18n-toolbar-toggle"
        onClick={() => setOpen((v) => !v)}
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          zIndex: 99999,
          width: 44,
          height: 44,
          borderRadius: 22,
          border: 'none',
          background: missingCount > 0 ? '#dc2626' : '#2563eb',
          color: '#fff',
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          fontFamily: 'system-ui, sans-serif',
        }}
        aria-label={open ? 'Close i18n toolbar' : 'Open i18n toolbar'}
      >
        {totalKeys}
      </button>

      {/* Panel */}
      {open && (
        <div
          data-testid="i18n-toolbar-panel"
          style={{
            position: 'fixed',
            bottom: 68,
            right: 16,
            zIndex: 99999,
            width: 380,
            maxHeight: 480,
            background: 'rgba(0, 0, 0, 0.92)',
            color: '#f1f5f9',
            borderRadius: 10,
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 13,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 14 }}>i18n DevToolbar</span>
            <span
              style={{
                background: '#2563eb',
                color: '#fff',
                padding: '2px 10px',
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {locale}
            </span>
          </div>

          {/* Summary */}
          <div
            style={{
              padding: '10px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              gap: 16,
              flexWrap: 'wrap',
              fontSize: 12,
            }}
          >
            <span>
              Total: <strong>{totalKeys}</strong>
            </span>
            <span style={{ color: RESOLUTION_COLORS.primary }}>
              Primary: <strong>{primaryCount}</strong>
            </span>
            <span style={{ color: RESOLUTION_COLORS['fallback-locale'] }}>
              Fallback: <strong>{fallbackCount}</strong>
            </span>
            <span style={{ color: RESOLUTION_COLORS['key-as-value'] }}>
              Missing: <strong>{missingCount}</strong>
            </span>
          </div>

          {/* Key list */}
          <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
            {groups.map(
              (group) =>
                group.entries.length > 0 && (
                  <div key={group.type} style={{ marginBottom: 8 }}>
                    <div
                      style={{
                        padding: '4px 16px',
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: RESOLUTION_COLORS[group.type],
                      }}
                    >
                      {RESOLUTION_LABELS[group.type]} ({group.entries.length})
                    </div>
                    {group.entries.map((entry) => (
                      <div
                        key={`${entry.key}-${entry.namespace}-${entry.scope ?? ''}`}
                        style={{
                          padding: '4px 16px 4px 24px',
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            background: RESOLUTION_COLORS[entry.resolvedFrom],
                            flexShrink: 0,
                            alignSelf: 'center',
                          }}
                        />
                        <span
                          style={{
                            fontFamily: 'ui-monospace, monospace',
                            fontSize: 12,
                            wordBreak: 'break-all',
                          }}
                        >
                          {entry.key}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: '#94a3b8',
                            marginLeft: 'auto',
                            flexShrink: 0,
                          }}
                        >
                          {entry.namespace}
                          {entry.scope ? ` / ${entry.scope}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                ),
            )}
            {totalKeys === 0 && (
              <div style={{ padding: '16px', textAlign: 'center', color: '#64748b' }}>
                No keys used yet
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
