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
