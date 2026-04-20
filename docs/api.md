# API Reference

## Package Entries

Public subpaths:

- `vite-bundled-i18n`
- `vite-bundled-i18n/react`
- `vite-bundled-i18n/vanilla`
- `vite-bundled-i18n/vue`
- `vite-bundled-i18n/server`
- `vite-bundled-i18n/plugin`

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

- `keys`
- `include`
- `priority`
- `pinned`

`include` accepts exact keys, namespace wildcards, and key-prefix patterns.

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

### `defineI18nData(data)` and `i18nKey(key)`

Helpers for serializable data/config modules:

```ts
export const nav = defineI18nData([
  { href: '/', labelKey: i18nKey('global.nav.home') },
])
```

## React

### `<I18nProvider instance={i18n}>`

Registers the instance globally, loads dictionaries, and re-renders on locale change.

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

## Vite Plugin

Import from `vite-bundled-i18n/plugin`.

### `i18nPlugin(sharedConfig, buildConfig?)`

Unified dev + build plugin.

Dev:

- serves `__i18n/{locale}/_dict/{name}.json`
- serves `__i18n/{locale}/{scope}.json`

Build:

- emits static JSON bundle assets
- emits compiled manifest/modules
- writes types
- writes reports

### `i18nDevPlugin(sharedConfig)`

Dev-only plugin.

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
