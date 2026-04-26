# API Reference

## Package Entries

Public subpaths:

- `vite-bundled-i18n`
- `vite-bundled-i18n/react`
- `vite-bundled-i18n/vanilla`
- `vite-bundled-i18n/vue`
- `vite-bundled-i18n/server`
- `vite-bundled-i18n/plugin`
- `vite-bundled-i18n/generated` — plugin-emitted `PAGE_SCOPE_MAP` and `I18nPageIdentifier`, plus key-level typing
- `vite-bundled-i18n/testing` — synchronous test helpers (`createTestI18n`, `I18nTestProvider`, `createI18nTestPlugin`)

## Core

### `createI18n(config)`

Creates the runtime instance.

```ts
const i18n = createI18n({
  locale: 'en',
  defaultLocale: 'en',
  supportedLocales: ['en', 'bg'],
  localesDir: '/locales',
  dictionaries: {
    global: {
      include: ['shared.*', 'global.*', 'actions.*'],
      priority: 1,
      pinned: true,
    },
  },
})
```

Important config fields:

- `dictionaries` — supports `keys`, `include`, `priority`, `pinned`
- `requestInit` — custom `fetch()` options (headers, credentials, cache). Static object or function.
- `cache` — in-memory eviction settings
- `compiled` — compiled-manifest loading in production
- `publicBase` — overrides the build-injected base path for bundle fetches (useful for CDN or reverse proxy)

```ts
requestInit?: RequestInit | (() => RequestInit | Promise<RequestInit>)
```

Example:

```ts
requestInit: {
  credentials: 'include',
  headers: { 'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.content },
}
```

Or dynamic:

```ts
requestInit: async () => ({
  headers: { Authorization: `Bearer ${await getToken()}` },
})
```

### `resolveUrl`

Custom URL resolver for all translation fetches. Controls WHERE translations are fetched from. Use alongside `requestInit` which controls HOW (headers, credentials).

```ts
resolveUrl?: (locale: string, type: 'dictionary' | 'scope' | 'namespace' | 'manifest', name: string) => string
```

| `type` | `name` example | Default URL pattern |
|---|---|---|
| `dictionary` | `shared`, `feedback` | `{base}/{locale}/_dict/{name}.json` |
| `scope` | `feedback.index` | `{base}/{locale}/{name}.json` |
| `namespace` | `feedback` | `{localesDir}/{locale}/{name}.json` |
| `manifest` | `manifest` | `{base}/compiled/manifest.js` |

Examples:

```ts
// Laravel route serving translations
resolveUrl: (locale, type, name) => {
  if (type === 'manifest') return `/build/__i18n/compiled/manifest.js`;
  return `/api/translations/${locale}/${type}/${name}`;
}

// CDN
resolveUrl: (locale, type, name) => {
  const cdn = 'https://cdn.example.com/i18n/v3';
  if (type === 'dictionary') return `${cdn}/${locale}/_dict/${name}.json`;
  return `${cdn}/${locale}/${name}.json`;
}

// Single endpoint per locale
resolveUrl: (locale, type, name) =>
  `/api/i18n/${locale}?type=${type}&name=${name}`
```

When `resolveUrl` is not set, the runtime uses `publicBase` (or build-injected `__VITE_I18N_BASE__`) with the default URL patterns.

Keep the runtime cache shape but without `fetch`:

```ts
cache: {
  runtime?: {
    strategy?: 'memory' | 'none'
    eviction?: 'none' | 'lru'
    maxLocales?: number
    maxNamespaces?: number
    maxBytes?: number
    pinDictionaries?: boolean
  }
}
```

Example compiled shape:

```ts
compiled: {
  enabled?: boolean | 'auto'
  manifestUrl?: string
}
```

### `instance.addLoadingScope(scope)` / `instance.removeLoadingScope(scope)`

Marks a scope as currently loading / finished loading. While a scope is in the loading set, missing-key warnings for keys in that scope's namespace are suppressed. Used internally by `useI18n()` — call directly when building custom scope-loading logic outside of React/Vue.

`addLoadingScope` is idempotent (safe to call during React render). `removeLoadingScope` should be called in cleanup (effect teardown, `onUnmounted`, etc.).

```ts
i18n.addLoadingScope('products.index')
// ...after scope loaded or component unmounted:
i18n.removeLoadingScope('products.index')
```

### `instance.changeLocale(locale)`

Switches the active locale. Automatically re-fetches all dictionaries and previously loaded scopes for the new locale, then notifies all consumers (React components re-render via context).

```ts
await i18n.changeLocale('bg');
```

