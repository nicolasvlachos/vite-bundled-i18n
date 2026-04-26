# vite-bundled-i18n

Make translations behave like code: split, scoped, and bundled per route.

```bash
npm i vite-bundled-i18n
```

Traditional i18n treats translations as global runtime data — loaded all at once, resolved by key lookup, impossible to tree-shake. `vite-bundled-i18n` treats them as **code dependencies**. The Vite plugin walks your page components at build time, extracts the exact keys each route uses via AST analysis, and emits scope-matched bundles. Each page ships only the translations it needs.

The result: a 50-page admin panel with 3,000 translation keys loads ~40 keys on any given page instead of all 3,000. The rest are tree-shaken at build time and never sent to the client.

## How It Works

```
Source files           Build pipeline            Production output
─────────────         ─────────────────         ──────────────────
ProductsPage.tsx  ──→  AST extraction     ──→   __i18n/en/products.index.json  (12 keys)
CartPage.tsx      ──→  Key tracking       ──→   __i18n/en/cart.json            (8 keys)
Layout.tsx        ──→  Dictionary rules   ──→   __i18n/en/_dict/global.json    (shared keys)
                       Scope bundling
                       Type generation    ──→   .i18n/i18n-generated.ts        (full autocomplete)
```

The Vite plugin parses your import graph, maps every `t()` / `useI18n()` / `i18nKey()` call to the route that reached it, and emits per-route JSON plus optional compiled `Map` modules. The runtime is a thin `t()` that loads the right bundle on demand. React, Vue, and vanilla adapters all share a ~50-line core.

## Features

### What makes it different

