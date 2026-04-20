# Examples

Install in another app:

```bash
npm install vite-bundled-i18n
```

For local package validation:

```bash
# in this repo
npm run build
npm pack

# in your app
npm install /absolute/path/to/vite-bundled-i18n-0.1.0.tgz
```

## Demo App In This Repo

The root app in `src/` is the canonical example.

It shows:

- named dictionary loading through `global`
- page scopes for:
  - `products.index`
  - `cart`
  - `account`
- locale switching
- dev toolbar usage
- route-aware bundle generation through the Vite plugin

Key files:

- `src/i18n.config.ts`
- `src/main.tsx`
- `src/App.tsx`
- `src/pages/ProductsPage.tsx`
- `src/pages/CartPage.tsx`
- `src/pages/AccountPage.tsx`
- `vite.config.ts`

Run it with:

```bash
npm install
npm run dev
```

Build it with:

```bash
npm run build
```

That produces:

- the demo app in `demo-dist/`
- emitted i18n assets in `demo-dist/__i18n/`
- generated analysis artifacts in `.i18n/`

## SSR Example

Server:

```ts
import { initServerI18n } from 'vite-bundled-i18n/server'
import { i18nConfig } from './i18n.config'

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

translations.get('products.show.title')
// Inject scriptTag into HTML response
```

Client (React) — auto-hydrates from `window.__I18N_RESOURCES__`:

```tsx
import { I18nProvider } from 'vite-bundled-i18n/react'
import { createI18n } from 'vite-bundled-i18n'

const i18n = createI18n({ ... })

<I18nProvider instance={i18n}>
  <App />
</I18nProvider>
```

Client (Vue) — auto-hydrates from `window.__I18N_RESOURCES__`:

```ts
import { createI18nPlugin } from 'vite-bundled-i18n/vue'

app.use(createI18nPlugin(i18n))
```

Vanilla JS hydration (manual):

```ts
import { initI18n } from 'vite-bundled-i18n/vanilla'

await initI18n(config, {
  serverResources: resources,
  scope: 'products.show',
})
```

## Data File Example

```ts
import { defineI18nData, i18nKey } from 'vite-bundled-i18n'

export const navigation = defineI18nData([
  { href: '/', labelKey: i18nKey('global.nav.home') },
  { href: '/products', labelKey: i18nKey('global.nav.products') },
  { href: '/cart', labelKey: i18nKey('global.nav.cart') },
] as const)
```

Render later:

```tsx
const { t } = useI18n()
navigation.map((item) => <a key={item.href}>{t(item.labelKey)}</a>)
```

## Non-React Example

```ts
import { createI18n, getTranslations } from 'vite-bundled-i18n'

const i18n = createI18n({
  locale: 'en',
  defaultLocale: 'en',
  supportedLocales: ['en', 'bg'],
  localesDir: '/locales',
  dictionaries: {
    global: { include: ['shared.*', 'global.*'] },
  },
})

const translations = await getTranslations(i18n, 'products.index')
translations.get('products.index.heading')
translations.namespace('global').get('nav.home')
```

## Vue Example

```ts
import { createApp } from 'vue'
import { createI18n } from 'vite-bundled-i18n'
import { createI18nPlugin, useI18n } from 'vite-bundled-i18n/vue'

const i18n = createI18n({
  locale: 'en',
  defaultLocale: 'en',
  supportedLocales: ['en', 'bg'],
  localesDir: '/locales',
  dictionaries: {
    global: { include: ['shared.*', 'global.*'] },
  },
})

const app = createApp(App)
app.use(createI18nPlugin(i18n))
app.mount('#app')
```

In a component:

```vue
<script setup lang="ts">
import { useI18n } from 'vite-bundled-i18n/vue'

const { t, ready, locale } = useI18n('products.index')
</script>

<template>
  <div v-if="!ready">Loading...</div>
  <section v-else>
    <h1>{{ t('products.index.heading', 'All Products') }}</h1>
    <p>Current locale: {{ locale }}</p>
  </section>
</template>
```

## Global Access Example

```ts
import {
  createI18n,
  setGlobalInstance,
  t,
  getGlobalTranslations,
} from 'vite-bundled-i18n'

const i18n = createI18n({
  locale: 'en',
  defaultLocale: 'en',
  supportedLocales: ['en'],
  localesDir: '/locales',
  dictionaries: {
    global: { include: ['shared.*', 'global.*'] },
  },
})

await i18n.loadAllDictionaries('en')
setGlobalInstance(i18n)

t('shared.ok')
getGlobalTranslations().namespace('global').get('nav.home')
```