In React, components using `useI18n()` automatically re-render when the locale changes. No manual wiring needed.

**Example: Language switcher**

```tsx
function LanguageSwitcher() {
  const { locale } = useI18n();
  const i18n = useContext(I18nContext)?.instance;

  return (
    <select value={locale} onChange={(e) => i18n?.changeLocale(e.target.value)}>
      <option value="en">English</option>
      <option value="bg">Български</option>
    </select>
  );
}
```

### `getTranslations(instance, scope?, options?)`

Loads dictionaries and optional scope, then returns the normalized translator object.

```ts
const translations = await getTranslations(i18n, 'products.index')
translations.get('products.index.heading')
```

### `translations`

Returned by `getTranslations()` and exposed by `useI18n()`.

Methods:

- `t(key, params?, fallback?)`
- `get(key, params?, fallback?)`
- `has(key)`
- `exists(key)`
- `tryGet(key, params?)`
- `require(key, params?)`
- `namespace(namespace, keyPrefix?)`
- `forLocale(locale)`

### `translations.namespace(ns, keyPrefix?)`

Returns a scoped translator bound to a namespace. Keys are relative — no need to repeat the namespace prefix:

```ts
const shared = translations.namespace('shared');
shared.get('actions.crud.cancel'); // resolves "shared.actions.crud.cancel"
shared.has('ok'); // checks "shared.ok"

const nav = translations.namespace('global', 'nav');
nav.get('home'); // resolves "global.nav.home"
```

Available on the `translations` property from `useI18n()`:

```tsx
const { translations } = useI18n('products.show');
const products = translations.namespace('products', 'show');
products.get('title'); // "products.show.title"
```

### `t.dynamic(key)` — loose-typed escape hatch

Every translator (`t` from `useI18n`, `createTranslations`, `scopedT`, the global `t`) exposes a `.dynamic(key, ...)` method with the same overloads as `t()` but accepting any string — bypasses the typed `TranslationKey` union.

```ts
const { t } = useI18n('status.dashboard')
const state: string = getState()

// Typed `t()` requires a literal; `.dynamic()` accepts runtime strings.
t.dynamic(`status.${state}`)
t.dynamic(`status.${state}`, 'Unknown')          // with fallback
t.dynamic('status.notice', { count: 3 })         // with params
```

Same runtime as `t()` — the only difference is the type contract. Pair with `bundling.dynamicKeys` (below) so the referenced keys are actually shipped; otherwise they'll resolve to the key itself at runtime.

### `createReadinessGate()` / `instance.gate`

Framework-agnostic readiness primitive. Every `I18nInstance` carries one as `instance.gate`. `loadScope()` auto-registers with it and releases on settle — consumers read the gate for a unified "i18n is loading" signal without maintaining their own counters.

```ts
import { createReadinessGate } from 'vite-bundled-i18n'
const gate = createReadinessGate()
gate.ready          // boolean
gate.pendingCount   // number

const release = gate.register()
// ... do async work ...
release()           // idempotent; safe to call multiple times

await gate.whenReady()      // resolves immediately if ready, else on next transition
gate.subscribe((ready) => { /* fires on every pending-count change */ })
gate.reset()        // clear pending + notify; stale release tokens become no-ops
```

**React:**

```tsx
import { GateBoundary, useGate } from 'vite-bundled-i18n/react'

// Default mode: children always mounted, fallback overlays while loading.
<GateBoundary fallback={<LoadingBar />}>
  <App />
</GateBoundary>

// Suspense mode: throws gate.whenReady() — wrap in <Suspense>.
<Suspense fallback={<LoadingBar />}>
  <GateBoundary suspense>
    <App />
  </GateBoundary>
</Suspense>

// Manual read:
function Indicator() {
  const { ready, pendingCount } = useGate()
  return ready ? null : <span>Loading {pendingCount}…</span>
}
```

**Vue:**

```ts
import { useGate } from 'vite-bundled-i18n/vue'
const { ready, pendingCount } = useGate()  // reactive refs
```

**Opting out per call:** `loadScope(locale, scope, { trackReadiness: false })` skips gate registration for that call. Use when you have an explicit orchestration layer that already gates rendering.

**Breaking change (v0.6.0):** `loadScope` auto-tracks by default. Apps that kept their own scope counters should remove them.

### `createScopeMapClient(options?)`

Framework-agnostic runtime client for the emitted `scope-map.json`.

