import fs from 'node:fs';
import path from 'node:path';
import type { ProjectAnalysis } from './walker-types';
import type { DictionaryConfig } from '../core/types';
import {
  checkScopeRegistration,
  type ScopeRegistrationViolation,
} from './scope-registration';
import { flattenLocaleKeys, generateMissing, generateUnused } from './reports';
import {
  resolveDictionaryOwnership,
  keyMatchesPattern,
} from './dictionary-ownership';

/**
 * Severity for an individual extraction check. Mirrors the existing
 * `strictScopeRegistration` shape so callers learn one vocabulary.
 */
export type StrictCheckMode = 'off' | 'warn' | 'error';

/**
 * Per-check severity overrides. Any field left undefined inherits from
 * the top-level `mode`. Setting a check to `'off'` disables only that
 * check; the rest still run.
 */
export interface StrictExtractionChecks {
  /** Page registers no `useI18n('<scope>')`. Replaces standalone `strictScopeRegistration`. */
  scopeRegistration?: StrictCheckMode;
  /** Static `t('foo.bar')` references a key absent from every locale namespace. */
  missingKeys?: StrictCheckMode;
  /** Locale key never referenced by any route — bloats bundles + indicates dead translations. */
  unusedKeys?: StrictCheckMode;
  /** `bundling.dynamicKeys` entry that matches no route AND no dictionary. */
  orphanDynamic?: StrictCheckMode;
}

/**
 * Resolved (non-undefined) version of {@link StrictExtractionChecks} —
 * what runs at audit time after defaulting via `mode`.
 */
export interface ResolvedStrictExtractionChecks {
  scopeRegistration: StrictCheckMode;
  missingKeys: StrictCheckMode;
  unusedKeys: StrictCheckMode;
  orphanDynamic: StrictCheckMode;
}

/**
 * The user-facing config shape. Accepts a shorthand string OR an
 * options object. The shorthand is equivalent to setting `mode` to
 * the same value with every check defaulting to it.
 *
 * Backward compat: when the legacy `strictScopeRegistration` is set
 * but no `strictExtraction` is, the legacy value is used as the
 * `scopeRegistration` mode. Other checks default to `'off'`.
 */
export type StrictExtractionConfig =
  | StrictCheckMode
  | (StrictExtractionChecks & {
    /** Default severity applied to any check left undefined. Default: `'warn'`. */
    mode?: StrictCheckMode;
    /** Where to write the structured JSON report. Default: `<generatedOutDir>/strict-extraction-report.json`. */
    reportPath?: string;
  });

/**
 * Per-check finding. The shape is uniform so a CI consumer can iterate
 * `findings` regardless of which check produced the entry.
 */
export interface StrictExtractionFinding {
  check: keyof ResolvedStrictExtractionChecks;
  severity: 'warn' | 'error';
  /** Short message line, suitable for a logger. */
  message: string;
  /** Free-form payload (file paths, key names, etc.) — useful for CI tooling. */
  details?: Record<string, unknown>;
}

/**
 * Aggregate output of {@link runStrictExtraction}. Always returned; the
 * caller decides what to do based on `severity` per finding (or the
 * top-level `hasErrors`).
 */
export interface StrictExtractionReport {
  resolvedChecks: ResolvedStrictExtractionChecks;
  findings: StrictExtractionFinding[];
  /** True if any finding has `severity: 'error'`. Caller should fail the build. */
  hasErrors: boolean;
  /** Counts per check, for at-a-glance summaries. */
  summary: Record<keyof ResolvedStrictExtractionChecks, { warn: number; error: number }>;
}

/**
 * Inputs to the audit. Wraps the bits needed by every check so the
 * caller doesn't have to thread `analysis` + `localesDir` + dictionaries
 * into each check individually.
 */
export interface RunStrictExtractionInput {
  analysis: ProjectAnalysis;
  rootDir: string;
  localesDir: string;
  defaultLocale: string;
  dictionaries?: Record<string, DictionaryConfig>;
  /** From `bundling.dynamicKeys`. Used by the orphan-dynamic check. */
  dynamicKeys?: readonly string[];
  /** User config (or its legacy equivalent). */
  config: StrictExtractionConfig | undefined;
  /** Used to back-fill `scopeRegistration` when only the legacy field is set. */
  legacyStrictScopeRegistration?: StrictCheckMode;
  /** Where to write the structured report. Defaults to `<generatedOutDir>/strict-extraction-report.json`. */
  defaultReportPath: string;
}

