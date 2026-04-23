/**
 * Framework-neutral i18n devtools drawer.
 *
 * Mounts a floating toggle button and a `<dialog>`-based side drawer that
 * displays translation diagnostics read entirely from the runtime i18n
 * instance — no server-side fetching, no `analysis.json`.
 *
 * Panel rendering is delegated to the `./panels/` modules; DOM helpers and
 * styles come from `./dom-helpers` and `./styles` respectively.
 */

import type {
  CacheStats,
  I18nInstance,
  KeyUsageEntry,
  NestedTranslations,
} from '../core/types';
import { isDevRuntime } from '../core/runtime-env';
import { ensureStyle } from './styles';
import { escapeHtml } from './dom-helpers';
import { renderFootprintPanel } from './panels/footprint';
import { renderBundlesPanel, type NamespaceDetail } from './panels/bundles';
import { renderInspectorPanel } from './panels/inspector';

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

/**
 * Options accepted by {@link mountI18nDevtools}.
 */
export interface I18nDevtoolsOptions {
  /** Override the mount target element. Default: `document.body`. */
  mountTarget?: HTMLElement;
  /** Provide the current URL path for context display. */
  getCurrentPath?: () => string;
  /** Provide the current translation scope. */
  getCurrentScope?: () => string | undefined;
}

/**
 * Handle returned by {@link mountI18nDevtools} to control the drawer lifecycle.
 */
export interface I18nDevtoolsHandle {
  /** Tear down the devtools drawer, removing all DOM elements and listeners. */
  destroy: () => void;
  /** Refresh the drawer content (if open) or the toggle badge (if closed). */
  refresh: () => void;
}

/* ------------------------------------------------------------------ */
/*  Internal types                                                     */
/* ------------------------------------------------------------------ */

interface InternalHandle extends I18nDevtoolsHandle {
  button: HTMLButtonElement;
  dialog: HTMLDialogElement;
}

interface RuntimeSnapshot {
  locale: string;
  currentPath: string;
  currentScope?: string;
  loadedScopes: string[];
  loadedDictionaries: string[];
  loadedNamespaces: string[];
  cacheStats: CacheStats;
  store: Record<string, NestedTranslations>;
  keyUsage: KeyUsageEntry[];
  uniqueKeyCount: number;
  residentKeyCount: number;
  namespaceDetails: NamespaceDetail[];
}

/* ------------------------------------------------------------------ */
/*  Singleton guard                                                    */
/* ------------------------------------------------------------------ */

const mountedDevtools = new WeakMap<I18nInstance, InternalHandle>();

/* ------------------------------------------------------------------ */
/*  Environment guards                                                 */
/* ------------------------------------------------------------------ */

function isDevBarEnabled(): boolean {
  if (typeof __VITE_I18N_DEVBAR__ !== 'undefined') {
    return __VITE_I18N_DEVBAR__;
  }
  return isDevRuntime();
}

function isDevMode(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  return isDevBarEnabled();
}

/* ------------------------------------------------------------------ */
/*  Snapshot helpers                                                    */
/* ------------------------------------------------------------------ */

/** Count leaf string values in a nested translations object. */
function countLeafKeys(data: NestedTranslations): number {
  let count = 0;
  for (const v of Object.values(data)) {
    count += typeof v === 'string' ? 1 : countLeafKeys(v);
  }
  return count;
}

function resolveCurrentPath(options: I18nDevtoolsOptions): string {
  try {
    if (options.getCurrentPath) {
      return options.getCurrentPath();
    }
  } catch {
    return '';
  }
  return typeof window !== 'undefined' ? window.location.pathname : '';
}

function resolveCurrentScope(
  instance: I18nInstance,
  options: I18nDevtoolsOptions,
): string | undefined {
  try {
    const scope = options.getCurrentScope?.();
    if (scope) return scope;
  } catch {
    return undefined;
  }

  const latestScopedUsage = [...instance.getKeyUsage()]
    .reverse()
    .find((entry) => entry.scope);
  return latestScopedUsage?.scope;
}