```ts
import { createScopeMapClient } from 'vite-bundled-i18n'

const scopeMap = createScopeMapClient()

await scopeMap.load()
scopeMap.getSync('products/show')       // readonly string[] | null
scopeMap.isLoaded()                     // boolean
await scopeMap.get('cart/index')        // triggers load if not cached
scopeMap.invalidate()                   // clears cache; next access re-fetches
```

- Concurrent `load()` calls share a single in-flight promise.
- `invalidate()` during a pending fetch uses a generation counter so the stale response can't populate the cache.
- On fetch failure the shared promise rejects and the in-flight entry clears, so retries start fresh.
- Default URL honors the plugin-injected `__VITE_I18N_BASE__` define so subdirectory deploys (Laravel sidecar, `base: '/admin/'`) resolve without wiring.

Options:

```ts
createScopeMapClient({
  url: '/custom/scope-map.json',              // static override
  resolveUrl: () => `/api/i18n/${tenantId}`,  // dynamic; wins over `url`
  fetchImpl: customFetch,                      // for SSR / Node < 18
})
```

### `t()`, `hasKey()`, `getGlobalTranslations()`

Global convenience access once an instance is registered.

```ts
t('shared.ok')
hasKey('shared.ok')
getGlobalTranslations().namespace('global').get('nav.home')
```

Prefer the translator object for most code. Use module-level globals when you
explicitly want global access and the instance lifecycle is already established.

### `defineI18nConfig(config)`

Shared config for the runtime and Vite plugin.

Dictionary rules support:

- `keys` — legacy namespace names (equivalent to `include: ['namespace.*']` per entry)
- `include` — key ownership patterns: `shared.*`, `checkout.summary.*`, `shared.ok`, `admin*`
- `exclude` — remove matching keys after `include` (same pattern syntax). Use to carve out large sub-namespaces you don't need client-side (e.g. `shared.validation.*`)
- `priority` — higher priority dictionaries claim matching keys first
- `pinned` — pinned dictionaries remain in memory and are never evicted

Dictionary bundles include ALL keys from matching namespaces (minus `exclude`). No tree-shaking by extracted keys — dictionaries are the "preload everything" layer. Only scope bundles are pruned to page-specific keys.

### `extraction.keyFields`

Configures the AST extractor to recognize additional property names as translation keys in object literals.

By default, the extractor finds keys in `t()`, `useI18n()`, `i18nKey()`, and `defineI18nData()` calls. With `keyFields`, it also scans object properties:

```ts
// i18n.config.ts
export const i18nConfig = defineI18nConfig({
  localesDir: 'locales',
  extraction: {
    keyFields: ['label', 'title', 'placeholder'],
  },
})
```

This causes the extractor to detect keys in config objects:

```ts
// These keys will be extracted automatically:
const columns = [
  { label: 'products.table.name', field: 'name' },
  { title: 'products.table.price', field: 'price' },
];
```

Without `keyFields`, you'd need to wrap each key in `i18nKey()`.

The option is additive to the built-in defaults (`labelKey`, `titleKey`, `translationKey`):

```ts
defineI18nConfig({
  localesDir: 'locales',
  dictionaries: { ... },
  extraction: {
    keyFields: ['messageKey', 'columnLabel'],
  },
})
```

### `bundling.crossNamespacePacking`

Inline cross-namespace keys into each scope bundle, tree-shaken to the exact subset the route extracts.

By default, a scope bundle only includes keys from the scope's own namespace. A route that calls `t('vendors.compact.name')` from a `giftcards.show` page relies on `vendors.*` being loaded via a dictionary or another `useI18n('vendors.*')` hook somewhere in the tree. When the reference is a handful of keys used on a cold-path page (e.g. a show view you may never visit), promoting the whole namespace to a dictionary is wasteful — it ships on every page load.

With `crossNamespacePacking: true`, the extractor collects cross-namespace keys referenced on each route, tree-shakes them down to just the used subset, and inlines them into the same scope bundle. One HTTP request, zero dictionary bloat, exactly the keys the route needs.

```ts
defineI18nConfig({
  localesDir: 'locales',
  dictionaries: {
    global: { include: ['shared.*'] },
  },
  bundling: {
    crossNamespacePacking: true,
  },
})
```

Emitted shape (production):

```jsonc
// __i18n/en/giftcards.show.json
{
  "giftcards": { "show": { "title": "Gift card", "..." : "..." } },
  "vendors":   { "compact": { "name": "Vendor" } },        // 1 key — tree-shaken from vendors.json
  "activity":  { "types":   { "redeem": "Redeemed" } }      // 1 key — tree-shaken from activity.json
}
```

Keys whose namespace is already owned by a dictionary are **not** inlined — dictionaries are the always-available layer by design, and duplicating them into every scope bundle reverses the efficiency win.

