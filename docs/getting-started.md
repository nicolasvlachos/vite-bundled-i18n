# Getting Started

`vite-bundled-i18n` treats translations as **code dependencies**, not global runtime data. The Vite plugin walks your page components at build time, extracts every translation key each route uses via AST analysis, and emits scope-matched bundles. Each page ships only the translations it needs — the rest are tree-shaken and never sent to the client.

## Install

Requirements:

- Node `>=20`
- a Vite app
- `react` and `react-dom` if you use the React adapter
- `vue` if you use the Vue adapter

```bash
npm install vite-bundled-i18n
```

For React:

```bash
npm install react react-dom
```

For Vue:

```bash
npm install vue
```

## 1. Translation files

Each JSON file is a namespace.

```text
locales/
  en/
    shared.json
    global.json
    actions.json
    products.json
  bg/
    shared.json
    global.json
    actions.json
    products.json
```

```json
// locales/en/products.json
{
  "index": {
    "heading": "All Products",
    "subheading": "Browse {{count}} items"
  },
  "show": {
    "title": "Product Details",
    "price": "Price: {{amount}}"
  }
}
```

Keys are fully qualified:

- `shared.ok`
- `products.index.heading`
- `products.show.price`

## 2. Shared config

```ts
// src/i18n.config.ts
import { defineI18nConfig } from 'vite-bundled-i18n'

export const i18nConfig = defineI18nConfig({
  localesDir: 'locales',
  dictionaries: {
    global: {
      include: ['shared.*', 'global.*', 'actions.*'],
      priority: 1,
      pinned: true,
    },
  },
})
```

Pattern examples:

- `shared.*`
- `checkout.summary.*`
- `global.nav.home`
- `admin*`

## 3. Vite plugin

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

`i18nPlugin` takes two arguments: the shared config and plugin-specific options. In dev it serves bundle URLs on demand via Vite middleware. In build it emits:

- `__i18n/{locale}/_dict/{name}.json`
- `__i18n/{locale}/{scope}.json`
- `__i18n/compiled/manifest.js`
- compiled map modules under `__i18n/compiled`

**Devtools:** Pass `dev: { devBar: true }` to show the translation drawer during development. It displays per-page key usage, bundle efficiency, and missing translations without any server round-trips:

```ts
i18nPlugin(i18nConfig, {
  pages: ['src/pages/**/*.tsx'],
  locales: ['en', 'bg'],
  defaultLocale: 'en',
  dev: { devBar: true },
})
```

**Sidecar setups** (e.g. Laravel serving assets from `public/`):

```ts
i18nPlugin(i18nConfig, {
  pages: ['src/pages/**/*.tsx'],
  locales: ['en', 'bg'],
  defaultLocale: 'en',
  dev: { emitPublicAssets: true },
})
```

## 4. Runtime instance

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
  requestInit: { credentials: 'include' },
  cache: {
    runtime: {
      strategy: 'memory',
      eviction: 'lru',
      maxNamespaces: 50,
      pinDictionaries: true,
    },
  },
})
```

## 5. TypeScript — enable autocomplete

Add to your `tsconfig.json`:

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

Types are generated automatically during `npm run dev` and `npm run build`. They give you key autocomplete, invalid key errors, and placeholder checking.

## 6. React integration

Wrap your app with `I18nProvider`. It blocks rendering until dictionaries are loaded:

```tsx
// src/main.tsx
import { createRoot } from 'react-dom/client'
import { I18nProvider } from 'vite-bundled-i18n/react'
import { i18n } from './i18n'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <I18nProvider instance={i18n} fallback={<div>Loading translations...</div>}>
    <App />
  </I18nProvider>,
)
```

In page components, call `useI18n(scope)` to load the scope bundle for that route:

```tsx
import { useI18n } from 'vite-bundled-i18n/react'

