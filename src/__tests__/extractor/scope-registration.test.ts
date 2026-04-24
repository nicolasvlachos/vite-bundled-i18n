import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { checkScopeRegistration } from '../../extractor/scope-registration';
import type { ProjectAnalysis, RouteAnalysis } from '../../extractor/walker-types';

/**
 * Build a RouteAnalysis for testing. Mirrors the walker's real behavior:
 * any scope in `entryScopes` is also present in aggregated `scopes` unless
 * the test explicitly overrides `scopes` to simulate pattern B (child
 * components declare scopes, entry doesn't).
 */
function makeRoute(overrides: Partial<RouteAnalysis>): RouteAnalysis {
  const entryScopes = overrides.entryScopes ?? [];
  const derivedScopes = overrides.scopes ?? entryScopes.slice();
  return {
    entryPoint: '/project/src/pages/home.tsx',
    routeId: 'home',
    scopes: derivedScopes,
    entryScopes,
    keys: [],
    files: [],
    ...overrides,
    // Re-apply — the spread above might have reset scopes/entryScopes.
    scopes: overrides.scopes ?? derivedScopes,
    entryScopes,
  };
}

function makeAnalysis(routes: RouteAnalysis[]): ProjectAnalysis {
  return { routes, availableNamespaces: [], allKeys: [], sharedNamespaces: [] };
}

describe('checkScopeRegistration', () => {
  const rootDir = '/project';

  it('mode "off" short-circuits and returns no violations', () => {
    const analysis = makeAnalysis([
      makeRoute({ entryPoint: path.join(rootDir, 'src/pages/home.tsx'), entryScopes: [] }),
    ]);
    const report = checkScopeRegistration(analysis, { rootDir, mode: 'off' });
    expect(report.violations).toEqual([]);
    expect(report.messages).toEqual([]);
  });

  it('reports entries that declare no scope in their own file', () => {
    const analysis = makeAnalysis([
      makeRoute({
        entryPoint: path.join(rootDir, 'src/pages/orphan.tsx'),
        entryScopes: [],
      }),
      makeRoute({
        entryPoint: path.join(rootDir, 'src/pages/registered.tsx'),
        entryScopes: ['registered.show'],
      }),
    ]);
    const report = checkScopeRegistration(analysis, { rootDir, mode: 'warn' });
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].relativePath).toBe(path.join('src', 'pages', 'orphan.tsx'));
    expect(report.messages[0]).toContain('orphan.tsx');
    expect(report.messages[0]).toContain('registers no scope');
    expect(report.messages[0]).toContain("Add `useI18n('<scope.id>')`");
  });

  it('accepts routes whose scopes come from child components (pattern B)', () => {
    // The page file itself composes children and doesn't call `useI18n(...)`,
    // but a child component does. `route.scopes` aggregates across the full
    // import graph, so the route is compliant — `PAGE_SCOPE_MAP[pageId]`
    // will contain the child's scope, and consumers can preload it via the
    // router-integration pattern.
    const analysis = makeAnalysis([
      makeRoute({
        entryPoint: path.join(rootDir, 'src/pages/admin.tsx'),
        scopes: ['sidebar.admin', 'admin.dashboard'],
        entryScopes: [],
      }),
    ]);
    const report = checkScopeRegistration(analysis, { rootDir, mode: 'warn' });
    expect(report.violations).toEqual([]);
  });

  it('stays silent when every entry registers a scope', () => {
    const analysis = makeAnalysis([
      makeRoute({
        entryPoint: path.join(rootDir, 'src/pages/a.tsx'),
        entryScopes: ['a'],
      }),
      makeRoute({
        entryPoint: path.join(rootDir, 'src/pages/b.tsx'),
        entryScopes: ['b.index', 'b.summary'],
      }),
    ]);
    const report = checkScopeRegistration(analysis, { rootDir, mode: 'error' });
    expect(report.violations).toEqual([]);
    expect(report.messages).toEqual([]);
  });

  it('message explains that both entry and child registration are valid, and offers remediation', () => {
    const analysis = makeAnalysis([
      makeRoute({
        entryPoint: path.join(rootDir, 'src/pages/orphan.tsx'),
        scopes: [],
        entryScopes: [],
      }),
    ]);
    const report = checkScopeRegistration(analysis, { rootDir, mode: 'warn' });
    const message = report.messages[0];
    expect(message).toMatch(/^\[vite-bundled-i18n\] /);
    expect(message).toMatch(/registers no scope/);
    expect(message).toContain('Add `useI18n(\'<scope.id>\')` at the top of the page');
    expect(message).toContain('Add it to any child component that mounts under this page');
    expect(message).toContain('Exclude the file via a negative glob');
  });
});