**Dev mode:** the dev middleware walks your page entry points (via `options.pages`) to discover cross-namespace references and includes the affected namespaces in every scope bundle response. Dev behaves the same as production for key resolution — no "missing key" flicker for cross-namespace references. The walk is cached and invalidated on locale file changes and by the Vite transform hook on source edits. If you use the dev plugin without `options.pages` (rare — the main `i18nPlugin` always provides them), the flag has no effect in dev.

### `bundling.dynamicKeys`

Declared runtime-computed keys the extractor can't see from static `t()` calls. Each listed key is injected into every route whose scope's primary namespace matches (or, with `crossNamespacePacking: true`, every route that references the same namespace through another key).

```ts
defineI18nConfig({
  localesDir: 'locales',
  bundling: {
    dynamicKeys: ['status.active', 'status.pending', 'status.failed'],
  },
})
```

Semantics:

- Keys already owned by a dictionary are **skipped** — dictionaries already guarantee global availability; inlining would duplicate them.
- Keys whose namespace doesn't match any route and isn't dictionary-owned are **orphans** — the plugin emits a build warning per orphan so silent bloat doesn't creep in.
- Injected keys flow through the same filter + shake logic as statically extracted keys; no special case in the compiler.

Pair with `t.dynamic(key)` in source code:

```tsx
const state: 'active' | 'pending' | 'failed' = getState()
t.dynamic(`status.${state}`)  // resolves correctly at runtime
```

### `bundling.strictScopeRegistration`

