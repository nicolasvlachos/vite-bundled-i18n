import path from 'node:path';
import type { ProjectAnalysis } from './walker-types';

/**
 * Report entries emitted by {@link checkScopeRegistration}. One entry per
 * page file that has no `useI18n('<literal>')` call in its entry source.
 */
export interface ScopeRegistrationViolation {
  /** Absolute path to the page file missing a scope declaration. */
  entryPoint: string;
  /** A short relative path for display, if a rootDir was supplied. */
  relativePath: string;
}

/**
 * Options controlling the severity + output format of a scope-registration
 * audit. The mode is resolved by the plugin from
 * `bundling.strictScopeRegistration` before calling this function.
 */
export interface CheckScopeRegistrationOptions {
  /** Absolute project root, used to derive short display paths. */
  rootDir: string;
  /** Severity mode. `'off'` short-circuits; the function returns empty. */
  mode: 'off' | 'warn' | 'error';
}

export interface ScopeRegistrationReport {
  violations: ScopeRegistrationViolation[];
  /** Pre-formatted message lines ready to hand to a logger. */
  messages: string[];
}

/**
 * Audit page routes for missing scope declarations.
 *
 * A route is **compliant** when *any* file in its import graph — the entry
 * or any transitive child — declares at least one `useI18n('<literal>')`
 * scope. Both patterns are valid:
 *
 * - Entry declares scope: `useI18n('products.show')` at the top of the page.
 * - Entry composes, children declare scopes: page renders
 *   `<Sidebar />` / `<MainContent />`; each child component calls
 *   `useI18n('its.own.scope')`. Children that don't need to trigger a load
 *   can just call `useI18n()` with no args and read the already-loaded cache.
 *
 * The audit fires only when the aggregated scopes across a route are empty —
 * at that point `PAGE_SCOPE_MAP[pageId]` would be `[]` and consumers using
 * the router-integration pattern couldn't preload anything.
 *
 * Caller decides what to do with the result:
 * - `'warn'` — iterate `messages` and pass each to `logger.warn`
 * - `'error'` — if `violations.length > 0`, throw an aggregated error
 * - `'off'` — returns empty synchronously, no work
 */
export function checkScopeRegistration(
  analysis: ProjectAnalysis,
  options: CheckScopeRegistrationOptions,
): ScopeRegistrationReport {
  if (options.mode === 'off') {
    return { violations: [], messages: [] };
  }

  const violations: ScopeRegistrationViolation[] = [];
  for (const route of analysis.routes) {
    if (route.scopes.length > 0) continue;
    violations.push({
      entryPoint: route.entryPoint,
      relativePath: path.relative(options.rootDir, route.entryPoint),
    });
  }

  const messages = violations.map((v) => formatMessage(v));
  return { violations, messages };
}

function formatMessage(violation: ScopeRegistrationViolation): string {
  return [
    `[vite-bundled-i18n] ${violation.relativePath} registers no scope.`,
    `  Neither the page nor any of its imported components calls \`useI18n('<scope>')\`,`,
    `  so this route ships zero translations. Options:`,
    `    - Add \`useI18n('<scope.id>')\` at the top of the page.`,
    `    - Add it to any child component that mounts under this page.`,
    `    - Exclude the file via a negative glob if it's not actually a page.`,
  ].join('\n');
}