function ProductsPage() {
  const { t, translations, ready } = useI18n('products.index')

  if (!ready) return <div>{t('shared.loading', 'Loading...')}</div>

  return (
    <section>
      <h1>{translations.get('products.index.heading', 'All Products')}</h1>
      <p>{t('products.index.subheading', { count: 24 }, 'Browse {{count}} items')}</p>
    </section>
  )
}
```

`useI18n(scope)` triggers one HTTP request to load the scope bundle. Dictionaries are always available. Previously visited scopes are instant (cached).

Use `I18nBoundary` to avoid early returns in components that need a scope:

```tsx
import { I18nBoundary } from 'vite-bundled-i18n/react'

<I18nBoundary scope="products.index" fallback={<Spinner />}>
  <ProductsPage />
</I18nBoundary>
```

For layout and shared UI that only use dictionary keys (no scope needed):

```tsx
function Header() {
  const { t, translations } = useI18n()

  return (
    <header>
      <strong>{t('global.appName', 'Store')}</strong>
      <nav>{translations.namespace('global').get('nav.home', 'Home')}</nav>
    </header>
  )
}
```

## 6.5. Vue integration

Register the plugin on your Vue app:

```ts
// src/main.ts
import { createApp } from 'vue'
import { createI18nPlugin } from 'vite-bundled-i18n/vue'
import { i18n } from './i18n'
import App from './App.vue'

const app = createApp(App)
app.use(createI18nPlugin(i18n))
app.mount('#app')
```

In components, use the `useI18n` composable:

```vue
<script setup lang="ts">
import { useI18n } from 'vite-bundled-i18n/vue'

const { t, ready } = useI18n('products.index')
</script>

<template>
  <div v-if="!ready">Loading...</div>
  <section v-else>
    <h1>{{ t('products.index.heading', 'All Products') }}</h1>
  </section>
</template>
```

## 7. Vanilla JS

```ts
import { getTranslations } from 'vite-bundled-i18n'

const translations = await getTranslations(i18n, 'products.index')
translations.get('products.index.heading')
translations.namespace('global').get('nav.home')
```

Global access also works after the instance is registered:

```ts
import { t, getGlobalTranslations } from 'vite-bundled-i18n'

t('shared.ok')
getGlobalTranslations().tryGet('products.show.title')
```

In React, registration happens through `<I18nProvider>`. Outside React, call `setGlobalInstance(instance)` or use the translator object directly.

## 8. Data files

Use keys in data, not translated strings at module definition time:

```ts
import { defineI18nData, i18nKey } from 'vite-bundled-i18n'

export const nav = defineI18nData([
  { href: '/', labelKey: i18nKey('global.nav.home') },
  { href: '/products', labelKey: i18nKey('global.nav.products') },
])
```

Then resolve at render time:

```tsx
const { t } = useI18n()
nav.map((item) => <a key={item.href}>{t(item.labelKey)}</a>)
```

Avoid eager module-top-level translation:

```ts
// Avoid
export const nav = [{ label: t('global.nav.home') }]
```

## 9. Dynamic keys (unsafe patterns)

The AST extractor works with **static string literals**. It cannot analyze dynamic keys — these are invisible at build time and will be missing from scope bundles.

### What works (static — extracted at build time)

```ts
t('products.index.heading')                    // ✅ literal string
t('shared.actions.save')                       // ✅ literal string
i18nKey('global.nav.home')                     // ✅ recognized helper
const key = 'products.show.title' as const     // ✅ const assertion
```

### What doesn't work (dynamic — invisible to the extractor)

```ts
// ❌ Concatenated keys — extractor sees nothing
t(`products.${page}.title`)
t('products.' + action + '.label')

// ❌ Variable keys — not a string literal
const key = getKeyFromApi()
t(key)

