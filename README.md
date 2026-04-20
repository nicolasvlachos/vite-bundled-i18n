# vite-bundled-i18n

Route-aware internationalization for Vite. Each page loads only the translations it uses. Keys are fully typed. Production builds emit static, scope-matched bundles.

```bash
npm i vite-bundled-i18n
```

Requires Node `>=20` and Vite. React, Vue, and vanilla adapters are included — framework peer dependencies are optional.

## Features

- **Scope bundles** — translations grouped by route (`products.index`) and loaded on demand
- **Dictionary ownership** — named dictionaries claim keys by pattern with explicit priority
- **Type generation** — TypeScript types for every key and placeholder, generated from source
- **Compiled production output** — Vite plugin emits `__i18n/` assets as static JSON or compiled modules
- **Multi-framework** — React, Vue, and vanilla JS share a single core
- **SSR** — server-side rendering with automatic client hydration
- **AST extraction** — finds translation keys in source without execution

## Setup

Three files wire everything together: a config that declares your locale directory and dictionaries (bundles that group related keys under a name, like `global` for shared UI strings), a runtime instance that holds locale state, and a Vite plugin that handles extraction, type generation, and bundle emission.

```ts
// src/i18n.config.ts — declares dictionaries and where locale JSON files live
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
// src/i18n.ts — runtime instance used by adapters and server code
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
// vite.config.ts — plugin scans pages, extracts keys, emits bundles and types
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

### React

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
  // t and translations.get are interchangeable — t is a shorthand alias.
  // Both accept a key, optional placeholders, and an optional fallback string.
  const { t, translations, ready } = useI18n('products.index')

  if (!ready) return <div>{t('shared.loading', 'Loading...')}</div>

  return (
    <section>
      <h1>{t('products.index.heading', 'All Products')}</h1>
      <p>{t('products.index.subheading', { count: 24 }, 'Browse {{count}} items')}</p>
    </section>
  )
}
```

### Vue

```ts
import { createApp } from 'vue'
import { createI18nPlugin } from 'vite-bundled-i18n/vue'
import { i18n } from './i18n'

const app = createApp(App)
app.use(createI18nPlugin(i18n))
app.mount('#app')
```

## API

The translator object returned by `useI18n` (React), `useI18n` (Vue), or `getTranslations` (vanilla):

```ts
const translations = await getTranslations(i18n, 'products.index')

translations.t('products.index.heading')
translations.get('products.show.price', { amount: 29.99 })
translations.tryGet('shared.ok')
translations.has('actions.save')
translations.namespace('global').get('nav.home')
```

### Package Entries

| Entry | Purpose |
|-------|---------|
| `vite-bundled-i18n` | Core runtime and configuration |
| `vite-bundled-i18n/react` | React adapter (`I18nProvider`, `useI18n`) |
| `vite-bundled-i18n/vue` | Vue adapter (`createI18nPlugin`, `useI18n`) |
| `vite-bundled-i18n/vanilla` | Framework-agnostic `getTranslations` |
| `vite-bundled-i18n/server` | SSR utilities (`initServerI18n`) |
| `vite-bundled-i18n/plugin` | Vite build plugin |

## Dictionaries

Dictionaries define key ownership — which translation keys belong to which bundle:

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

- `include` accepts exact keys, namespace wildcards, and prefix patterns
- Higher priority dictionaries claim keys first; lower priority dictionaries exclude already-owned keys
- Pinned dictionaries remain in memory and are never evicted

## Data Files

For configuration or navigation data that references translation keys, use the extraction helpers:

```ts
import { defineI18nData, i18nKey } from 'vite-bundled-i18n'

export const nav = defineI18nData([
  { href: '/', labelKey: i18nKey('global.nav.home') },
  { href: '/cart', labelKey: i18nKey('global.nav.cart') },
])
```

The AST extractor recognizes these helpers and includes referenced keys in scope analysis.

## Server-Side Rendering

```ts
import { initServerI18n } from 'vite-bundled-i18n/server'

const { translations, scriptTag } = await initServerI18n(config, 'products.show')
const html = renderToString(<App translations={translations} />)
// Inject scriptTag into the HTML response
```

The React `I18nProvider` and Vue `createI18nPlugin` automatically detect and consume the injected `window.__I18N_RESOURCES__` on the client.

## Production Output

During `vite build`, the plugin emits:

```
__i18n/{locale}/_dict/{name}.json
__i18n/{locale}/{scope}.json
__i18n/compiled/manifest.js
__i18n/compiled/{locale}/...
```

The runtime resolves these assets automatically in production — no additional configuration required.

## Fetch Options

Configure request behavior for translation loading:

```ts
createI18n({
  ...config,
  requestInit: { credentials: 'include' },
})
```

Accepts a static `RequestInit` object, a sync function, or an async function for dynamic auth tokens.

## Cache

In-memory translation cache with configurable eviction:

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

## Documentation

- [Getting Started](./docs/getting-started.md)
- [API Reference](./docs/api.md)
- [Architecture](./docs/architecture.md)
- [Examples](./docs/examples.md)

## License

[MIT](./LICENSE)
