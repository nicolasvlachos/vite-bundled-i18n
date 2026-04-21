# Getting Started

## Install

Requirements:

- Node `>=20`
- a Vite app
- `react` and `react-dom` only if you use the React adapter

```bash
npm install vite-bundled-i18n
```

If you use React:

```bash
npm install react react-dom
```

If you use Vue:

```bash
npm install vue
```

For local package testing:

```bash
# in this repo
npm run build
npm pack

# in your app
npm install /absolute/path/to/vite-bundled-i18n-<version>.tgz
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

`keys: ['shared']` is still supported, but `include` is the more explicit model.

Pattern examples:

- `shared.*`
- `checkout.summary.*`
- `global.nav.home`
- `admin*`

## 3. Vite plugin

Use the unified plugin entry:

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
      generatedOutDir: '.i18n',
      // types default to '.i18n/i18n.d.ts' — add '.i18n' to tsconfig include
    }),
  ],
})
```

In dev, it serves bundle URLs on demand.

In build, it emits:

- `__i18n/{locale}/_dict/{name}.json`
- `__i18n/{locale}/{scope}.json`
- `__i18n/compiled/manifest.js`
- compiled map modules under `__i18n/compiled`

`i18nPlugin()` is the primary entry. It wraps the dev and build plugin paths so
the bundle model stays aligned across environments.

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

Compiled mode can also be forced or customized:

```ts
createI18n({
  ...config,
  compiled: {
    enabled: 'auto',
  },
})
```

## 5. React provider

```tsx
import { createRoot } from 'react-dom/client'
import { I18nProvider } from 'vite-bundled-i18n/react'
import { i18n } from './i18n'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <I18nProvider instance={i18n}>
    <App />
  </I18nProvider>,
)
```

## 6. React usage

Without a scope:

```tsx
import { useI18n } from 'vite-bundled-i18n/react'

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

With a scope:

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

## 6.5. Vue usage

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

In components:

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

## 7. Non-React usage

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

In React, registration happens through `<I18nProvider>`.
Outside React, call `setGlobalInstance(instance)` or use the translator object directly.

## 8. Data files

Use keys in data, not translated strings at module definition time:

```ts
import { defineI18nData, i18nKey } from 'vite-bundled-i18n'

export const nav = defineI18nData([
  { href: '/', labelKey: i18nKey('global.nav.home') },
  { href: '/products', labelKey: i18nKey('global.nav.products') },
])
```

Then resolve later:

```tsx
const { t } = useI18n()
nav.map((item) => <a key={item.href}>{t(item.labelKey)}</a>)
```

Avoid eager module-top-level translation:

```ts
// Avoid
export const nav = [{ label: t('global.nav.home') }]
```

## 9. Generated types

`npm run dev`, `vite build`, and the CLI all write `.i18n/i18n.d.ts`.

That gives you:

- key autocomplete
- invalid key errors
- placeholder checking

```ts
translations.get('products.show.price', { amount: 29.99 })
```

This type-checks.

```ts
translations.get('products.show.price')
```

This should fail when generated placeholder metadata exists.

## 10. Reports

The build pipeline writes:

- `manifest.json`
- `missing.json`
- `unused.json`
- `stats.json`
- `overlap.json`
- `ownership.json`

`ownership.json` explains dictionary ownership, collisions, and unowned keys.

## 10.5 Cache

The runtime cache is namespace-based, not leaf-string based.

Example:

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

## Framework Integration (Laravel, Rails, Django)

If your framework serves built assets under a URL prefix (e.g. `/build/`), set Vite's `base` option:

```ts
// vite.config.ts
export default defineConfig({
  base: '/build/',
  plugins: [
    i18nPlugin(i18nConfig, { /* ... */ }),
  ],
})
```

The i18n runtime reads the base path at build time automatically. No additional configuration needed.

For non-standard setups (CDN, reverse proxy), use the `publicBase` override on the runtime instance:

```ts
const i18n = createI18n({
  ...i18nConfig,
  publicBase: 'https://cdn.example.com/__i18n',
})
```

## Compiled Mode vs JSON Mode

The build emits two formats for every bundle:

| Format | File | Loading | Use when |
|--------|------|---------|----------|
| Compiled JS | `__i18n/compiled/{locale}/_dict/global.js` | Dynamic `import()` | Default for production. Faster parsing, cacheable by bundler. |
| JSON | `__i18n/{locale}/_dict/global.json` | `fetch()` | Fallback. Works anywhere, no JS parser needed. |

**Runtime behavior:**
1. Tries compiled manifest first (`import()`)
2. If compiled mode fails or is disabled, falls back to JSON (`fetch()`)

**To disable compiled mode** (reduce build output):

```ts
i18nPlugin(i18nConfig, {
  emitCompiled: false, // only emit JSON bundles
})
```

**To force JSON mode at runtime:**

```ts
const i18n = createI18n({
  ...config,
  compiled: { enabled: false },
})
```

**When to use which:**
- **Compiled (default):** Best for SPAs. Modules are code-split and cached by the browser's module loader.
- **JSON only:** Best for SSR, edge workers, or environments without ES module support. Also useful to reduce total build output size.

## Type Generation

Types are generated from locale JSON files during `vite build` and `npm run i18n -- generate`.

The Vite dev plugin re-generates types automatically when locale JSON files change during `npm run dev`.

If you modify translation files outside of dev mode, re-run manually:

```bash
npm run i18n -- generate
```

### Locale Directory Structure

The plugin expects one flat JSON file per namespace:

```
locales/
  en/
    shared.json      ← namespace "shared"
    products.json    ← namespace "products"
  bg/
    shared.json
    products.json
```

Subdirectories within a locale folder are not supported. Each `{namespace}.json` file contains the nested keys for that namespace.

## 11. SSR

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
<I18nProvider instance={i18n}>
  <App />
</I18nProvider>
```

Client (Vue):

```ts
app.use(createI18nPlugin(i18n))
```

Both adapters automatically detect `window.__I18N_RESOURCES__` injected by the server's `scriptTag` and hydrate without any extra props or configuration.

For vanilla JS hydration, `serverResources` is still supported:

```ts
import { initI18n } from 'vite-bundled-i18n/vanilla'

const i18n = await initI18n(config, {
  serverResources: resources,
})
```

## 12. Package Entries

Available imports:

- `vite-bundled-i18n`
- `vite-bundled-i18n/react`
- `vite-bundled-i18n/vanilla`
- `vite-bundled-i18n/vue`
- `vite-bundled-i18n/server`
- `vite-bundled-i18n/plugin`