// ❌ Computed from loops
items.forEach(item => t(`items.${item.type}.name`))
```

### How to handle dynamic keys safely

**Option 1: Use dictionaries.** Put dynamic-range keys in a dictionary so they're always available:

```ts
// i18n.config.ts — all items.* keys are in the global dictionary
dictionaries: {
  global: {
    include: ['shared.*', 'items.*'],
    pinned: true,
  },
}
```

Now `t('items.weapon.name')` works even though the extractor can't see which `item.type` values exist — the entire `items.*` namespace is preloaded.

**Option 2: Enumerate the possible keys.** If the set is known, list them so the extractor finds them:

```ts
// ✅ All possible keys are visible as string literals
const STATUS_KEYS = {
  active: 'users.status.active',
  inactive: 'users.status.inactive',
  pending: 'users.status.pending',
} as const

function StatusBadge({ status }: { status: keyof typeof STATUS_KEYS }) {
  const { t } = useI18n('users.index')
  return <span>{t(STATUS_KEYS[status])}</span>
}
```

**Option 3: Use `defineI18nData` for data-driven keys:**

```ts
import { defineI18nData, i18nKey } from 'vite-bundled-i18n'

export const columns = defineI18nData([
  { field: 'name', label: i18nKey('products.table.name') },
  { field: 'price', label: i18nKey('products.table.price') },
  { field: 'stock', label: i18nKey('products.table.stock') },
])
```

**Option 4: Configure `keyFields` for object property extraction:**

```ts
// i18n.config.ts
defineI18nConfig({
  localesDir: 'locales',
  extraction: {
    keyFields: ['label', 'title', 'placeholder', 'message'],
  },
})
```

Now the extractor recognizes translation keys in any object literal with those property names:

```ts
// ✅ These keys will be extracted automatically
const columns = [
  { label: 'products.table.name', field: 'name' },
  { title: 'products.table.price', field: 'price' },
]
```

### The rule of thumb

If the extractor can see the key as a string literal at build time, it works. If the key is computed at runtime, use a dictionary to ensure availability.

## 10. Loading strategies

### Strategy 1: Scope-per-page (default, recommended)

Each page loads one scope bundle on mount. Best for large apps with many pages.

```tsx
// Each page declares its scope — one fetch per page
function ProductsPage() {
  const { t, ready } = useI18n('products.index')
  // ...
}

function CartPage() {
  const { t, ready } = useI18n('cart')
  // ...
}
```

**Tradeoff:** First visit to each page has a small loading delay. Subsequent visits are instant (cached).

### Strategy 2: Eager preload (small apps)

Preload all scopes upfront. Best for apps with <10 pages where total translation size is small.

```tsx
<I18nProvider
  instance={i18n}
  fallback={<Spinner />}
  preloadScopes={['products.index', 'cart', 'account', 'settings']}
>
  <App />
</I18nProvider>
```

**Tradeoff:** Larger initial load, but zero delay on navigation.

### Strategy 3: Dictionary-heavy (admin panels)

Put most keys in dictionaries. Use scopes only for very large page-specific namespaces.

```ts
dictionaries: {
  global: {
    include: ['shared.*', 'global.*', 'actions.*', 'validation.*'],
    pinned: true,
  },
  admin: {
    include: ['admin.*', 'users.*', 'roles.*', 'settings.*'],
    pinned: true,
  },
}
```

**Tradeoff:** Larger dictionary bundle, but almost everything is available immediately.

### Strategy 4: SSR hydration (zero client loading)

Inject translations server-side so critical-path UI renders without any client fetch:

```ts
// Server
const { translations, scriptTag } = await initServerI18n(config, 'products.show')
// Inject scriptTag into HTML
```

```tsx
// Client — I18nProvider auto-detects window.__I18N_RESOURCES__
<I18nProvider instance={i18n}>
  <App />
</I18nProvider>
```

**Tradeoff:** Requires server integration. Best for SEO-critical pages.

### Strategy 5: Inertia.js / Laravel shared props

Inject dictionary data via Inertia shared props so the provider starts with cached data:

```tsx
const { locale, resources } = usePage().props.i18nResources
for (const [namespace, data] of Object.entries(resources)) {
  i18n.addResources(locale, namespace, data)
}

<I18nProvider instance={i18n} serverDictionaries={['global']}>
  <App />
