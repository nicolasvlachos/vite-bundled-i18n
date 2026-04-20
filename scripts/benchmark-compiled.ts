/**
 * Benchmark: JSON bundle mode vs compiled Map mode
 *
 * Measures real-world performance differences between the two runtime paths
 * used by vite-bundled-i18n. Run with:
 *
 *   npx tsx scripts/benchmark-compiled.ts
 */

// ---------------------------------------------------------------------------
// 1. Generate realistic test data
// ---------------------------------------------------------------------------

const NAMESPACE_COUNT = 10;
const KEYS_PER_NAMESPACE = 50; // 500 keys total
const SECTIONS = ['header', 'body', 'footer', 'actions', 'labels'] as const;
const KEYS_PER_SECTION = KEYS_PER_NAMESPACE / SECTIONS.length; // 10 keys per section

/** ~30-char placeholder value to mimic realistic translation strings. */
function makeValue(ns: string, section: string, key: string): string {
  return `${ns}_${section}_${key} translation text here`;
}

/** Build the nested JSON-style translation object for a single namespace. */
function buildNamespaceObject(ns: string): Record<string, Record<string, string>> {
  const obj: Record<string, Record<string, string>> = {};
  for (const section of SECTIONS) {
    obj[section] = {};
    for (let i = 0; i < KEYS_PER_SECTION; i++) {
      const key = `item${i}`;
      obj[section][key] = makeValue(ns, section, key);
    }
  }
  return obj;
}

type NamespacedBundle = Record<string, Record<string, Record<string, string>>>;

/** Full bundle: { [namespace]: { [section]: { [key]: value } } } */
function buildBundle(): NamespacedBundle {
  const bundle: NamespacedBundle = {};
  for (let n = 0; n < NAMESPACE_COUNT; n++) {
    const ns = `namespace${n}`;
    bundle[ns] = buildNamespaceObject(ns);
  }
  return bundle;
}

/** Flat Map<fullyQualifiedKey, value> — compiled mode representation. */
function buildFlatMap(bundle: NamespacedBundle): Map<string, string> {
  const map = new Map<string, string>();
  for (const [ns, sections] of Object.entries(bundle)) {
    for (const [section, keys] of Object.entries(sections)) {
      for (const [key, value] of Object.entries(keys)) {
        map.set(`${ns}.${section}.${key}`, value);
      }
    }
  }
  return map;
}

/** Collect all fully qualified keys for use in lookup benchmarks. */
function collectAllKeys(bundle: NamespacedBundle): string[] {
  const keys: string[] = [];
  for (const [ns, sections] of Object.entries(bundle)) {
    for (const [section, keyMap] of Object.entries(sections)) {
      for (const key of Object.keys(keyMap)) {
        keys.push(`${ns}.${section}.${key}`);
      }
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// 2. Dot-path traversal — simulates the JSON-mode resolveKey path
// ---------------------------------------------------------------------------

/**
 * Resolves a dot-separated subkey path against a nested object.
 * Mirrors the behaviour of `src/core/resolver.ts#resolveKey`.
 */
function resolveKey(
  data: Record<string, unknown>,
  keyPath: string,
): string | undefined {
  if (!keyPath) return undefined;
  const segments = keyPath.split('.');
  let current: unknown = data;
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
    if (current === undefined) return undefined;
  }
  return typeof current === 'string' ? current : undefined;
}

// ---------------------------------------------------------------------------
// 3. Benchmark helpers
// ---------------------------------------------------------------------------

function fmt(ms: number, decimals = 3): string {
  return ms.toFixed(decimals);
}

function repeat(n: number, fn: () => void): number {
  const start = performance.now();
  for (let i = 0; i < n; i++) fn();
  return performance.now() - start;
}

// ---------------------------------------------------------------------------
// 4. Run benchmarks
// ---------------------------------------------------------------------------

const bundle = buildBundle();
const flatMap = buildFlatMap(bundle);
const allKeys = collectAllKeys(bundle);
const jsonString = JSON.stringify(bundle);

const PARSE_ITERATIONS = 1_000;
const MAP_CONSTRUCT_ITERATIONS = 1_000;
const LOOKUP_ITERATIONS = 10_000;

// --- JSON parse ---
const jsonParseTotal = repeat(PARSE_ITERATIONS, () => {
  JSON.parse(jsonString);
});

// --- Map construction ---
const mapConstructTotal = repeat(MAP_CONSTRUCT_ITERATIONS, () => {
  buildFlatMap(JSON.parse(jsonString) as NamespacedBundle);
});

// --- Key resolution: JSON mode (parse + dot-path traversal) ---
let jsonLookupIdx = 0;
const jsonLookupTotal = repeat(LOOKUP_ITERATIONS, () => {
  const fqKey = allKeys[jsonLookupIdx % allKeys.length];
  jsonLookupIdx++;

  // Split into namespace (first segment) + subkey (rest)
  const dotIndex = fqKey.indexOf('.');
  const ns = fqKey.slice(0, dotIndex);
  const subkey = fqKey.slice(dotIndex + 1);

  const namespaceData = bundle[ns] as Record<string, unknown>;
  resolveKey(namespaceData, subkey);
});

// --- Key resolution: Map mode (direct O(1) lookup) ---
let mapLookupIdx = 0;
const mapLookupTotal = repeat(LOOKUP_ITERATIONS, () => {
  const fqKey = allKeys[mapLookupIdx % allKeys.length];
  mapLookupIdx++;
  flatMap.get(fqKey);
});

// ---------------------------------------------------------------------------
// 5. Output
// ---------------------------------------------------------------------------

const jsonAvgParse = jsonParseTotal / PARSE_ITERATIONS;
const mapAvgConstruct = mapConstructTotal / MAP_CONSTRUCT_ITERATIONS;
const jsonAvgLookup = jsonLookupTotal / LOOKUP_ITERATIONS;
const mapAvgLookup = mapLookupTotal / LOOKUP_ITERATIONS;
const speedup = jsonAvgLookup / mapAvgLookup;
const jsonKB = (new TextEncoder().encode(jsonString).byteLength / 1024).toFixed(1);

console.log(`
vite-bundled-i18n: Compiled Mode Benchmark
==========================================

Test data: ${allKeys.length} keys across ${NAMESPACE_COUNT} namespaces

JSON parse (${PARSE_ITERATIONS.toLocaleString()} iterations):
  Total: ${fmt(jsonParseTotal, 2)}ms
  Average: ${fmt(jsonAvgParse)}ms per parse

Map construction (${MAP_CONSTRUCT_ITERATIONS.toLocaleString()} iterations):
  Total: ${fmt(mapConstructTotal, 2)}ms
  Average: ${fmt(mapAvgConstruct)}ms per construction

Key resolution (${LOOKUP_ITERATIONS.toLocaleString()} lookups):
  JSON (parse + traverse): ${fmt(jsonAvgLookup, 6)}ms avg
  Map (direct lookup):     ${fmt(mapAvgLookup, 6)}ms avg
  Speedup: ${speedup.toFixed(1)}x faster

Memory:
  JSON string size: ${jsonKB} KB
  Map entries: ${flatMap.size}
`);
