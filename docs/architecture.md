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
- `src/extractor/extraction-cache.ts` — per-file AST cache backed by a JSON snapshot on disk
- `src/extractor/cache-config.ts` — resolves cache behavior from config + env + CLI flags
- `src/extractor/scope-bundles.ts` — route-to-bundle mapping
- `src/extractor/scope-map.ts` — framework-neutral page-id → scopes index (emitted as `scope-map.json` + `PAGE_SCOPE_MAP`)
- `src/extractor/scope-registration.ts` — post-walk audit (`bundling.strictScopeRegistration`)
- `src/extractor/dynamic-keys.ts` — per-route injection of `bundling.dynamicKeys` with orphan reporting
- `src/extractor/bundle-generator.ts` — JSON asset emission
- `src/extractor/compiler.ts` — compiled JS module emission
- `src/extractor/type-generator.ts` — TypeScript type generation + `i18n-generated.js` runtime sibling
- `src/extractor/dictionary-ownership.ts` — key ownership resolution
- `src/extractor/reports.ts` — analysis report generation

**Extraction cache flow.** On every walker invocation the cache sits between the walker and `extractKeys`:

1. Walker calls `visit(filePath)` for each file in the import graph
2. Walker `stat`s the file (mtime + size)
3. Walker consults the cache — if entry exists and both match disk, the walker reuses cached keys/scopes/imports and skips the AST parse
4. On miss, walker parses the source, extracts keys, resolves imports to absolute paths, and writes back to the cache

The cache file (`.i18n/cache/extraction-v1.json`) carries a header (`pluginVersion`, `configHash`, `nodeVersion`, `schemaVersion`). Any mismatch discards the snapshot on load. See the [API docs](./api.md#extraction-cache-cache) for configuration and bypass options.

**Dev HMR.** During `vite dev` the dev plugin registers a `transform` hook that refreshes cache entries as Vite transforms source files. No extra AST parse — we piggyback on Vite's own pipeline. When keys or scopes actually change in a file, the diagnostics/extras indexes are invalidated so the next scope-bundle request rebuilds them (cheaply — warm cache means the rebuild is mostly stat calls).

### 2. Thin Runtime (framework-agnostic core)

The runtime is minimal by design — most of the work happened at build time. It loads bundles, resolves keys, and manages locale state.

**Five internal services** (extracted from `createI18n`):

- **KeyTracker** (`src/core/services/key-tracker.ts`) — dev-only key usage recording with a capped circular buffer. Complete no-op in production.
- **CacheManager** (`src/core/services/cache-manager.ts`) — wraps the resource store with scope/dictionary load-state tracking, LRU eviction, and resource-change event dispatch.
- **BundleLoader** (`src/core/services/bundle-loader.ts`) — fetch orchestration for dictionaries, scopes, and namespaces. Request deduplication via in-flight promise maps. Supports compiled module loading.
- **LocaleManager** (`src/core/services/locale-manager.ts`) — locale state, change orchestration (reload dicts + scopes for new locale), and HMR event handling.
- **ReadinessGate** (`src/core/services/readiness-gate.ts`) — framework-agnostic refcount primitive exposing `ready` / `pendingCount` / `whenReady` / `subscribe` / `reset`. `loadScope()` auto-registers on every call and releases on settle. Framework adapters subscribe directly — no consumer counters needed.

`createI18n()` is a thin orchestrator that composes these services and exposes the unified `I18nInstance` interface. The instance also carries `instance.gate` (the ReadinessGate) for direct access from host code and UI adapters.

Additional core modules:
- `src/core/store.ts` — in-memory `Map<locale, Map<namespace, data>>` with deep merge and LRU metadata
- `src/core/resolver.ts` — dot-path key traversal
- `src/core/interpolator.ts` — `{{placeholder}}` replacement
- `src/core/fetcher.ts` — URL construction and `fetch()` wrappers
- `src/core/compiled-runtime.ts` — flat `Map<string, string>` for compiled mode
- `src/core/scope-map-client.ts` — runtime fetcher for the emitted `scope-map.json` (with in-flight dedup, generation-safe invalidation, and a base-path-aware default URL)
- `src/core/i18n-generated-shim.ts` — empty-default placeholder shipped in `dist/`; the plugin aliases it to the project-local `.i18n/i18n-generated.js` at build time

### 3. Framework Adapters (thin wrappers)

Each adapter is ~50-150 lines:

- **React** — `I18nProvider`, `useI18n`, `I18nBoundary`, `GateBoundary`, `useGate`, `DevToolbar`
- **Vue** — `createI18nPlugin`, `useI18n`, `useGate` composables
- **Vanilla** — `initI18n`, `getTranslations`
- **Server** — `initServerI18n` for SSR with hydration
- **Testing** — `createTestI18n`, `I18nTestProvider` (React), `createI18nTestPlugin` (Vue). Skips async hydration; gate starts ready.

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

Combines `devPlugin.ts` (middleware, type gen, HMR, lean scope-bundle responses) and `buildPlugin.ts` (asset emission, `define` injection, split across `buildStart` + `closeBundle`).

**buildStart** runs project analysis, applies `bundling.dynamicKeys`, writes generated types (`.ts` + `.js` sibling), and runs the scope-registration audit. Downstream modules importing `.i18n/i18n-generated.ts` during the same build resolve correctly since types exist before transform starts.

**closeBundle** emits scope bundles, compiled modules, reports, and `scope-map.json`. Analysis from `buildStart` is reused so there's no double-walk.

**Resolve alias:** both dev and build plugins register `'vite-bundled-i18n/generated'` → project-local `.i18n/i18n-generated.js`. A placeholder file is written in `config()` before Vite traverses the module graph, so resolution never fails. Non-Vite consumers (raw Node, tests without a bundler) fall through to the published empty shim (`dist/core/i18n-generated-shim.js`).

**Shared emit pipeline:** three composable helpers — `runProjectAnalysis`, `emitGeneratedArtifacts`, `emitBundlesArtifacts`. The `emitI18nBuildArtifacts` wrapper composes all three for CLI `build` and tests. Post-walk audits (dynamic keys + strict scope registration) live inside `runProjectAnalysis` so every entry point behaves identically.

**Lean dev bundles:** `buildScopeBundle` consults cached scope plans derived from the same analysis the production build uses. Each dev response is tree-shaken per route. Falls back to full namespaces when no plan exists for the requested scope (debugging safety net) or when `bundling.dev.leanBundles: false` explicitly opts out.

Build-time defines: `__VITE_I18N_BASE__`, `__VITE_I18N_COMPILED_MANIFEST__`, `__VITE_I18N_DEV__`, `__VITE_I18N_DEVBAR__`, `__VITE_BUNDLED_I18N_VERSION__`.

## Reports

Generated at build time: `manifest.json`, `missing.json`, `unused.json`, `stats.json`, `overlap.json`, `ownership.json`.
