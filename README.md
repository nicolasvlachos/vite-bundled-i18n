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

**Three layers:**

1. **Build-time analysis** — AST extractor walks your import graph, finds every `t()`, `useI18n()`, `i18nKey()` call, and maps keys to routes. No code execution needed.
2. **Bundle generation** — keys are grouped into scope bundles (per-page) and dictionary bundles (shared/global). Each bundle is a static JSON asset or compiled JS module.
3. **Thin runtime** — minimal `t()` function that loads the right bundle on demand. React, Vue, and vanilla adapters are ~50 lines each.

## Features

- **Scope bundles** — each route loads only its own translations, one HTTP request
- **Dictionary ownership** — named dictionaries claim keys by pattern (`include`/`exclude`/`priority`)
- **Progressive autocomplete** — generated types let the IDE suggest one key segment at a time
- **Placeholder validation** — `t('cart.total', { amount: 9.99 })` is type-checked against `{{amount}}` in the JSON
- **Compiled production mode** — optional `Map`-based modules for O(1) lookups without JSON parsing
- **Multi-framework** — React, Vue, and vanilla JS share a single core
- **SSR** — server-side rendering with automatic client hydration via `window.__I18N_RESOURCES__`
- **AST extraction** — finds keys in `t()`, `useI18n()`, `i18nKey()`, `defineI18nData()`, configurable `keyFields`, `as const` objects, string enums, and helper functions that receive `t` as a parameter
- **Dev toolbar** — dark-mode drawer showing per-page key usage, bundle efficiency (keys used vs loaded), missing translations, and namespace residency

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

### Edge cases

Keys that the AST extractor **cannot see** (dynamic concatenation, computed keys) won't appear in scope bundles. See the [Getting Started guide](./docs/getting-started.md#9-dynamic-keys-unsafe-patterns) for strategies to handle dynamic keys safely — typically by placing them in a dictionary instead.

## Production Output

```
__i18n/{locale}/_dict/{name}.json      — dictionary bundles (JSON)
__i18n/{locale}/{scope}.json           — scope bundles (JSON)
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

For sidecar setups (Laravel serving assets from public/):

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

## Documentation

- [Getting Started](./docs/getting-started.md)
- [API Reference](./docs/api.md)
- [Architecture](./docs/architecture.md)

## License

[MIT](./LICENSE)
