# Architecture

## Product Shape

`vite-bundled-i18n` has three layers:

1. Runtime
2. Static analysis and generation
3. Vite integration

The runtime is framework-agnostic. React and Vue are thin adapters over it.

## Runtime

The runtime centers on `createI18n()` and the normalized translator object.

Main pieces:

- `src/core/createI18n.ts`
- `src/core/getTranslations.ts`
- `src/core/t.ts`
- `src/core/store.ts`
- `src/core/compiled-runtime.ts`
- `src/server.ts`

Behavior:

- dictionaries load by name
- scopes load by scope string like `products.index`
- lookups support fallback locale and interpolation
- the runtime can use JSON bundles or compiled `Map` modules
- translator objects normalize access across React, SSR, and vanilla usage

## Bundle Identities

The important identity is the scope, not the file name of the page component.

Examples:

- dictionary bundle: `__i18n/en/_dict/global.json`
- scope bundle: `__i18n/en/products.index.json`
- compiled manifest: `__i18n/compiled/manifest.js`

That keeps dev and production aligned around the same URL/lookup model.

## Dictionaries

Dictionaries are translation ownership rules, not component ownership rules.

Current model:

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

Resolution rules:

- higher priority claims matching keys first
- lower priority excludes already-owned keys
- collisions are reported in `ownership.json`
- ownership is key-based, not source-file-based

Implementation lives in `src/extractor/dictionary-ownership.ts`.

## Static Analysis

The extractor walks route entry points, follows imports, extracts keys, and plans bundles.

Main pieces:

- `src/extractor/walker.ts`
- `src/extractor/patterns.ts`
- `src/extractor/scope-bundles.ts`
- `src/extractor/bundle-generator.ts`
- `src/extractor/compiler.ts`
- `src/extractor/type-generator.ts`
- `src/extractor/reports.ts`

The extractor currently understands:

- imported global `t()`
- destructured `useI18n().t`
- shallow literal constants passed to translators
- object fields like `labelKey`
- helper calls like `i18nKey('global.nav.home')`
- `as const` object property and element access
- string enum member resolution
- configurable key field names via `extraction.keyFields`

It does not attempt arbitrary code execution. The intended path is explicit keys,
shallow constant propagation, and serializable data helpers.

## Production Modes

There are two runtime consumption strategies after build.

### JSON bundle mode

The runtime fetches emitted static assets:

- `__i18n/{locale}/_dict/{name}.json`
- `__i18n/{locale}/{scope}.json`

This is the default mental model and stays close to dev behavior.

### Compiled mode

The build also emits compiled map modules and a manifest:

- `__i18n/compiled/manifest.js`
- `__i18n/compiled/{locale}/...`

The runtime can load that manifest automatically and resolve directly from flat maps.

Benefits:

- no JSON parsing at runtime for those bundles
- direct `Map` lookups
- same scope/dictionary identity model

## Caching

The runtime has two cache layers:

1. `requestInit` options passed to `fetch`
2. in-memory namespace residency with optional eviction

The in-memory cache tracks:

- locale
- namespace
- source
- pinned state
- last access
- approximate size

This powers:

- request deduplication
- dictionary pinning
- LRU eviction for non-pinned data
- bounded memory for long-lived sessions

## Data Files

The recommended non-hook pattern is key-in-data, not translated-string-at-definition-time.

Helpers:

- `defineI18nData()`
- `i18nKey()`

That keeps data serializable, statically analyzable, and runtime-safe.

Module-top-level eager `t()` calls are intentionally not the primary pattern.

## SSR

The server flow:

1. `initServerI18n()` creates an instance and loads translations
2. Render with `translations`
3. The returned `scriptTag` injects `window.__I18N_RESOURCES__` into the HTML
4. React `I18nProvider` and Vue `createI18nPlugin` auto-detect and consume it on the client

No manual resource serialization or prop passing needed.

## Vite Integration

The public Vite entry is `src/plugin.ts`.

It combines:

- `src/plugin/devPlugin.ts`
- `src/plugin/buildPlugin.ts`

Build integration emits:

- bundle assets into the Vite output
- compiled modules into `__i18n/compiled`
- generated types
- reports

The public package surface mirrors that split:

- core runtime
- framework adapters
- server entry
- Vite plugin entry

## Reports

Generated reports are now part of the architecture, not an afterthought.

- `manifest.json`
- `missing.json`
- `unused.json`
- `stats.json`
- `overlap.json`
- `ownership.json`

`ownership.json` is especially important because it explains why a key ended up in a dictionary or was excluded from a scope bundle.