/**
 * Resolve the user's config (any of: undefined, shorthand string, full
 * object) into a uniform `ResolvedStrictExtractionChecks` plus a
 * `reportPath`. Honors backward-compat with `strictScopeRegistration`.
 *
 * Subtle rule: `orphanDynamic` defaults to `'warn'` when the user
 * didn't explicitly opt out. Pre-v0.7 `applyDynamicKeys` always
 * emitted these warnings; making the unified shorthand `'off'`
 * silently kill them would be a surprising regression. Operators who
 * truly want silence pass `{ orphanDynamic: 'off' }` explicitly.
 */
export function resolveStrictExtractionConfig(
  config: StrictExtractionConfig | undefined,
  fallbacks: {
    legacyStrictScopeRegistration?: StrictCheckMode;
    defaultReportPath: string;
  },
): { checks: ResolvedStrictExtractionChecks; reportPath: string } {
  let mode: StrictCheckMode;
  let perCheck: StrictExtractionChecks = {};
  let reportPath = fallbacks.defaultReportPath;

  if (typeof config === 'string') {
    mode = config;
  } else if (config && typeof config === 'object') {
    mode = config.mode ?? 'warn';
    perCheck = config;
    if (config.reportPath) reportPath = config.reportPath;
  } else {
    // No new-style config. Fall back to the legacy field for
    // scope-registration only; everything else stays off (except
    // orphanDynamic, kept on for backward parity with applyDynamicKeys).
    return {
      checks: {
        scopeRegistration: fallbacks.legacyStrictScopeRegistration ?? 'warn',
        missingKeys: 'off',
        unusedKeys: 'off',
        orphanDynamic: 'warn',
      },
      reportPath,
    };
  }

  // For the explicit-config path, `orphanDynamic` resolves the same as
  // every other check — `mode` is the default, an explicit per-check
  // value overrides. The one nuance: when `mode` is `'off'` AND the
  // user did NOT explicitly set `orphanDynamic`, keep it at `'warn'`
  // so silencing the unified audit doesn't silently kill warnings the
  // user was previously seeing from `applyDynamicKeys`. This is the
  // single explicit deviation from "mode applies uniformly."
  const orphanDefault: StrictCheckMode = mode === 'off' ? 'warn' : mode;

  return {
    checks: {
      scopeRegistration: perCheck.scopeRegistration ?? mode,
      missingKeys: perCheck.missingKeys ?? mode,
      unusedKeys: perCheck.unusedKeys ?? mode,
      orphanDynamic: perCheck.orphanDynamic ?? orphanDefault,
    },
    reportPath,
  };
}

function pushScopeRegistrationFindings(
  violations: ScopeRegistrationViolation[],
  severity: 'warn' | 'error',
  out: StrictExtractionFinding[],
): void {
  for (const v of violations) {
    out.push({
      check: 'scopeRegistration',
      severity,
      message: `${v.relativePath} registers no scope (no useI18n('<scope>') in entry or imports).`,
      details: { entryPoint: v.entryPoint, relativePath: v.relativePath },
    });
  }
}

function pushMissingKeyFindings(
  analysis: ProjectAnalysis,
  available: Map<string, string[]>,
  defaultLocale: string,
  severity: 'warn' | 'error',
  out: StrictExtractionFinding[],
): void {
  const missing = generateMissing(analysis, available);
  for (const entry of missing.keys) {
    out.push({
      check: 'missingKeys',
      severity,
      message: `Translation key "${entry.key}" used in code but absent from ${defaultLocale} locale files.`,
      details: { key: entry.key, line: entry.line, files: entry.usedIn },
    });
  }
}

function pushUnusedKeyFindings(
  analysis: ProjectAnalysis,
  available: Map<string, string[]>,
  severity: 'warn' | 'error',
  out: StrictExtractionFinding[],
): void {
  const unused = generateUnused(analysis, available);
  for (const entry of unused.keys) {
    out.push({
      check: 'unusedKeys',
      severity,
      message: `Locale key "${entry.key}" is defined but never referenced by any route.`,
      details: { key: entry.key, namespace: entry.namespace },
    });
  }
}