</I18nProvider>
```

## 11. Compiled mode vs JSON mode

The build emits two formats for every bundle. The runtime tries compiled first, falls back to JSON.

### JSON mode (fetch)

```
__i18n/en/_dict/global.json     →  fetch() → JSON.parse() → nested object
__i18n/en/products.index.json   →  fetch() → JSON.parse() → nested object
```

- Works everywhere (SSR, edge workers, no ES module support needed)
- Simpler debugging (inspect network responses directly)
- Slightly slower: JSON.parse + object traversal per lookup

### Compiled mode (import)

```
__i18n/compiled/manifest.js     →  import() → Map<string, string>
__i18n/compiled/en/_dict/global.js → import() → flat Map
```

- O(1) key lookups (flat `Map.get()`, no dot-path traversal)
- Browser caches modules natively (304 responses, disk cache)
- Code-split by the bundler like any other JS module
- Falls back to JSON automatically if module loading fails

### Controlling the mode

```ts
// Build: disable compiled output entirely (JSON only)
i18nPlugin(i18nConfig, {
  emitCompiled: false,
})

// Runtime: force JSON mode even if compiled modules exist
createI18n({
  ...config,
  compiled: { enabled: false },
})

// Runtime: force compiled mode
createI18n({
  ...config,
  compiled: { enabled: true, manifestUrl: '/assets/__i18n/compiled/manifest.js' },
})

// Runtime: auto (default) — use compiled if the build injected a manifest URL
createI18n({
  ...config,
  compiled: { enabled: 'auto' },
})
```

### When to use which

| Scenario | Recommended mode |
|----------|-----------------|
| SPA (React, Vue) | Compiled (default) — best performance |
| SSR / Node.js | JSON — no ES module loader needed |
| Edge workers (Cloudflare) | JSON — simpler runtime |
| Large translation files | Compiled — avoids JSON.parse overhead |
| Debugging translations | JSON — inspectable in network tab |

## 12. Build reports

The build pipeline writes:

- `manifest.json`
- `missing.json`
- `unused.json`
- `stats.json`
- `overlap.json`
- `ownership.json`

`ownership.json` explains dictionary ownership, collisions, and unowned keys.

## 13. Cache

The runtime cache is namespace-based, not leaf-string based.

```ts
cache: {
  runtime: {
    strategy: 'memory',
    eviction: 'lru',
    maxLocales: 2,
    maxNamespaces: 50,
    maxBytes: 250_000,
    pinDictionaries: true,
  },
}
```

Useful instance APIs:

- `getCacheStats()`
- `unloadLocale(locale)`
- `unloadNamespace(locale, namespace)`
- `evictUnused()`

## 14. SSR

Server:

```ts
import { initServerI18n } from 'vite-bundled-i18n/server'

const { translations, scriptTag } = await initServerI18n(
  {
    ...i18nConfig,
    localesDir: '/locales',
    locale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'bg'],
  },
  'products.show',
)

const html = renderToString(<App translations={translations} />)
// Inject scriptTag into HTML <head> or <body>
```

Client (React):

```tsx
<I18nProvider instance={i18n} fallback={null}>
  <App />
</I18nProvider>
```

Client (Vue):

```ts
app.use(createI18nPlugin(i18n))
```

Both adapters automatically detect `window.__I18N_RESOURCES__` injected by the server's `scriptTag` and hydrate without any extra configuration.

## 15. Package entries

| Entry | Purpose |
|-------|---------|
| `vite-bundled-i18n` | Core runtime, config helpers, type utilities |
| `vite-bundled-i18n/react` | `I18nProvider`, `useI18n`, `I18nBoundary`, `DevToolbar` |
| `vite-bundled-i18n/vue` | `createI18nPlugin`, `useI18n` |
| `vite-bundled-i18n/vanilla` | `getTranslations`, `initI18n` |
| `vite-bundled-i18n/server` | `initServerI18n` (SSR) |
| `vite-bundled-i18n/plugin` | Vite plugin (`i18nPlugin`) |