Audit that flags routes whose entire import graph registers no scope. The emitted `PAGE_SCOPE_MAP[pageId]` would be `[]` and consumers using the [router integration](#page-scope-map) pattern couldn't preload anything — almost always a misconfiguration.

```ts
defineI18nConfig({
  localesDir: 'locales',
  bundling: {
    strictScopeRegistration: 'warn',   // default — logs via Vite's logger
    // 'error' — fails the build
    // 'off'   — silent
  },
})
```

Both scope-registration patterns pass the audit:

- **Pattern A:** the page itself calls `useI18n('<literal>')`.
- **Pattern B:** the page composes child components that register scopes. Children reading the already-loaded cache via `useI18n()` without args stay valid.

The audit only fires when the aggregated scopes across a route's full import graph are empty.

### `bundling.dev.leanBundles`

Tree-shake dev scope-bundle responses to the keys the route's AST extraction found — same shape as the production build.

```ts
defineI18nConfig({
  bundling: {
    dev: {
      leanBundles: true,   // default
    },
  },
})
```

Impact on a 50-page admin with 3,000 keys: each dev scope response drops from ~140 kB to ~8 kB. Match prod semantics in dev, keep the dev server snappy on large apps.

Behavior:

- **Lean (default):** the dev middleware consults scope plans built from the same analysis the production build uses. Each response contains only the extracted keys per namespace, plus tree-shaken cross-ns extras when `crossNamespacePacking: true`.
- **Unknown scope / `options.pages` not configured / explicit opt-out:** the middleware falls back to full namespaces. Preserves the v0.6.0 behavior as a safety net so debugging unregistered scopes still works.
- **Opt out permanently:** `bundling.dev.leanBundles: false` — restores v0.6.0 dev behavior (ships full namespaces).

The cache is kept warm by the Vite `transform` hook — source edits refresh the underlying extraction cache, which invalidates the scope-plan cache on the next request.

**Devtools:** key-usage entries are tagged with the active scope (set automatically by `useI18n(scope)` on every render). The devtools "Missing Translations" panel filters entries to the current scope so navigating between pages doesn't leave stale misses behind. Entries are also tagged with an epoch that bumps on locale change, so switching locales clears the slate. Call `instance.resetKeyUsage()` from host-app navigation hooks for an explicit reset.

### Page scope map

At build time the plugin emits `__i18n/scope-map.json` — a framework-neutral index of `page id → { scopes, dictionaries }`. In dev the same payload is served at `/__i18n/scope-map.json`. The generated types also include a typed `PAGE_SCOPE_MAP` const and a `I18nPageIdentifier` literal union, importable from `vite-bundled-i18n/generated`.

Consumers use this inside their router's async page-resolve hook to kick off scope loads *in parallel* with component resolution:

```ts
// Sketch — adapt to your router's resolve API
import { PAGE_SCOPE_MAP, type I18nPageIdentifier } from 'vite-bundled-i18n/generated';
import { i18n } from './i18n';

async function resolvePage(pageId: I18nPageIdentifier, loadComponent: () => Promise<unknown>) {
  const scopes = PAGE_SCOPE_MAP[pageId];
  await Promise.all([
    loadComponent(),
    ...scopes.map((scope) => i18n.loadScope(i18n.getLocale(), scope)),
  ]);
}
```

**Custom identifiers.** The default page identifier strips `src/pages/` and common `.tsx` / `.page.tsx` suffixes:

```
src/pages/giftcards/show.tsx       → "giftcards/show"
src/pages/products/show.page.tsx   → "products/show"
```

Override with `pageIdentifier` on the plugin options when your router exposes a different token at runtime:

```ts
i18nPlugin(config, {
  pages: ['admin/**/pages/*.tsx'],
  locales: ['en'],
  defaultLocale: 'en',
  pageIdentifier: (abs) => {
    // Produce whatever your router returns at matched-page time.
    return abs.replace(/^.*?\/admin\//, 'admin/').replace(/\.tsx$/, '');
  },
})
```

Whatever string your function returns is the key in `scope-map.json`, `PAGE_SCOPE_MAP`, and the `I18nPageIdentifier` union. Consumers can then do `PAGE_SCOPE_MAP[router.currentRoute.id]` with full type safety.

**Shape on disk:**

```jsonc
{
  "version": 1,
  "defaultLocale": "en",
  "pages": {
    "giftcards/show": {
      "scopes": ["giftcards.show"],
      "dictionaries": ["global"]
    },
    "cart/index": {
      "scopes": ["cart.index", "cart.summary"],
      "dictionaries": ["global"]
    }
  }
}
```

`dictionaries` lists every dictionary name configured for the app — dictionaries are app-wide, so the list is identical for every page. Included as a convenience for consumers that want a single source of truth for "what to preload".

Gated by `emitReports` at build time (static file is skipped when reports are disabled). The dev middleware endpoint is always on.

### `loadScope` concurrency

`instance.loadScope(locale, scope)` guarantees:

- Concurrent calls for the same `(locale, scope)` share a single in-flight promise. One hundred parallel `loadScope('en', 'products')` calls fire exactly one HTTP request and resolve or reject together.
- An already-loaded scope returns a resolved promise (microtask) — no network.
- On fetch failure the promise rejects and the in-flight entry is cleared so a retry starts fresh.

This makes it safe to call `loadScope` from inside your router's async resolve hook without coordinating across components. Side effects (cache writes, `setActiveScope`, diagnostics) run once per logical load, not once per caller.

### Extraction cache (`cache`)

AST analysis is expensive on large codebases. The plugin persists per-file extraction results to `.i18n/cache/extraction-v1.json` and skips parsing any file whose `mtime` + `size` hasn't changed since the last run. On warm dev starts the entire walk reduces to a handful of `stat` calls — typically 10–50 ms regardless of project size.

The cache is on by default. The behavior is identical to v0.4.0 when the cache is disabled, so you never lose correctness, only speed.

```ts
// Default — cache enabled
i18nPlugin(config, {
  pages: [...],
  locales: ['en', 'bg'],
  defaultLocale: 'en',
})

// Disable
i18nPlugin(config, {
  pages: [...],
  locales: ['en', 'bg'],
  defaultLocale: 'en',
  cache: false,
})

// Fine-grained
i18nPlugin(config, {
  ...,
  cache: {
    enabled: true,
    dir: '.i18n/cache',   // default; override for monorepo packages
    persist: true,         // set false for ephemeral envs
  },
})
```

**Automatic invalidation.** The cache file carries a header (`pluginVersion`, `configHash`, `nodeVersion`, `schemaVersion`). Any mismatch on load discards the snapshot entirely:

- Plugin upgrade → cache rebuilt
- Config edit (`dictionaries`, `pages`, `hookSources`, `keyFields`, `bundling.crossNamespacePacking`, `extractionScope`) → cache rebuilt
- Node major version change → cache rebuilt
- Corrupt or unreadable file → treated as cold start

Per-file `mtime` + `size` covers everyday editing.

**Manual bypass.** Env vars always win over config — handy for one-off troubleshooting:

| Variable | Effect |
|---|---|
| `VITE_I18N_NO_CACHE=1` | Disable the cache for this process — skip both read and write |
| `VITE_I18N_CLEAR_CACHE=1` | Delete `.i18n/cache/` before start, then run normally |
| `VITE_I18N_CACHE_DEBUG=1` | Stream cache hits/misses to stderr |

CLI flags mirror the env vars:

```bash
npx vite-bundled-i18n build --no-cache
npx vite-bundled-i18n analyze --clear-cache
```

**Dev-mode HMR integration.** During `vite dev` the plugin registers a `transform` hook that piggybacks on Vite's own parse pipeline. When Vite transforms a source file (cold load or HMR), the cache entry for that file is refreshed in-place. No extra AST parse — we reuse Vite's tokenization.

**CI builds.** The cache is on by default in CI too. If your runner persists `.i18n/cache/` between builds (most monorepo tools do), `vite build` becomes near-instant when nothing changed. If the directory is ephemeral, the cache is simply empty and the behavior matches v0.4.0.

**`.gitignore`.** The cache is a local artifact — don't commit it. Add:

```gitignore
.i18n/cache/
```

**Tests.** `NODE_ENV=test` disables the cache by default so test isolation is preserved. Override with an explicit `cache: true` if you need the cache active during tests.

### `defineI18nData(data)` and `i18nKey(key)`

Helpers for serializable data/config modules:

```ts
export const nav = defineI18nData([
  { href: '/', labelKey: i18nKey('global.nav.home') },
])
```

## React

### `<I18nProvider>`

Registers the instance globally, loads dictionaries, and re-renders on locale change. **Blocks rendering until dictionaries are loaded** — children only render once shared translations are available.

```tsx
<I18nProvider instance={i18n} fallback={<Spinner />}>
  <App />
</I18nProvider>
```

Props:

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `instance` | `I18nInstance` | required | The instance from `createI18n()` |
| `children` | `ReactNode` | required | App content |
| `fallback` | `ReactNode` | `null` | Shown while dictionaries load. `null` = blank screen. |
| `serverResources` | `Record<string, NestedTranslations>` | — | SSR pre-loaded translations (skips dictionary fetch) |
| `serverScopes` | `string[]` | — | Scope ids already hydrated on the server; marks `useI18n(scope)` ready on first render |
| `serverDictionaries` | `string[]` | — | Dictionary names already hydrated on the server; marks them loaded without refetch |
| `preloadScopes` | `string[]` | — | Scopes to eagerly fetch alongside dictionaries |
| `eager` | `boolean` | `false` | Render children before dictionaries are ready |

**Loading phases:**

1. **App init** — Provider loads all dictionaries. Children are blocked until ready (or `eager` is set). Layout, nav, breadcrumbs using `shared.*` keys are guaranteed to have translations.
2. **Page navigation** — Provider persists. `useI18n(scope)` in page components loads scope bundles. Only the page content waits (via `ready` or `I18nBoundary`). Dictionaries are always available.
3. **Locale switch** — `changeLocale('bg')` awaits all refetches internally, then notifies. No flash — new locale data is loaded before consumers re-render.

**Cache-aware:** On remount (Next.js Pages Router), the provider detects cached dictionary data in the instance store and renders immediately — no refetch, no flash.

### `useI18n(scope?)`

Returns:

- `t`
- `get`
- `has`
- `exists`
- `tryGet`
- `require`
- `translations`
- `ready`
- `locale`

Example:

```tsx
const { t, translations, ready } = useI18n('products.show')
```

`ready` matters when a requested scope still needs to load.
It reflects both provider dictionary readiness and the requested scope state.

### `<I18nBoundary>`

Boundary component that handles scope loading. Children only render once translations are ready, avoiding rules-of-hooks violations from early returns.

```tsx
import { I18nBoundary } from 'vite-bundled-i18n/react'

<I18nBoundary scope="products.index" fallback={<Spinner />}>
  <ProductsPage />
</I18nBoundary>
```

Props:

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `scope` | `string` | required | Scope identifier to load |
| `fallback` | `ReactNode` | `null` | Rendered while translations load |
| `children` | `ReactNode` | required | Rendered once scope is ready |

## Vue

### `createI18nPlugin(instance)`

Creates a Vue plugin that provides the i18n instance to all components.

```ts
import { createI18n } from 'vite-bundled-i18n'
import { createI18nPlugin } from 'vite-bundled-i18n/vue'

const i18n = createI18n({ ... })
const app = createApp(App)
app.use(createI18nPlugin(i18n))
app.mount('#app')
```

### `useI18n(scope?)`

Vue composable. Returns:

- `t`
- `get`
- `has`
- `exists`
- `tryGet`
- `require`
- `translations` (Ref)
- `ready` (Ref)
- `locale` (Ref)

Example:

```ts
import { useI18n } from 'vite-bundled-i18n/vue'

const { t, ready } = useI18n('products.show')
```

## Vanilla

### `initI18n(config, options?)`

Convenience helper for non-React apps.

Options:

- `serverResources`
- `scope`
- `setGlobal`

It creates the instance, optionally registers it globally, loads dictionaries,
applies server resources, and can preload one scope.

## Instance Methods

Main instance methods:

- `translate(locale, key, params?, fallback?)`
- `tryTranslate(locale, key, params?)`
- `hasKey(locale, key)`
- `loadNamespaces(locale, namespaces)`
- `loadDictionary(locale, name)`
- `loadAllDictionaries(locale)`
- `loadScope(locale, scope)`
- `addResources(locale, namespace, data)`
- `isNamespaceLoaded(locale, namespace)`
- `isScopeLoaded(locale, scope)`
- `getCacheStats()`
- `unloadLocale(locale)`
- `unloadNamespace(locale, namespace)`
- `evictUnused()`
- `getDictionaryNamespaces()`
- `getDictionaryNames()`
- `getLocale()`
- `changeLocale(locale)`
- `onLocaleChange(callback)`
- `getKeyUsage()`
- `getResource(locale, namespace)`
- `getResidentKeyCount(locale)` — returns the total number of translation keys currently held in memory for the given locale across all loaded namespaces
- `addLoadingScope(scope)` — marks a scope as loading (suppresses warnings for its namespace). Idempotent, render-safe.
- `removeLoadingScope(scope)` — removes a scope from the loading set. Call in cleanup.

## Vite Plugin

Import from `vite-bundled-i18n/plugin`.

### `i18nPlugin(sharedConfig, options?)`

```ts
i18nPlugin(sharedConfig: I18nSharedConfig, options?: I18nPluginOptions): PluginOption[]
```

Unified dev + build plugin.

Dev:

- serves `__i18n/{locale}/_dict/{name}.json` and `__i18n/{locale}/_scope/{namespace}.json` via Vite middleware
- emits `vite-bundled-i18n:resources-updated` HMR events when locale files change
- skips compiled auto-mode in dev so the runtime does not probe `compiled/manifest.js`
- route diagnostics are computed lazily on demand (only when devtools requests them)

Plugin options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `pages` | `string[]` | required | Glob patterns for route entry points |
| `locales` | `string[]` | required | Supported locale codes |
| `defaultLocale` | `string` | required | Fallback locale |
| `generatedOutDir` | `string` | `'.i18n'` | Where to write reports/artifacts |
| `typesOutPath` | `string` | `'.i18n/i18n-generated.ts'` | Generated types location |
| `assetsDir` | `string` | `'__i18n'` | Output assets directory name |
| `emitTypes` | `boolean` | `true` | Generate TypeScript types |
| `emitReports` | `boolean` | `true` | Generate analysis reports |
| `emitCompiled` | `boolean` | `true` | Generate compiled JS modules |
| `dev.emitPublicAssets` | `boolean` | `false` | Write translation bundles to `public/__i18n/` |
| `dev.devBar` | `boolean` | `true` | Show devtools toggle and drawer in dev mode |

### `i18nDevPlugin(sharedConfig, options?)`

Dev-only plugin.

By default, all translation bundles are served via Vite middleware. If your setup requires static files in the public directory (e.g. Laravel sidecar), pass `emitPublicAssets: true` in options. These emitted dev assets are temporary and should be ignored in app-level `.gitignore` (`public/__i18n/`).

### `I18nDevtoolsOptions`

Options accepted by `mountI18nDevtools()` and `<DevToolbar>`.

| Option | Type | Description |
|--------|------|-------------|
| `mountTarget` | `HTMLElement` | DOM node to attach the devtools drawer to. Defaults to `document.body`. |
| `getCurrentPath` | `() => string` | Returns the current URL path for the Page Footprint panel. Defaults to `() => location.pathname`. |
| `getCurrentScope` | `() => string \| undefined` | Returns the active scope identifier for highlighting in the drawer. |

The drawer reads all translation data directly from the runtime instance — no server round-trips are made.

### `i18nBuildPlugin(sharedConfig, buildConfig)`

Build-only plugin.

### `emitI18nBuildArtifacts(options)`

Programmatic build entry for advanced tooling/tests.

This writes:

- `__i18n/...` JSON assets
- compiled manifest/modules
- generated types
- analysis reports

## Reports

Generated reports:

- `manifest.json`
- `missing.json`
- `unused.json`
- `stats.json`
- `overlap.json`
- `ownership.json`

`ownership.json` contains:

- normalized dictionary rules
- actual owned keys per dictionary
- collision data where multiple dictionaries match the same key
- unowned keys

## Server Entry

Import from `vite-bundled-i18n/server`.

### `initServerI18n(config, scope?, locale?)`

Creates an instance, loads dictionaries and optional scope, and returns everything needed for SSR.

Returns:

- `translations` — translator object for rendering
- `scriptTag` — `<script>` tag string that sets `window.__I18N_RESOURCES__` for client auto-hydration
- `instance` — the i18n instance (advanced use)

```ts
const { translations, scriptTag } = await initServerI18n(config, 'products.show')
const html = renderToString(<App translations={translations} />)
// Inject scriptTag into HTML <head> or <body>
```

The React `I18nProvider` and Vue `createI18nPlugin` automatically detect and consume `window.__I18N_RESOURCES__` on the client — no manual wiring needed.

## Generated Types

The type generator writes `.i18n/i18n-generated.ts` (configurable via `typesOutPath`). Types are generated on `npm run dev` (auto, on startup and locale file changes) and during `npm run build`.

To connect the generated types, add to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "vite-bundled-i18n/generated": ["./.i18n/i18n-generated.ts"]
    }
  },
  "include": ["src", ".i18n"]
}
```

Without this setup, `t()` accepts any string (no errors, no autocomplete). With it, `t()` validates keys and provides progressive autocomplete.

### `I18nNestedKeys`

Nested tree of all translation keys. This is the single source of truth for `TranslationKey`. Enables progressive autocomplete — the IDE suggests one level at a time instead of dumping thousands of flat strings.

```ts
interface I18nNestedKeys {
  feedback: {
    pages: {
      index: { title: true; description: true };
    };
    actions: { delete: true; view: true };
  };
}
```

### `TranslationKey`

Derived from `DotPath<I18nNestedKeys>`. Resolves to `'feedback.pages.index.title' | 'feedback.pages.index.description' | ...` — but the IDE explores it progressively via the nested tree. Falls back to `string` when no types are generated.

### `I18nParamsMap`

Flat map of keys that have `{{placeholder}}` interpolation. Only parameterized keys are listed — keys without placeholders are omitted.

```ts
interface I18nParamsMap {
  'cart.item.quantity': { count: Primitive };
  'products.show.price': { amount: Primitive };
}
```

This powers compile-time enforcement: `t('cart.item.quantity')` without `{ count }` is a type error.

### `I18nScopeMap`

Valid scope identifiers from page scanning. Constrains `useI18n(scope)` so typos like `useI18n('feedbak.index')` are caught at compile time.

### `DotPath<T>`

Utility type exported from the package. Converts a nested tree type to a union of dot-separated paths. Available for advanced use but typically consumed indirectly via `TranslationKey`.

### `ValidScope`

Union of valid scope identifiers when `I18nScopeMap` is populated, or `string` when no types are generated.

## Testing

Import from `vite-bundled-i18n/testing`. Synchronous, network-free, gate starts ready — designed for unit tests.

### `createTestI18n(options)`

```ts
import { createTestI18n } from 'vite-bundled-i18n/testing'