function buildNamespaceDetails(
  instance: I18nInstance,
  locale: string,
  loadedNamespaces: string[],
  loadedDictionaries: string[],
): NamespaceDetail[] {
  const dictNamespaces = new Set<string>();
  try {
    for (const ns of instance.getDictionaryNamespaces()) {
      dictNamespaces.add(ns);
    }
  } catch {
    // getDictionaryNamespaces may not be available; fall through
  }

  return loadedNamespaces.map((namespace) => {
    const data = instance.getResource(locale, namespace);
    const json = data ? JSON.stringify(data) : '';
    const approxBytes = json.length;
    const keyCount = data ? countLeafKeys(data) : 0;
    const source: NamespaceDetail['source'] =
      loadedDictionaries.length > 0 && dictNamespaces.has(namespace)
        ? 'dictionary'
        : 'manual';
    return {
      namespace,
      source,
      pinned: false,
      approxBytes,
      keyCount,
    };
  });
}

function buildRuntimeSnapshot(
  instance: I18nInstance,
  options: I18nDevtoolsOptions,
): RuntimeSnapshot {
  const locale = instance.getLocale();
  const loadedNamespaces = instance.getLoadedNamespaces(locale).sort();
  const loadedDictionaries = instance.getLoadedDictionaries(locale);

  const store = Object.fromEntries(
    loadedNamespaces
      .map((namespace) => [namespace, instance.getResource(locale, namespace)] as const)
      .filter((entry): entry is [string, NestedTranslations] => entry[1] !== undefined),
  );

  const keyUsage = instance.getKeyUsage();
  const uniqueKeyCount = new Set(keyUsage.map((entry) => entry.key)).size;
  const residentKeyCount = instance.getResidentKeyCount(locale);

  return {
    locale,
    currentPath: resolveCurrentPath(options),
    currentScope: resolveCurrentScope(instance, options),
    loadedScopes: instance.getLoadedScopes(locale),
    loadedDictionaries,
    loadedNamespaces,
    cacheStats: instance.getCacheStats(),
    store,
    keyUsage,
    uniqueKeyCount,
    residentKeyCount,
    namespaceDetails: buildNamespaceDetails(instance, locale, loadedNamespaces, loadedDictionaries),
  };
}

/* ------------------------------------------------------------------ */
/*  Panel composition                                                  */
/* ------------------------------------------------------------------ */