- **Scope bundles** — each route loads only its own translations in one HTTP request
- **Page scope map** — framework-neutral `scope-map.json` + typed `PAGE_SCOPE_MAP` const, so any router can parallelize scope loads with component resolution ([router integration](#router-integration))
- **Readiness gate** — framework-agnostic `i18n.gate` tracks outstanding `loadScope()` calls; React `<GateBoundary>` / `useGate()` and Vue `useGate()` consume it directly. One primitive, zero consumer counters
- **`createScopeMapClient()`** — typed runtime client for the emitted scope-map, with in-flight dedup and generation-safe invalidation. Works in any router context
- **Cross-namespace packing** (opt-in) — inline a route's cross-namespace keys, tree-shaken, into its scope bundle. 1–3 foreign keys don't force a whole dictionary to load globally
- **Persistent extraction cache** — per-file AST results survive between runs. Warm dev starts in ~250 ms instead of 3–10 s; repeat builds skip the walk when nothing changed
- **Lean dev bundles** — dev responses are tree-shaken by default (matches prod shape). ~10–20× smaller on large apps; opt-out via `bundling.dev.leanBundles: false`
- **`t.dynamic()` + `bundling.dynamicKeys`** — loose-typed escape hatch for runtime-computed keys, paired with a config list so declared dynamic keys actually ship
- **`vite-bundled-i18n/testing`** — `createTestI18n`, `I18nTestProvider`, `createI18nTestPlugin` — synchronous, network-free, ready-by-default for unit tests
- **Progressive autocomplete** — generated types let the IDE suggest one key segment at a time

### Also included

- **Dictionary ownership** — named dictionaries claim keys by `include` / `exclude` / `priority`, pinned in memory
- **Placeholder validation** — `t('cart.total', { amount })` is type-checked against `{{amount}}` in the JSON
- **Compiled mode** — optional `Map`-based modules for O(1) lookups without JSON parsing
- **Multi-framework** — React, Vue, vanilla JS share a single core
- **SSR** — server rendering with automatic client hydration via `window.__I18N_RESOURCES__`
- **AST extraction** — `t()`, `useI18n()`, `i18nKey()`, `defineI18nData()`, configurable `keyFields`, `as const` objects, string enums, helper functions that receive `t` as a parameter
- **Scope registration audit** — `bundling.strictScopeRegistration: 'off' | 'warn' | 'error'` catches routes that extract zero keys at build time
- **Dev toolbar** — scope-aware missing-key panel (filters by current route, resets on locale change and HMR), per-namespace bundle efficiency, live updates on navigation

## Performance

The library is a performance play end-to-end. Representative numbers for a 50-page admin panel with 3,000 translation keys:

| | Traditional i18n | vite-bundled-i18n |
|---|---|---|
| Keys per page load | 3,000 (all) | 25–40 (route-extracted) |
| Scope bundle size (prod) | N/A (monolithic) | ~97% smaller than the source namespace |
| Scope bundle size (dev) | — | same as prod by default (lean bundles) |
| HTTP requests per route | many (or one huge) | 1 scope bundle + cached dictionaries |
| Cold dev start | — | ~200 ms |
| Warm dev start | — | ~250 ms (extraction cache keeps prior AST parses) |
| Repeat `vite build`, unchanged code | full walk | near-zero parse (cache-hit, stat-only) |
| HMR key edit → browser refetch | full re-walk | ~30 ms (surgical cache update) |
| Compiled-mode `t('key')` | JSON parse + path traversal | O(1) `Map.get` |

The extraction cache persists to `.i18n/cache/` and auto-invalidates on plugin upgrade, config change, or Node major version change. Disable with `cache: false` or `VITE_I18N_NO_CACHE=1`. See [API docs — Extraction cache](./docs/api.md#extraction-cache-cache).

Compiled mode replaces JSON parsing with pre-resolved flat `Map` modules. Faster than JSON at the browser level (no parse on first lookup), smaller gzipped (shared string pool), cacheable by the browser's module loader. Falls back to JSON automatically when compiled modules aren't available.

Lean dev bundles tree-shake each scope response to the keys the route actually extracted — same shape as the production build. On a 50-page admin, dev scope responses drop from ~140 kB to ~8 kB. Opt out via `bundling.dev.leanBundles: false` if you want the v0.6.0 full-namespace behavior.

## Setup

Three files wire everything together:

### 1. Config — declare dictionaries and locale directory

```ts
// src/i18n.config.ts
import { defineI18nConfig } from 'vite-bundled-i18n'

export const i18nConfig = defineI18nConfig({
  localesDir: 'locales',
  dictionaries: {
    global: {
      include: ['shared.*', 'global.*', 'actions.*'],
      exclude: ['shared.validation.*'],
      priority: 1,
      pinned: true,
    },
  },
})
```

### 2. Runtime instance — holds locale state

```ts
// src/i18n.ts
import { createI18n } from 'vite-bundled-i18n'
import { i18nConfig } from './i18n.config'

export const i18n = createI18n({
  ...i18nConfig,
  localesDir: '/locales',
  locale: 'en',
  defaultLocale: 'en',
  supportedLocales: ['en', 'bg'],
})
```

### 3. Vite plugin — extraction, types, and bundle emission

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { i18nPlugin } from 'vite-bundled-i18n/plugin'
import { i18nConfig } from './src/i18n.config'

export default defineConfig({
  plugins: [
    react(),
    i18nPlugin(i18nConfig, {
      pages: ['src/pages/**/*.tsx'],
      locales: ['en', 'bg'],
      defaultLocale: 'en',
    }),
  ],
})
```

### 4. TypeScript — enable autocomplete

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

Types are generated automatically during `npm run dev` and `npm run build`.

## React

```tsx
import { I18nProvider } from 'vite-bundled-i18n/react'
import { i18n } from './i18n'

// Provider loads dictionaries, blocks until ready.
createRoot(root).render(
  <I18nProvider instance={i18n} fallback={<Spinner />}>
    <App />
  </I18nProvider>,
)
```

```tsx
import { useI18n } from 'vite-bundled-i18n/react'

function ProductsPage() {
  const { t, ready } = useI18n('products.index')
  if (!ready) return <Skeleton />

  return <h1>{t('products.index.heading', 'All Products')}</h1>
}
```

**`useI18n(scope)`** triggers a single HTTP request to load the scope bundle. Dictionaries are always available. Previously visited scopes are instant (cached). Missing-key warnings are automatically suppressed while a scope is loading — no need to guard every `useMemo`.

**`useI18n()` without a scope** returns a translator bound to the current cache — whatever's already loaded (dictionaries + any scope the parent or sibling components registered). Use this in child components below a page that has already declared its scope, or in layout components that only read dictionary keys.

```tsx
// Pattern A — page registers its own scope
function ProductsPage() {
  const { t } = useI18n('products.show')  // loads products.show bundle
  return <section><Header /><Details /></section>
}

// Pattern B — page composes children; each child declares its own scope
function AdminPage() {
  return <><Sidebar /><MainContent /></>  // no scope at the page level
}
function Sidebar() {
  const { t } = useI18n('sidebar.admin')  // child registers
  return <nav>{t('sidebar.admin.heading')}</nav>
}
function MainContent() {
  const { t } = useI18n()                 // reads whatever's loaded
  return <main>{t('sidebar.admin.welcome')}</main>
}
```

Both patterns feed the same `PAGE_SCOPE_MAP` — the walker aggregates scopes across the full route tree, so routers using the [integration pattern](#router-integration) preload correctly either way.

**`I18nBoundary`** handles scope loading without early returns:

```tsx
<I18nBoundary scope="products.index" fallback={<Skeleton />}>
  <ProductsPage />
</I18nBoundary>
```

**Navigation lifecycle:** The provider persists across page navigations (Inertia, React Router, Next.js). Dictionaries load once. Each page scope loads on mount — only the page content waits, not the layout.

## Router Integration

`useI18n('products.show')` triggers the scope load on mount — but mount only happens *after* the router has resolved the matched component. On slow connections this serializes the scope fetch behind the component chunk. `PAGE_SCOPE_MAP` unblocks this: the scope list for every page is a build-time constant, fully typed, importable anywhere.

Combine it with your router's async page-resolve hook and `Promise.all` so both promises race in parallel:

```ts
import {
  PAGE_SCOPE_MAP,
  type I18nPageIdentifier,
} from 'vite-bundled-i18n/generated'
import { i18n } from './i18n'

// Sketch — adapt to your router's resolve API
async function resolvePage(
  pageId: I18nPageIdentifier,
  loadComponent: () => Promise<unknown>,
) {
  const scopes = PAGE_SCOPE_MAP[pageId]
  const locale = i18n.getLocale()
  await Promise.all([
    loadComponent(),
    ...scopes.map((scope) => i18n.loadScope(locale, scope)),
  ])
}
```

Calling `loadScope` is safe from concurrent paths. The runtime deduplicates by `(locale, scope)` — 100 parallel calls fire exactly one fetch and share the same promise. On fetch failure, that promise rejects and the in-flight entry clears, so a retry starts fresh. Side effects (cache writes, devbar state, dependent scope flags) run once per logical load, not once per caller.

**Page identifiers.** The default strips `src/pages/` and common `.tsx` / `.page.tsx` suffixes:

```
src/pages/giftcards/show.tsx       → 'giftcards/show'
src/pages/products/show.page.tsx   → 'products/show'
```

When your router exposes a different token at runtime, override:

```ts
i18nPlugin(config, {
  pages: ['admin/**/pages/*.tsx'],
  locales: ['en'],
  defaultLocale: 'en',
  pageIdentifier: (abs) =>
    abs.replace(/^.*?\/admin\//, 'admin/').replace(/\.tsx$/, ''),
})
```

Whatever your function returns becomes the key in `scope-map.json` (served at `/__i18n/scope-map.json` in dev, emitted at build under `assetsDir`) and the `I18nPageIdentifier` union in generated types. Routers that want the data without types can fetch the JSON directly.

For pure runtime access without tying into the plugin's type generation, `createScopeMapClient()` is the framework-agnostic fetcher:

```ts
import { createScopeMapClient } from 'vite-bundled-i18n'

const scopeMap = createScopeMapClient()
await scopeMap.load()
scopeMap.getSync('products/show') // ['products.show']
```

Dedupes concurrent `load()` calls, invalidation during an in-flight fetch is generation-safe, and the default URL honors the plugin-injected base path so Laravel / subdirectory deploys work without wiring.

## Readiness gate

`i18n.gate` is a framework-agnostic primitive that tracks outstanding `loadScope()` calls. Every scope load auto-registers; when all settle, the gate flips back to ready. React and Vue adapters read it directly — no consumer counter needed.

```tsx
import { GateBoundary, useGate } from 'vite-bundled-i18n/react'

// Children always mounted; fallback overlays while loading.
<GateBoundary fallback={<LoadingBar />}>
  <App />
</GateBoundary>

// Or read the state manually.
function Indicator() {
  const { ready, pendingCount } = useGate()
  if (ready) return null
  return <Spinner label={`Loading ${pendingCount} scope(s)…`} />
}
```

Vue exposes the same shape:

```ts
import { useGate } from 'vite-bundled-i18n/vue'
const { ready, pendingCount } = useGate()
```

**Breaking in v0.6.0:** `loadScope()` now auto-tracks the gate by default. Apps that kept their own readiness counters should remove them. Per-call opt-out:

```ts
await i18n.loadScope(locale, scope, { trackReadiness: false })
```

The primitive is designed to be authoritative — no feature-flag softening. See [API docs — Readiness gate](./docs/api.md#readiness-gate).

## Vue

```ts
import { createApp } from 'vue'
import { createI18nPlugin } from 'vite-bundled-i18n/vue'
import { i18n } from './i18n'

createApp(App).use(createI18nPlugin(i18n)).mount('#app')
```

```vue
<script setup lang="ts">
import { useI18n } from 'vite-bundled-i18n/vue'
const { t, ready } = useI18n('products.index')
</script>
```

## Vanilla JS

```ts
import { createI18n, getTranslations } from 'vite-bundled-i18n'

const i18n = createI18n({ /* config */ })
const translations = await getTranslations(i18n, 'products.index')
translations.get('products.index.heading')
```

## Translator API

The translator object (from `useI18n`, `getTranslations`, or `initServerI18n`):

```ts
t('products.index.heading')                         // resolve key
t('products.index.heading', 'Fallback')             // with fallback string
t('cart.total', { amount: 9.99 })                   // with interpolation
t('cart.total', { amount: 9.99 }, '{{amount}} EUR') // interpolation + fallback

translations.has('actions.save')                    // check existence
translations.tryGet('shared.ok')                    // undefined on miss (no fallback)
translations.require('shared.ok')                   // throws on miss
translations.namespace('global').get('nav.home')    // namespace-scoped access
translations.forLocale('bg').get('shared.ok')       // cross-locale lookup

t.dynamic(`status.${state}`)                        // escape hatch — loose-typed
t.dynamic(`status.${state}`, 'Unknown')             // same overloads as t()
```

`t.dynamic(key)` accepts any string, bypassing the typed `TranslationKey` union. Identical runtime to `t()` — only the type contract differs. Use for keys assembled from variables. Pair with `bundling.dynamicKeys` so declared runtime keys actually ship:

```ts
defineI18nConfig({
  localesDir: 'locales',
  bundling: {
    // Each key is injected into every route whose scope primary namespace
    // matches. Dictionary-owned keys are skipped; orphans (no matching
    // route, no dictionary) emit a build warning.
    dynamicKeys: ['status.active', 'status.pending', 'status.failed'],
  },
})
```

## Dictionaries

Dictionaries define which translations are preloaded globally (layout, nav, shared UI):

```ts
dictionaries: {
  global: {
    include: ['shared.*', 'global.*', 'actions.*'],
    exclude: ['shared.validation.*'],
    priority: 1,
    pinned: true,
  },
}
```

- `include` — key ownership patterns: `shared.*`, `checkout.summary.*`, `shared.ok`
- `exclude` — carve out sub-namespaces after include
- `priority` — higher priority claims matching keys first
- `pinned` — stays in memory, never evicted
- Dictionary bundles include **all** matching keys (the "always available" layer). Scope bundles are the per-page optimization.

## Key Tree-Shaking

Traditional i18n ships every translation key to every page. `vite-bundled-i18n` automatically removes unused keys from scope bundles at build time — the same way a JS bundler tree-shakes unused exports.

### How it works

1. **AST extraction** — the Vite plugin parses your page components and their entire import graph. Every `t('key')`, `useI18n('scope')`, `i18nKey('key')`, and configured `keyField` property is recorded.

2. **Key mapping** — extracted keys are mapped to their source namespace. `t('products.index.heading')` → namespace `products`, key path `index.heading`.

3. **Scope bundle generation** — for each route, the plugin reads the full namespace JSON file (e.g. `locales/en/products.json` with 882 keys), then **prunes it to only the keys that route's AST extraction found** (e.g. 25 keys). The remaining 857 keys are dropped from that bundle entirely.

4. **Dictionary bundles are not tree-shaken** — they include all keys matching the `include`/`exclude` patterns. Dictionaries are the "always available" layer for shared UI (nav, actions, validation). Tree-shaking only applies to scope bundles.

5. **Cross-namespace packing** (opt-in via `bundling.crossNamespacePacking: true`) — when a route references a handful of keys from a foreign namespace (e.g. `giftcards.show` uses `vendors.compact.name` once), those keys are tree-shaken and inlined into the scope bundle. One HTTP request covers everything the route needs. Keys already owned by a dictionary are skipped so the global layer isn't duplicated. Dev middleware mirrors the behavior by serving cross-namespace extras alongside each scope request, so dev and production resolve keys identically. See [API docs](./docs/api.md#bundlingcrossnamespacepacking) for the emitted shape.

### What you get

```
locales/en/products.json          →  882 keys (source file)
__i18n/en/products.index.json     →   25 keys (scope bundle for products.index page)
__i18n/en/products.show.json      →   18 keys (scope bundle for products.show page)
__i18n/en/_dict/global.json       →   86 keys (dictionary bundle — not tree-shaken)
```

The devtools drawer shows the efficiency per namespace on every page:

```
products: 25 / 882 keys used on this page — 857 keys treeshaken (97% smaller bundle)
shared:   12 / 86 keys used  — loaded via dictionary (always available)
```

### Build reports

The build generates reports that show exactly what was extracted, what's missing, and what's unused:

- `missing.json` — keys referenced in your code that don't exist in locale files
- `unused.json` — keys in locale files that no route references (candidates for removal)
- `stats.json` — per-route and per-namespace extraction statistics
- `ownership.json` — which dictionary owns which key, with collision data
- `scope-map.json` — framework-neutral `page id → { scopes, dictionaries }` index ([router integration](#router-integration))

### Edge cases

Keys that the AST extractor **cannot see** (dynamic concatenation, computed keys) won't appear in scope bundles. See the [Getting Started guide](./docs/getting-started.md#9-dynamic-keys-unsafe-patterns) for strategies to handle dynamic keys safely — typically by placing them in a dictionary instead.

## Production Output

```
__i18n/{locale}/_dict/{name}.json      — dictionary bundles (JSON)
__i18n/{locale}/{scope}.json           — scope bundles (JSON)
__i18n/scope-map.json                  — page id → scopes index
__i18n/compiled/manifest.js            — compiled module manifest
__i18n/compiled/{locale}/...           — compiled Map modules (optional)
```

Compiled mode replaces JSON parsing with `Map` lookups — faster, cacheable by the browser's module loader. Falls back to JSON automatically if compiled modules aren't available.

## Server-Side Rendering

```ts
import { initServerI18n } from 'vite-bundled-i18n/server'

const { translations, scriptTag } = await initServerI18n(config, 'products.show')
const html = renderToString(<App translations={translations} />)
// Inject scriptTag into HTML — client auto-hydrates from window.__I18N_RESOURCES__
```

React and Vue adapters detect and consume the hydrated data automatically.

## Dev Mode

Translation bundles are served via Vite middleware — no files written to disk. Types regenerate on locale file changes. The dev toolbar updates live on navigation.

**Dev toolbar behavior (v0.4.0+).** Missing-key entries are tagged with the current scope and a monotonic epoch. Navigating between pages automatically filters the "Missing Translations" panel to show only misses from the current route. Changing locale bumps the epoch so prior entries clear. HMR updates reset key-usage state automatically — editing a file doesn't leave stale misses behind.

**Sidecar setups** (Laravel serving assets from public/):

```ts
i18nPlugin(i18nConfig, {
  pages: ['src/pages/**/*.tsx'],
  locales: ['en', 'bg'],
  defaultLocale: 'en',
  dev: { emitPublicAssets: true },
})
```

## Data Files

For navigation, table columns, or config that references translation keys:

```ts
import { defineI18nData, i18nKey } from 'vite-bundled-i18n'

export const nav = defineI18nData([
  { href: '/', labelKey: i18nKey('global.nav.home') },
  { href: '/cart', labelKey: i18nKey('global.nav.cart') },
])
```

The AST extractor recognizes these helpers and includes referenced keys in scope analysis.

## Custom URL Resolution

```ts
createI18n({
  ...config,
  resolveUrl: (locale, type, name) => `/api/translations/${locale}/${type}/${name}`,
  requestInit: { credentials: 'include' },
})
```

`resolveUrl` controls WHERE to fetch. `requestInit` controls HOW (headers, credentials, cache).

## Cache

```ts
cache: {
  runtime: {
    strategy: 'memory',
    eviction: 'lru',
    maxNamespaces: 50,
    pinDictionaries: true,
  },
}
```

### Build artifacts and the build-stamp

Every successful build writes `.i18n/build-stamp.json` recording the plugin version, config hash, and an analysis fingerprint (route ids → scopes + sorted extracted keys). The next build reads this stamp and warns when:

- the extraction cache exists but no stamp does (a previous build never finished),
- the plugin version recorded in the stamp differs from the current version,
- the extraction-relevant config has changed since the stamp was written, or
- the extraction cache file is materially newer than the stamp (dev-mode edits have advanced the cache without a corresponding production build).

The warning is one line, surfaced through Vite's logger, and never blocks the build. It exists so a stale `.i18n/` is loud rather than silent.

### Troubleshooting: "a key is missing from a per-scope bundle"

After large refactors (mass `t.dynamic` migrations, sweeping renames, hook restructures), the per-file extraction cache and the downstream artifacts in `.i18n/` can drift if a build was interrupted partway through. The reliable recovery move:

```bash
npx vite-bundled-i18n clean   # rm -rf .i18n/
# then your build command, e.g.
npm run build
```

…or in one step:

```bash
npx vite-bundled-i18n rebuild --config i18n.config.json
```

If after that the key is _still_ missing, the issue is in the source — not the cache — and the bundle output reflects the truth. File a bug.

The CLI's `clean` command accepts repeatable `--extra-path` flags for project layouts that emit assets outside `.i18n/` (e.g. `--extra-path public/__i18n --extra-path public/build/__i18n`).

## ESLint plugin

`vite-bundled-i18n/eslint` ships five rules that catch the patterns the extractor cannot see — keys reached through aliases, props, member access, or runtime concatenation. Same package, optional peer dep on `eslint >= 8`, opt in via the subpath:

```ts
// eslint.config.js (flat, ESLint 9+)
import i18n from 'vite-bundled-i18n/eslint';

export default [
  i18n.flatConfigs.recommended, // four rules at 'warn'
];
```

```js
// .eslintrc.cjs (legacy, ESLint 8)
module.exports = {
  extends: ['plugin:vite-bundled-i18n/recommended'],
};
```

The rules:

| Rule | Catches |
|------|---------|
| `no-t-dynamic` | Every `t.dynamic(...)` call — escape hatch should be the exception, not the default |
| `no-non-literal-t-arg` | `t(variable)`, `t(\`tpl\`)`, `t(cond ? a : b)` — argument must be a string literal |
| `no-renamed-t` | `const { t: translate } = useI18n()` and aliases (autofixes the destructure) |
| `no-member-access-t` | `props.t(...)`, `this.i18n.t(...)`, any `<expr>.t()` — extractor only sees bare `t` |
| `t-arg-must-exist-in-types` | `t('typo.in.namespace')` — verifies the literal against your locale JSON files |

The `recommended` preset turns the first four to `warn`. The `strict` preset turns every rule to `error` AND enables `t-arg-must-exist-in-types` (with `localesDir: 'locales'`, `defaultLocale: 'en'` defaults — override per-rule if your layout differs):

```ts
import i18n from 'vite-bundled-i18n/eslint';
export default [
  i18n.flatConfigs.strict,
  // Override the locale paths if needed:
  {
    rules: {
      'vite-bundled-i18n/t-arg-must-exist-in-types': ['error', {
        localesDir: 'i18n',
        defaultLocale: 'en-US',
      }],
    },
  },
];
```

> **Parser config.** The presets carry only `plugins` and `rules` — they don't set `languageOptions`. Pair them with your existing parser config (e.g. `@typescript-eslint/parser` for TS/TSX) the same way you would for any other ESLint plugin. The presets stay parser-agnostic so they don't force an extra peer dep on consumers who already wire up their own parser.

## Strict extraction

`bundling.strictExtraction` (v0.7+) gates the build on extraction-correctness checks. Pair it with the ESLint plugin: the lint rules block the patterns at edit time; `strictExtraction` is the CI safety net for what slipped through.

```ts
defineI18nConfig({
  bundling: {
    // Shorthand: every check at the same level.
    strictExtraction: 'warn',

    // OR: object form for per-check control.
    strictExtraction: {
      mode: 'warn',
      scopeRegistration: 'error',  // page registers no useI18n('<scope>')
      missingKeys: 'error',        // t('foo.bar') references a missing locale key
      unusedKeys: 'off',           // locale key never referenced (noise on bootstrap)
      orphanDynamic: 'warn',       // dynamicKeys entry matches no route or dictionary
      // reportPath: '.i18n/strict-extraction-report.json' (default)
    },
  },
})
```

Every build writes a structured JSON report at `<generatedOutDir>/strict-extraction-report.json` regardless of severity — CI tooling can parse `findings[]` without scraping logs. Each finding records `check`, `severity`, `message`, and a free-form `details` payload (file paths, key names, etc.).

The legacy `bundling.strictScopeRegistration` field is honored as a fallback when `strictExtraction` is not set, so existing configs keep working without changes.

> **Build-time only.** `strictExtraction` runs during `vite build` and the CLI's `vite-bundled-i18n build` (and friends). `vite dev` does not run it — to keep dev startup fast and HMR latency low, no on-edit re-audit fires. Pair `strictExtraction` with the ESLint plugin to get most of the same coverage at edit time.

## Testing

Unit tests and integration tests import from `vite-bundled-i18n/testing`. `createTestI18n` returns a synchronous instance seeded with translations you supply — no network, no pending promises, gate starts ready:

```ts
import { createTestI18n, I18nTestProvider } from 'vite-bundled-i18n/testing'
import { render, screen } from '@testing-library/react'

const i18n = createTestI18n({
  translations: {
    shared: { ok: 'OK' },
    products: { show: { title: 'Details' } },
  },
})

render(
  <I18nTestProvider instance={i18n}>
    <MyComponent />
  </I18nTestProvider>,
)
```

Options:

- `locale` — default `'en'`
- `defaultLocale` — default: same as `locale`
- `supportedLocales` — default: `[locale]`
- `passthroughMissing` — default `true`. Set `false` to have missing keys throw, turning "I forgot to seed" into a hard test failure instead of a silent key-as-value.

Vue equivalent:

```ts
import { createI18nTestPlugin } from 'vite-bundled-i18n/testing'
app.use(createI18nTestPlugin(i18n))
```

## Package Entries

| Entry | Purpose |
|-------|---------|
| `vite-bundled-i18n` | Core runtime, config helpers, `createReadinessGate`, `createScopeMapClient` |
| `vite-bundled-i18n/react` | `I18nProvider`, `useI18n`, `I18nBoundary`, `GateBoundary`, `useGate`, `DevToolbar` |
| `vite-bundled-i18n/vue` | `createI18nPlugin`, `useI18n`, `useGate` |
| `vite-bundled-i18n/vanilla` | `getTranslations`, `initI18n` |
| `vite-bundled-i18n/server` | `initServerI18n` (SSR) |
| `vite-bundled-i18n/plugin` | Vite plugin (`i18nPlugin`) |
| `vite-bundled-i18n/generated` | Generated types + `PAGE_SCOPE_MAP` / `I18nPageIdentifier` |
| `vite-bundled-i18n/testing` | `createTestI18n`, `I18nTestProvider`, `createI18nTestPlugin` |
| `vite-bundled-i18n/eslint` | ESLint plugin + `recommended` / `strict` presets (5 rules) |

## Documentation

- [Getting Started](./docs/getting-started.md)
- [API Reference](./docs/api.md)
- [Architecture](./docs/architecture.md)

## Releases

Current release: **v0.7.1** — bugfix release. Dev-mode `loadScope` no longer dedupes by inferred namespace (was unsound under `bundling.dev.leanBundles: true` — the v0.6.1+ default). When two scopes share a namespace and each receives a different tree-shaken slice from the dev plugin, the second scope's load now correctly fetches and deep-merges instead of short-circuiting on namespace presence. Same fix applied to `isScopeLoaded`. Production unaffected (per-scope-id URLs avoid the collision by construction).

Built on **v0.7.0** — three loosely-related shipments:

- **Build-stamp + staleness detection.** Every successful build writes `.i18n/build-stamp.json` recording the cache mtime it observed; the next build compares against that anchor (not against the stamp file's own mtime, so multi-minute builds and dev sessions no longer look stale). Cache schema bumped v1 → v2 (one-time auto-invalidation on upgrade). New CLI commands `clean` and `rebuild` formalize the recovery path; `--extra-path` is constrained to paths inside `rootDir` unless `--allow-outside-root` is set.
- **ESLint plugin.** `vite-bundled-i18n/eslint` ships 5 rules (`no-t-dynamic`, `no-non-literal-t-arg`, `no-renamed-t`, `no-member-access-t`, `t-arg-must-exist-in-types`) with both `recommended` (warn) and `strict` (error + `t-arg-must-exist-in-types` enabled) presets. Both flat-config (ESLint 9+) and legacy (ESLint 8) shapes. Bracket-access variants (`t['dynamic']`, `props['t']`) are covered alongside dot access.
- **`bundling.strictExtraction`.** Unified extraction-correctness audit. Subsumes the legacy `strictScopeRegistration` (still honored as a fallback). Adds `missingKeys` / `unusedKeys` / `orphanDynamic` checks. Always writes a structured JSON report at `<generatedOutDir>/strict-extraction-report.json` for CI consumption. Build-time only — pair with the ESLint plugin for edit-time coverage.

Built on v0.6.2's dev/prod parity for scope-bundle filtering, v0.6.1's lean dev bundles, and v0.6.0's framework-agnostic readiness gate.

Version history lives in the [git log](https://github.com/nicolasvlachos/vite-bundled-i18n/commits/main) — each release is a `feat: v{version}` commit with a summary of the changes.

## License

[MIT](./LICENSE)
