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
- **Cross-namespace packing** (opt-in) — inline a route's cross-namespace keys, tree-shaken, into its scope bundle. 1–3 foreign keys don't force a whole dictionary to load globally
- **Persistent extraction cache** — per-file AST results survive between runs. Warm dev starts in ~250 ms instead of 3–10 s; repeat builds skip the walk when nothing changed
- **Progressive autocomplete** — generated types let the IDE suggest one key segment at a time

### Also included

- **Dictionary ownership** — named dictionaries claim keys by `include` / `exclude` / `priority`, pinned in memory
- **Placeholder validation** — `t('cart.total', { amount })` is type-checked against `{{amount}}` in the JSON
- **Compiled mode** — optional `Map`-based modules for O(1) lookups without JSON parsing
- **Multi-framework** — React, Vue, vanilla JS share a single core
- **SSR** — server rendering with automatic client hydration via `window.__I18N_RESOURCES__`
- **AST extraction** — `t()`, `useI18n()`, `i18nKey()`, `defineI18nData()`, configurable `keyFields`, `as const` objects, string enums, helper functions that receive `t` as a parameter
- **Dev toolbar** — scope-aware missing-key panel (filters by current route, resets on locale change and HMR), per-namespace bundle efficiency, live updates on navigation

## Performance

The library is a performance play end-to-end. Representative numbers for a 50-page admin panel with 3,000 translation keys:

| | Traditional i18n | vite-bundled-i18n |
|---|---|---|
| Keys per page load | 3,000 (all) | 25–40 (route-extracted) |
| Bundle size per scope | N/A (monolithic) | ~97% smaller than the source namespace |
| HTTP requests per route | many (or one huge) | 1 scope bundle + cached dictionaries |
| Cold dev start | — | ~200 ms |
| Warm dev start | — | ~250 ms (extraction cache keeps prior AST parses) |
| Repeat `vite build`, unchanged code | full walk | near-zero parse (cache-hit, stat-only) |
| HMR key edit → browser refetch | full re-walk | ~30 ms (surgical cache update) |
| Compiled-mode `t('key')` | JSON parse + path traversal | O(1) `Map.get` |

The extraction cache persists to `.i18n/cache/` and auto-invalidates on plugin upgrade, config change, or Node major version change. Disable with `cache: false` or `VITE_I18N_NO_CACHE=1`. See [API docs — Extraction cache](./docs/api.md#extraction-cache-cache).

Compiled mode replaces JSON parsing with pre-resolved flat `Map` modules. Faster than JSON at the browser level (no parse on first lookup), smaller gzipped (shared string pool), cacheable by the browser's module loader. Falls back to JSON automatically when compiled modules aren't available.

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

Calling `loadScope` is safe from concurrent paths. The runtime deduplicates by `(locale, scope)` — 100 parallel calls fire exactly one fetch, share the same promise, and resolve together. On fetch failure the in-flight entry clears, so a retry starts fresh. Side effects (cache writes, devbar state, dependent scope flags) run once per logical load, not once per caller.

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

## Package Entries

| Entry | Purpose |
|-------|---------|
| `vite-bundled-i18n` | Core runtime, config helpers, type utilities |
| `vite-bundled-i18n/react` | `I18nProvider`, `useI18n`, `I18nBoundary`, `DevToolbar` |
| `vite-bundled-i18n/vue` | `createI18nPlugin`, `useI18n` |
| `vite-bundled-i18n/vanilla` | `getTranslations`, `initI18n` |
| `vite-bundled-i18n/server` | `initServerI18n` (SSR) |
| `vite-bundled-i18n/plugin` | Vite plugin (`i18nPlugin`) |
| `vite-bundled-i18n/generated` | Generated types + `PAGE_SCOPE_MAP` / `I18nPageIdentifier` |

## Documentation

- [Getting Started](./docs/getting-started.md)
- [API Reference](./docs/api.md)
- [Architecture](./docs/architecture.md)

## Releases

Current release: **v0.5.0** — persistent extraction cache, framework-neutral page scope map, typed `PAGE_SCOPE_MAP`, `loadScope` concurrency guarantees.

Version history lives in the [git log](https://github.com/nicolasvlachos/vite-bundled-i18n/commits/main) — each release is a `feat: v{version}` commit with a summary of the changes.

## License

[MIT](./LICENSE)