function buildPanelMarkup(runtime: RuntimeSnapshot): string {
  const scope = runtime.currentScope;
  const path = runtime.currentPath || '/';

  return `
    <div data-testid="i18n-toolbar-panel" class="vbi18n-drawer">
      <div class="vbi18n-header">
        <div class="vbi18n-title-row">
          <div class="vbi18n-title">i18n</div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:11px;color:#6c7086">${escapeHtml(runtime.locale)} &middot; ${escapeHtml(path)}${scope ? ` &middot; ${escapeHtml(scope)}` : ''}</span>
            <div class="vbi18n-actions">
              <button type="button" class="vbi18n-action" data-action="refresh">Refresh</button>
              <button type="button" class="vbi18n-action" data-action="close">&times;</button>
            </div>
          </div>
        </div>
      </div>

      <div class="vbi18n-body">
        ${renderFootprintPanel(runtime.locale, runtime.currentScope, runtime.keyUsage, runtime.store)}
        ${renderBundlesPanel({
          loadedDictionaries: runtime.loadedDictionaries,
          loadedScopes: runtime.loadedScopes,
          loadedNamespaces: runtime.loadedNamespaces,
          cacheStats: runtime.cacheStats,
          residentKeyCount: runtime.residentKeyCount,
          namespaceDetails: runtime.namespaceDetails,
          store: runtime.store,
        })}
        ${renderInspectorPanel(runtime.loadedNamespaces, runtime.store)}
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/*  Dialog lifecycle                                                   */
/* ------------------------------------------------------------------ */

function setDialogOpen(dialog: HTMLDialogElement, open: boolean): void {
  const dialogWithModal = dialog as HTMLDialogElement & {
    showModal?: () => void;
    close?: () => void;
  };

  if (open) {
    if (!dialog.open) {
      if (typeof dialogWithModal.showModal === 'function') {
        dialogWithModal.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    }
    return;
  }

  if (dialog.open) {
    if (typeof dialogWithModal.close === 'function') {
      dialogWithModal.close();
    } else {
      dialog.removeAttribute('open');
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Mount the i18n devtools drawer onto the DOM.
 *
 * Creates a floating toggle button and a side-panel `<dialog>` that reads
 * all diagnostics from the live i18n instance — no server fetching required.
 *
 * Returns a handle with `destroy()` and `refresh()` methods. In production
 * or when the devbar is disabled via `__VITE_I18N_DEVBAR__`, returns a
 * no-op handle.
 *
 * @param instance - The i18n runtime instance to inspect.
 * @param options  - Optional configuration (mount target, path/scope getters).
 * @returns A handle to control or tear down the devtools drawer.
 */
export function mountI18nDevtools(
  instance: I18nInstance,
  options: I18nDevtoolsOptions = {},
): I18nDevtoolsHandle {
  const noop: I18nDevtoolsHandle = { destroy() {}, refresh() {} };

  if (!isDevMode()) {
    return noop;
  }

  const existing = mountedDevtools.get(instance);
  if (existing) {
    existing.destroy();
  }

  ensureStyle();

  const mountTarget = options.mountTarget ?? document.body;

  // --- Toggle button ---
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'vbi18n-toggle';
  button.dataset.testid = 'i18n-toolbar-toggle';
  button.setAttribute('data-testid', 'i18n-toolbar-toggle');
  button.setAttribute('aria-label', 'Open i18n devtools');

  // --- Dialog ---
  const dialog = document.createElement('dialog');
  dialog.className = 'vbi18n-dialog';

  // --- Button badge ---
  function updateButton(runtime: RuntimeSnapshot): void {
    button.innerHTML = `
      <span>T</span>
      <span class="vbi18n-toggle-badge">${escapeHtml(String(runtime.uniqueKeyCount))}</span>
    `;
  }

  // --- Synchronous panel render ---
  function refresh(): void {
    const runtime = buildRuntimeSnapshot(instance, options);
    updateButton(runtime);
    dialog.innerHTML = buildPanelMarkup(runtime);
  }

  function openDialog(): void {
    refresh();
    setDialogOpen(dialog, true);
  }

  function closeDialog(): void {
    setDialogOpen(dialog, false);
    dialog.innerHTML = '';
  }

  // --- Event listeners ---
  button.addEventListener('click', () => {
    if (dialog.open) {
      closeDialog();
      return;
    }
    openDialog();
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      closeDialog();
    }
  });

  dialog.addEventListener('close', () => {
    dialog.innerHTML = '';
  });

  dialog.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    if (action === 'close') {
      closeDialog();
    }
    if (action === 'refresh') {
      refresh();
    }
  });

  // --- Search filtering for key lists ---
  dialog.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.classList.contains('vbi18n-search')) return;
    const targetId = input.dataset.target;
    if (!targetId) return;
    const container = dialog.querySelector(`#${targetId}`);
    if (!container) return;
    const query = input.value.toLowerCase();
    for (const row of container.querySelectorAll('.vbi18n-filterable')) {
      const key = (row as HTMLElement).dataset.key ?? '';
      (row as HTMLElement).style.display = key.toLowerCase().includes(query) ? '' : 'none';
    }
  });

  // --- Instance subscriptions ---
  // Auto-refresh the panel on locale/resource changes so navigation
  // in SPAs (Inertia, React Router) updates the drawer live.
  const unsubLocale = instance.onLocaleChange(() => {
    if (dialog.open) {
      refresh();
    } else {
      updateButton(buildRuntimeSnapshot(instance, options));
    }
  });

  const unsubResources = instance.onResourcesChange(() => {
    if (dialog.open) {
      refresh();
    } else {
      updateButton(buildRuntimeSnapshot(instance, options));
    }
  });

  // --- Initial render ---
  updateButton(buildRuntimeSnapshot(instance, options));
  mountTarget.append(button, dialog);

  const handle: InternalHandle = {
    button,
    dialog,
    destroy() {
      unsubLocale();
      unsubResources();
      closeDialog();
      button.remove();
      dialog.remove();
      if (mountedDevtools.get(instance) === handle) {
        mountedDevtools.delete(instance);
      }
    },
    refresh() {
      if (dialog.open) {
        refresh();
      } else {
        updateButton(buildRuntimeSnapshot(instance, options));
      }
    },
  };

  mountedDevtools.set(instance, handle);
  return handle;
}