const i18n = createTestI18n({
  translations: {
    shared: { ok: 'OK' },
    products: { show: { title: 'Details' } },
  },
  locale: 'en',                // default 'en'
  defaultLocale: 'en',         // default: same as locale
  supportedLocales: ['en'],    // default: [locale]
  passthroughMissing: true,    // default true; false → throws on miss
})
```

Returns an `I18nInstance` with the seeded translations already installed via `addResources`. No `loadScope` / `loadAllDictionaries` calls are made, and `instance.gate.ready` starts `true`. Consumers of `<GateBoundary>` / `useGate()` render immediately.

`passthroughMissing: false` is the test-strict mode: any `t()` on a key not seeded (and without an explicit fallback) throws instead of degrading to the key string. Useful for "I forgot to seed X" showing up as a hard failure rather than a silent miss.

### `I18nTestProvider({ instance, children })`

React provider that mounts the `I18nContext` directly with `dictsReady: true`. Skips the async hydration cycle of the production `I18nProvider`.

```tsx
import { render } from '@testing-library/react'
import { createTestI18n, I18nTestProvider } from 'vite-bundled-i18n/testing'

const i18n = createTestI18n({ translations: { shared: { ok: 'OK' } } })

render(
  <I18nTestProvider instance={i18n}>
    <MyComponent />
  </I18nTestProvider>,
)
```

### `createI18nTestPlugin(instance)`

Vue test plugin — alias of the production `createI18nPlugin` under a name that signals test intent in imports.

```ts
import { createI18nTestPlugin } from 'vite-bundled-i18n/testing'
app.use(createI18nTestPlugin(i18n))
```
