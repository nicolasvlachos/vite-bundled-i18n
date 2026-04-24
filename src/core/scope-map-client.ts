/**
 * Framework-agnostic runtime client for the `scope-map.json` artifact
 * emitted by the Vite plugin / dev middleware.
 *
 * Consumers use this alongside their router's async resolve hook to
 * parallelize scope loading with component resolution:
 *
 * ```ts
 * import { createScopeMapClient } from 'vite-bundled-i18n';
 * import { i18n } from './i18n';
 *
 * const scopeMap = createScopeMapClient();
 *
 * router.beforeResolve(async (to, from, next) => {
 *   const [scopes] = await Promise.all([
 *     scopeMap.get(to.name as string),
 *     to.meta.loadComponent?.(),
 *   ]);
 *   await Promise.all(scopes.map((s) => i18n.loadScope(i18n.getLocale(), s)));
 *   next();
 * });
 * ```
 *
 * The client keeps an in-memory cache. `load()` is idempotent — concurrent
 * calls share a single fetch. `invalidate()` clears the cache so the next
 * access re-fetches.
 */

export interface ScopeMapPageEntryRuntime {
  readonly scopes: readonly string[];
  readonly dictionaries: readonly string[];
}

export interface ScopeMapFileRuntime {
  readonly version: number;
  readonly defaultLocale: string;
  readonly pages: Readonly<Record<string, ScopeMapPageEntryRuntime>>;
}

export interface CreateScopeMapClientOptions {
  /** Static URL override. Defaults to `/__i18n/scope-map.json`. */
  url?: string;
  /**
   * Dynamic URL resolver. Called on every `load()` — use this when the URL
   * depends on runtime state (e.g. an authenticated tenant id, a deploy
   * channel). Overrides `url` when provided.
   */
  resolveUrl?: () => string;
  /**
   * Custom `fetch` implementation. Defaults to `globalThis.fetch`. Tests
   * inject a mock; SSR layers inject a server-side fetch.
   */
  fetchImpl?: typeof fetch;
}

export interface ScopeMapClient {
  /**
   * Return the scope list for `pageId`. Triggers a load if the map isn't
   * cached yet; subsequent calls resolve from memory. Unknown page ids
   * resolve to an empty array — the caller decides whether that's an error.
   */
  get(pageId: string): Promise<readonly string[]>;

  /**
   * Synchronous lookup. Returns the scope list if the map is already loaded,
   * otherwise `null`. Use this when you can tolerate a miss (e.g. in a
   * render path that also calls `load()` elsewhere).
   */
  getSync(pageId: string): readonly string[] | null;

  /**
   * Fetch the scope-map once (concurrent callers share the in-flight
   * promise). A second call after a successful load is a no-op.
   */
  load(): Promise<void>;

  /** Clear the in-memory cache so the next access re-fetches. */
  invalidate(): void;

  /** `true` once `load()` has completed successfully. */
  isLoaded(): boolean;
}

/**
 * Compute the default scope-map URL. Honors the plugin-injected
 * `__VITE_I18N_BASE__` define so subdirectory / sidecar deploys
 * (Laravel `public/`, `base: '/admin/'`, etc.) resolve correctly without
 * requiring consumers to wire `url` / `resolveUrl` themselves.
 *
 * Falls back to `/__i18n/scope-map.json` in environments where the define
 * isn't present (tests, raw Node scripts, non-Vite SSR).
 */
function defaultScopeMapUrl(): string {
  const base = typeof __VITE_I18N_BASE__ !== 'undefined' && __VITE_I18N_BASE__
    ? __VITE_I18N_BASE__
    : '/__i18n';
  const normalized = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${normalized}/scope-map.json`;
}

/**
 * Create a new {@link ScopeMapClient}. Safe to instantiate multiple times;
 * each instance keeps its own cache.
 */
export function createScopeMapClient(
  options: CreateScopeMapClientOptions = {},
): ScopeMapClient {
  let cache: ScopeMapFileRuntime | null = null;
  let inFlight: Promise<void> | null = null;
  // Generation counter — incremented by `invalidate()`. Any in-flight fetch
  // started under an older generation must NOT populate the cache when it
  // settles; otherwise `invalidate()` followed by `load()` could see stale
  // data racing ahead of the new request.
  let generation = 0;

  function resolveUrl(): string {
    if (options.resolveUrl) return options.resolveUrl();
    return options.url ?? defaultScopeMapUrl();
  }

  async function performLoad(forGeneration: number): Promise<void> {
    const fetchImpl = options.fetchImpl
      ?? (typeof fetch !== 'undefined' ? fetch : undefined);
    if (!fetchImpl) {
      throw new Error(
        'vite-bundled-i18n: createScopeMapClient requires a fetch implementation. ' +
          'Pass { fetchImpl } explicitly in Node < 18 environments.',
      );
    }

    const response = await fetchImpl(resolveUrl());
    if (!response.ok) {
      throw new Error(
        `vite-bundled-i18n: scope-map fetch failed (HTTP ${response.status}) at ${resolveUrl()}`,
      );
    }
    const data = (await response.json()) as ScopeMapFileRuntime;
    if (forGeneration === generation) {
      cache = data;
    }
  }

  return {
    async load() {
      if (cache) return;
      if (inFlight) return inFlight;
      const gen = generation;
      inFlight = performLoad(gen).finally(() => {
        if (gen === generation) inFlight = null;
      });
      return inFlight;
    },

    async get(pageId) {
      if (!cache) await this.load();
      return cache?.pages[pageId]?.scopes ?? [];
    },

    getSync(pageId) {
      if (!cache) return null;
      return cache.pages[pageId]?.scopes ?? [];
    },

    invalidate() {
      cache = null;
      generation++;
      inFlight = null;
    },

    isLoaded() {
      return cache !== null;
    },
  };
}