function pushOrphanDynamicFindings(
  analysis: ProjectAnalysis,
  dynamicKeys: readonly string[] | undefined,
  dictionaries: Record<string, DictionaryConfig> | undefined,
  severity: 'warn' | 'error',
  out: StrictExtractionFinding[],
): void {
  if (!dynamicKeys || dynamicKeys.length === 0) return;

  // A dynamic key is an "orphan" when its namespace matches no route's
  // primary scope namespace AND it isn't owned by a dictionary. Same
  // semantics as `applyDynamicKeys`'s orphan check, just lifted into
  // the unified report.
  const routeNamespaces = new Set<string>();
  for (const route of analysis.routes) {
    for (const scope of route.scopes) {
      const ns = scope.split('.')[0];
      if (ns) routeNamespaces.add(ns);
    }
  }

  const ownership = resolveDictionaryOwnership(new Set(dynamicKeys), dictionaries);

  for (const key of dynamicKeys) {
    const ns = key.split('.')[0];
    if (!ns) continue;
    if (routeNamespaces.has(ns)) continue;
    if (ownership.keyOwner.has(key)) continue;
    // Also tolerate keys that match any dict pattern even if not in availableKeys yet.
    let inDict = false;
    for (const rule of ownership.rules) {
      if (rule.include.some((pat) => keyMatchesPattern(key, pat))) {
        inDict = true;
        break;
      }
    }
    if (inDict) continue;

    out.push({
      check: 'orphanDynamic',
      severity,
      message: `dynamicKeys entry "${key}" matches no route and no dictionary — it won't ship anywhere.`,
      details: { key, namespace: ns },
    });
  }
}

/**
 * Run every enabled check and return the aggregated report. Pure — no
 * disk side effects (call {@link writeStrictExtractionReport} for that).
 */
export function runStrictExtraction(
  input: RunStrictExtractionInput,
): StrictExtractionReport {
  const { checks } = resolveStrictExtractionConfig(input.config, {
    legacyStrictScopeRegistration: input.legacyStrictScopeRegistration,
    defaultReportPath: input.defaultReportPath,
  });

  const findings: StrictExtractionFinding[] = [];

  if (checks.scopeRegistration !== 'off') {
    const r = checkScopeRegistration(input.analysis, {
      rootDir: input.rootDir,
      mode: checks.scopeRegistration,
    });
    pushScopeRegistrationFindings(
      r.violations,
      checks.scopeRegistration as 'warn' | 'error',
      findings,
    );
  }

  // Both missing/unused checks read the same locale-files map. Hoist
  // the read so we pay the FS+parse cost once even when both checks
  // are enabled — large projects with many namespaces save real time.
  const needsLocaleScan = checks.missingKeys !== 'off' || checks.unusedKeys !== 'off';
  const available = needsLocaleScan
    ? flattenLocaleKeys(input.localesDir, input.defaultLocale)
    : null;

  if (checks.missingKeys !== 'off' && available) {
    pushMissingKeyFindings(
      input.analysis,
      available,
      input.defaultLocale,
      checks.missingKeys as 'warn' | 'error',
      findings,
    );
  }

  if (checks.unusedKeys !== 'off' && available) {
    pushUnusedKeyFindings(
      input.analysis,
      available,
      checks.unusedKeys as 'warn' | 'error',
      findings,
    );
  }

  if (checks.orphanDynamic !== 'off') {
    pushOrphanDynamicFindings(
      input.analysis,
      input.dynamicKeys,
      input.dictionaries,
      checks.orphanDynamic as 'warn' | 'error',
      findings,
    );
  }

  // Tally per-check counts for summary display.
  const summary: Record<keyof ResolvedStrictExtractionChecks, { warn: number; error: number }> = {
    scopeRegistration: { warn: 0, error: 0 },
    missingKeys: { warn: 0, error: 0 },
    unusedKeys: { warn: 0, error: 0 },
    orphanDynamic: { warn: 0, error: 0 },
  };
  for (const f of findings) {
    summary[f.check][f.severity]++;
  }

  return {
    resolvedChecks: checks,
    findings,
    hasErrors: findings.some((f) => f.severity === 'error'),
    summary,
  };
}

/**
 * Persist the report to disk as a structured JSON document. CI tooling
 * can parse this without needing to scrape stdout. Atomic write —
 * temp file + rename. Failure is swallowed; the report is observability,
 * never correctness.
 */
export function writeStrictExtractionReport(
  reportPath: string,
  report: StrictExtractionReport,
): void {
  const dir = path.dirname(reportPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch { return; }

  const payload = {
    ...report,
    writtenAt: new Date().toISOString(),
  };

  const tmp = `${reportPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, reportPath);
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* swallow */ }
  }
}

/**
 * Convenience: throw if any finding has severity `'error'`. Used by the
 * build plugin to fail CI when strict mode is set to `'error'`.
 */
export function assertNoStrictExtractionErrors(report: StrictExtractionReport): void {
  if (!report.hasErrors) return;
  const lines = report.findings
    .filter((f) => f.severity === 'error')
    .map((f) => `  - [${f.check}] ${f.message}`);
  throw new Error(
    `vite-bundled-i18n: strictExtraction failed with ${lines.length} error(s):\n\n${lines.join('\n')}\n\n` +
      `See the structured report for details.`,
  );
}
