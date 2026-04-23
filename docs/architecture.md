# Architecture

## The Core Idea

Traditional i18n loads translations as global data — every key available everywhere, resolved at runtime. `vite-bundled-i18n` treats translations as **code dependencies**: analyzed at build time, bundled per route, and shipped as static assets. The same way CSS is code-split and JS is tree-shaken, translations are scoped to the pages that use them.

## Three Layers

### 1. Build-Time Analysis (the real product)

The Vite plugin walks your page entry points, follows their import graphs, and extracts every translation key via AST analysis. No code execution — pure static analysis.

**What it finds:**
- `t('key')` and `get('key')` calls
- `useI18n('scope')` scope declarations
- `i18nKey('key')` markers in data files
- `defineI18nData()` arrays with key fields
- `as const` object properties and string enum members
- Helper functions that receive `t` as a parameter
- Configurable `keyFields` (e.g., `label`, `title`, `placeholder`)

**What it produces:**
- Per-route scope bundles (`__i18n/en/products.index.json` — only keys that route uses)
- Dictionary bundles (`__i18n/en/_dict/global.json` — shared keys by ownership rules)
- Compiled `Map` modules for O(1) lookups without JSON parsing
- Generated TypeScript types for progressive autocomplete and placeholder validation
- Reports: `manifest.json`, `missing.json`, `unused.json`, `stats.json`, `ownership.json`

Main modules:
- `src/extractor/walker.ts` — import graph traversal
- `src/extractor/extract.ts` — AST key extraction
- `src/extractor/scope-bundles.ts` — route-to-bundle mapping
- `src/extractor/bundle-generator.ts` — JSON asset emission
- `src/extractor/compiler.ts` — compiled JS module emission
- `src/extractor/type-generator.ts` — TypeScript type generation
- `src/extractor/dictionary-ownership.ts` — key ownership resolution
- `src/extractor/reports.ts` — analysis report generation

### 2. Thin Runtime (framework-agnostic core)

The runtime is minimal by design — most of the work happened at build time. It loads bundles, resolves keys, and manages locale state.

**Four internal services** (extracted from `createI18n`):

- **KeyTracker** (`src/core/services/key-tracker.ts`) — dev-only key usage recording with a capped circular buffer. Complete no-op in production.
- **CacheManager** (`src/core/services/cache-manager.ts`) — wraps the resource store with scope/dictionary load-state tracking, LRU eviction, and resource-change event dispatch.
- **BundleLoader** (`src/core/services/bundle-loader.ts`) — fetch orchestration for dictionaries, scopes, and namespaces. Request deduplication via in-flight promise maps. Supports compiled module loading.
- **LocaleManager** (`src/core/services/locale-manager.ts`) — locale state, change orchestration (reload dicts + scopes for new locale), and HMR event handling.

`createI18n()` is a thin orchestrator that composes these services and exposes the unified `I18nInstance` interface.

Additional core modules:
- `src/core/store.ts` — in-memory `Map<locale, Map<namespace, data>>` with deep merge and LRU metadata
- `src/core/resolver.ts` — dot-path key traversal
- `src/core/interpolator.ts` — `{{placeholder}}` replacement
- `src/core/fetcher.ts` — URL construction and `fetch()` wrappers
- `src/core/compiled-runtime.ts` — flat `Map<string, string>` for compiled mode

### 3. Framework Adapters (thin wrappers)

Each adapter is ~50-100 lines:

- **React** — `I18nProvider`, `useI18n`, `I18nBoundary`, `DevToolbar`
- **Vue** — `createI18nPlugin`, `useI18n` composable
- **Vanilla** — `initI18n`, `getTranslations`
- **Server** — `initServerI18n` for SSR with hydration

## Bundle Identities

The important identity is the **scope**, not the file name.

```
Dictionary bundle:  __i18n/en/_dict/global.json
Scope bundle:       __i18n/en/products.index.json
Compiled manifest:  __i18n/compiled/manifest.js
```

## Dictionaries vs Scopes

**Dictionaries** = "always available" layer. Preloaded on app init. Shared UI strings. Rules-based ownership via `include`/`exclude` with priority.

**Scopes** = "per-page" layer. Loaded on demand. Contains only keys that route references. Tree-shaken at build time.

## Fallback Chain

`requested locale → default locale → fallback string → key-as-value`

Consistent across JSON mode and compiled mode.

## Production Modes

**JSON** — `fetch()` for static JSON assets. Simple, universal.

**Compiled** — `import()` for JS `Map` modules. No JSON parsing, O(1) lookups, browser module caching. Auto-fallback to JSON on failure.

## Devtools

Reads entirely from the runtime instance — zero server round-trips:

1. **Translation Keys** — per-page footprint, resolved values, missing keys, bundle efficiency metric, search
2. **Bundles & Cache** — dictionaries, scopes, namespace residency, cache stats
3. **Store Inspector** — raw JSON per namespace

Auto-refreshes on SPA navigation. Route diagnostics (AST analysis) are lazy, on-demand only.

## Vite Plugin

Combines `devPlugin.ts` (middleware, type gen, HMR) and `buildPlugin.ts` (asset emission, `define` injection).

Build-time defines: `__VITE_I18N_BASE__`, `__VITE_I18N_COMPILED_MANIFEST__`, `__VITE_I18N_DEV__`, `__VITE_I18N_DEVBAR__`.

## Reports

Generated at build time: `manifest.json`, `missing.json`, `unused.json`, `stats.json`, `overlap.json`, `ownership.json`.
