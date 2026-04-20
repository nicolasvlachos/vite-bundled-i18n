# vite-bundled-i18n

Route-aware i18n for Vite apps.

It gives you:

- one translator API across React and non-React code
- named dictionaries with ownership and priority
- scope bundles for pages like `products.index`
- generated key and placeholder types
- production `__i18n/...` assets emitted by Vite
- optional compiled-map runtime loading in production

## Install

Requirements:

- Node `>=20`
- a Vite app for plugin/build integration
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

For local package validation:

```bash
# in this repo
npm run build
npm pack

# in your app
npm install /absolute/path/to/vite-bundled-i18n-0.1.0.tgz
```

## Quick Start

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
      typesOutPath: 'src/i18n-types.d.ts',
    }),
  ],
})
```

```tsx
// src/main.tsx
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

```tsx
import { useI18n } from 'vite-bundled-i18n/react'

export function ProductsPage() {
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

### Vue Quick Start

```ts
import { createApp } from 'vue'
import { createI18nPlugin } from 'vite-bundled-i18n/vue'
import { i18n } from './i18n'

const app = createApp(App)
app.use(createI18nPlugin(i18n))
app.mount('#app')
```

## Public API Shape

The main API is the translator object:

```ts
const translations = await getTranslations(i18n, 'products.index')

translations.t('products.index.heading')
translations.get('products.show.price', { amount: 29.99 })
translations.tryGet('shared.ok')
translations.has('actions.save')
translations.namespace('global').get('nav.home')
```

React returns the same shape plus top-level aliases:

```ts
const { t, get, has, tryGet, require, translations, ready, locale } = useI18n()
```

Package entries:

- `vite-bundled-i18n`
- `vite-bundled-i18n/react`
- `vite-bundled-i18n/vanilla`
- `vite-bundled-i18n/vue`
- `vite-bundled-i18n/server`
- `vite-bundled-i18n/plugin`

## Data Files

For data/config code, keep keys in data and resolve later:

```ts
import { defineI18nData, i18nKey } from 'vite-bundled-i18n'

export const nav = defineI18nData([
  { href: '/', labelKey: i18nKey('global.nav.home') },
  { href: '/cart', labelKey: i18nKey('global.nav.cart') },
])
```

The extractor understands these helpers.

Avoid module-top-level eager translation:

```ts
// Avoid
export const nav = [{ label: t('global.nav.home') }]
```

Store keys in data and resolve them later.

## Dictionaries

Dictionaries are key-ownership rules, not component-file ownership rules:

```ts
dictionaries: {
  global: {
    include: ['shared.*', 'global.*', 'actions.*'],
    priority: 1,
    pinned: true,
  },
  admin: {
    include: ['admin.*'],
    priority: 10,
  },
}
```

Notes:

- `include` supports exact keys, namespace wildcards, and prefix patterns
- higher priority dictionaries claim keys first
- lower priority dictionaries exclude already-owned keys
- legacy `keys: ['shared']` is still supported

## Server / SSR

```ts
import { initServerI18n } from 'vite-bundled-i18n/server'

const { translations, scriptTag } = await initServerI18n(config, 'products.show')
const html = renderToString(<App translations={translations} />)
// Inject scriptTag into HTML
```

On the client, both `I18nProvider` (React) and `createI18nPlugin` (Vue) automatically detect and consume `window.__I18N_RESOURCES__` — no manual wiring needed.

## Production Output

During `vite build`, the plugin emits:

- `__i18n/{locale}/_dict/{name}.json`
- `__i18n/{locale}/{scope}.json`
- `__i18n/compiled/manifest.js`
- `__i18n/compiled/{locale}/...` compiled map modules

The runtime can use emitted JSON bundles or the compiled manifest path automatically in production.

## Fetch Options

Configure `requestInit` on `createI18n()` to set headers, credentials, or cache mode:

```ts
createI18n({
  ...config,
  requestInit: { credentials: 'include' },
})
```

Supports static objects, sync functions, and async functions for dynamic auth tokens.

## Cache

The runtime stores translations in memory by namespace.

- dictionaries can be pinned
- repeated scope and dictionary loads are deduplicated
- non-pinned namespaces can be evicted with LRU policy
- fallback locale lookup still applies

Example:

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

## Release Flow

Recommended local release sequence:

```bash
npm run lint
npm test
npm run build
npm pack
```

Publish:

```bash
npm publish
```

## Docs

- [Getting Started](./docs/getting-started.md)
- [API Reference](./docs/api.md)
- [Architecture](./docs/architecture.md)
- [Examples](./docs/examples.md)

## Repo Demo

The root Vite app in `src/` is also the reference demo for this package.

Run:

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

That emits the demo app to `demo-dist/` and the generated translation assets to `demo-dist/__i18n/`.
