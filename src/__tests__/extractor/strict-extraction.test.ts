import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  runStrictExtraction,
  resolveStrictExtractionConfig,
  writeStrictExtractionReport,
  assertNoStrictExtractionErrors,
} from '../../extractor/strict-extraction';
import type { ProjectAnalysis } from '../../extractor/walker-types';
import type { ExtractedKey } from '../../extractor/types';

let tmpDir: string;
let localesDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-strict-'));
  localesDir = path.join(tmpDir, 'locales');
  fs.mkdirSync(path.join(localesDir, 'en'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const k = (key: string, dynamic = false): ExtractedKey => ({ key, dynamic, line: 1, column: 0 });

function writeLocale(rel: string, data: object): void {
  const full = path.join(localesDir, 'en', rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data));
}

function analysis(input: {
  routes: { id: string; entry: string; scopes: string[]; keys: ExtractedKey[] }[];
}): ProjectAnalysis {
  const allKeys = input.routes.flatMap((r) => r.keys);
  return {
    routes: input.routes.map((r) => ({
      entryPoint: r.entry,
      routeId: r.id,
      scopes: r.scopes,
      entryScopes: r.scopes,
      keys: r.keys,
      files: [r.entry],
    })),
    availableNamespaces: [],
    allKeys,
    sharedNamespaces: [],
  };
}

describe('resolveStrictExtractionConfig', () => {
  it('defaults to scopeRegistration=warn (legacy parity), other checks off', () => {
    const r = resolveStrictExtractionConfig(undefined, {
      defaultReportPath: '/tmp/x',
    });
    expect(r.checks.scopeRegistration).toBe('warn');
    expect(r.checks.missingKeys).toBe('off');
    expect(r.checks.unusedKeys).toBe('off');
    expect(r.checks.orphanDynamic).toBe('warn');
  });

  it('honors legacy strictScopeRegistration when no new config is provided', () => {
    const off = resolveStrictExtractionConfig(undefined, {
      legacyStrictScopeRegistration: 'off',
      defaultReportPath: '/tmp/x',
    });
    expect(off.checks.scopeRegistration).toBe('off');

    const error = resolveStrictExtractionConfig(undefined, {
      legacyStrictScopeRegistration: 'error',
      defaultReportPath: '/tmp/x',
    });
    expect(error.checks.scopeRegistration).toBe('error');
  });

  it('shorthand string sets every check to that mode', () => {
    const r = resolveStrictExtractionConfig('error', {
      defaultReportPath: '/tmp/x',
    });
    expect(r.checks.scopeRegistration).toBe('error');
    expect(r.checks.missingKeys).toBe('error');
    expect(r.checks.unusedKeys).toBe('error');
    expect(r.checks.orphanDynamic).toBe('error');
  });

  it('object form: per-check overrides win over mode', () => {
    const r = resolveStrictExtractionConfig(
      { mode: 'warn', missingKeys: 'error', unusedKeys: 'off' },
      { defaultReportPath: '/tmp/x' },
    );
    expect(r.checks.scopeRegistration).toBe('warn');
    expect(r.checks.missingKeys).toBe('error');
    expect(r.checks.unusedKeys).toBe('off');
    expect(r.checks.orphanDynamic).toBe('warn');
  });

  it("P3 fix: shorthand 'off' keeps orphanDynamic at 'warn' to preserve legacy applyDynamicKeys behavior", () => {
    const r = resolveStrictExtractionConfig('off', {
      defaultReportPath: '/tmp/x',
    });
    expect(r.checks.scopeRegistration).toBe('off');
    expect(r.checks.missingKeys).toBe('off');
    expect(r.checks.unusedKeys).toBe('off');
    // The deviation: silencing the unified audit shouldn't silently
    // turn off warnings the user was previously seeing.
    expect(r.checks.orphanDynamic).toBe('warn');
  });

  it("P3 fix: explicit { orphanDynamic: 'off' } DOES disable orphan-dynamic, even with mode 'off'", () => {
    const r = resolveStrictExtractionConfig(
      { mode: 'off', orphanDynamic: 'off' },
      { defaultReportPath: '/tmp/x' },
    );
    expect(r.checks.orphanDynamic).toBe('off');
  });

  it('explicit reportPath wins over default', () => {
    const r = resolveStrictExtractionConfig(
      { mode: 'warn', reportPath: '/custom/report.json' },
      { defaultReportPath: '/default/report.json' },
    );
    expect(r.reportPath).toBe('/custom/report.json');
  });

  it('object without reportPath uses default', () => {
    const r = resolveStrictExtractionConfig(
      { mode: 'warn' },
      { defaultReportPath: '/default/report.json' },
    );
    expect(r.reportPath).toBe('/default/report.json');
  });
});

describe('runStrictExtraction: scopeRegistration check', () => {
  it('flags routes with no scopes when severity > off', () => {
    const a = analysis({
      routes: [
        { id: 'a', entry: '/p/a.tsx', scopes: [], keys: [] },
        { id: 'b', entry: '/p/b.tsx', scopes: ['b.idx'], keys: [k('b.idx.title')] },
      ],
    });
    const r = runStrictExtraction({
      analysis: a,
      rootDir: '/p',
      localesDir,
      defaultLocale: 'en',
      config: 'warn',
      defaultReportPath: '/tmp/r',
    });
    expect(r.summary.scopeRegistration.warn).toBe(1);
    expect(r.findings.find((f) => f.check === 'scopeRegistration')?.message).toMatch(/registers no scope/);
  });

  it('returns no findings when every route has at least one scope', () => {
    const a = analysis({
      routes: [{ id: 'a', entry: '/p/a.tsx', scopes: ['a.idx'], keys: [] }],
    });
    const r = runStrictExtraction({
      analysis: a,
      rootDir: '/p',
      localesDir,
      defaultLocale: 'en',
      config: 'error',
      defaultReportPath: '/tmp/r',
    });
    expect(r.summary.scopeRegistration.warn).toBe(0);
    expect(r.summary.scopeRegistration.error).toBe(0);
  });

  it('off mode skips the check entirely (even with violations)', () => {
    const a = analysis({
      routes: [{ id: 'a', entry: '/p/a.tsx', scopes: [], keys: [] }],
    });
    const r = runStrictExtraction({
      analysis: a,
      rootDir: '/p',
      localesDir,
      defaultLocale: 'en',
      config: { scopeRegistration: 'off' },
      defaultReportPath: '/tmp/r',
    });
    expect(r.findings.filter((f) => f.check === 'scopeRegistration')).toHaveLength(0);
  });
});

describe('runStrictExtraction: missingKeys check', () => {
  it('flags literal keys not present in any locale namespace', () => {
    writeLocale('shared.json', { ok: 'OK' });
    const a = analysis({
      routes: [{
        id: 'a',
        entry: '/p/a.tsx',
        scopes: ['shared.x'],
        keys: [k('shared.ok'), k('shared.totally.missing'), k('typo.in.namespace')],
      }],
    });
    const r = runStrictExtraction({
      analysis: a,
      rootDir: '/p',
      localesDir,
      defaultLocale: 'en',
      config: { missingKeys: 'error', scopeRegistration: 'off' },
      defaultReportPath: '/tmp/r',
    });
    expect(r.summary.missingKeys.error).toBe(2);
    expect(r.hasErrors).toBe(true);
  });

  it('skips dynamic keys (no static value to validate)', () => {
    writeLocale('shared.json', { ok: 'OK' });
    const a = analysis({
      routes: [{
        id: 'a',
        entry: '/p/a.tsx',
        scopes: ['shared.x'],
        keys: [k('shared.maybe.exists', /* dynamic */ true)],
      }],
    });
    const r = runStrictExtraction({
      analysis: a,
      rootDir: '/p',
      localesDir,
      defaultLocale: 'en',
      config: { missingKeys: 'error', scopeRegistration: 'off' },
      defaultReportPath: '/tmp/r',
    });
    expect(r.summary.missingKeys.error).toBe(0);
  });
});

describe('runStrictExtraction: unusedKeys check', () => {
  it('flags locale keys never referenced by any route', () => {
    writeLocale('shared.json', { ok: 'OK', unused: 'Never' });
    const a = analysis({
      routes: [{
        id: 'a',
        entry: '/p/a.tsx',
        scopes: ['shared.x'],
        keys: [k('shared.ok')],
      }],
    });
    const r = runStrictExtraction({
      analysis: a,
      rootDir: '/p',
      localesDir,
      defaultLocale: 'en',
      config: { unusedKeys: 'warn', scopeRegistration: 'off' },
      defaultReportPath: '/tmp/r',
    });
    expect(r.summary.unusedKeys.warn).toBe(1);
    expect(r.findings.find((f) => f.check === 'unusedKeys')?.details?.key).toBe('shared.unused');
  });
});

describe('runStrictExtraction: orphanDynamic check', () => {
  it('flags dynamicKeys that match neither route namespaces nor dictionaries', () => {
    const a = analysis({
      routes: [{ id: 'a', entry: '/p/a.tsx', scopes: ['cart.idx'], keys: [] }],
    });
    const r = runStrictExtraction({
      analysis: a,
      rootDir: '/p',
      localesDir,
      defaultLocale: 'en',
      dynamicKeys: ['cart.totals', 'orphaned.key', 'shared.something'],
      dictionaries: { global: { include: ['shared.*'] } },
      config: { orphanDynamic: 'error', scopeRegistration: 'off' },
      defaultReportPath: '/tmp/r',
    });
    // cart.totals → cart namespace covered by route. shared.something → owned by dict. orphaned.key → orphan.
    expect(r.summary.orphanDynamic.error).toBe(1);
    expect(r.findings.find((f) => f.check === 'orphanDynamic')?.details?.key).toBe('orphaned.key');
  });

  it('returns no findings when dynamicKeys is empty/undefined', () => {
    const a = analysis({ routes: [{ id: 'a', entry: '/p/a.tsx', scopes: ['x.y'], keys: [] }] });
    const r = runStrictExtraction({
      analysis: a,
      rootDir: '/p',
      localesDir,
      defaultLocale: 'en',
      config: { orphanDynamic: 'error', scopeRegistration: 'off' },
      defaultReportPath: '/tmp/r',
    });
    expect(r.summary.orphanDynamic.error).toBe(0);
  });
});

describe('runStrictExtraction: report aggregation', () => {
  it('aggregates findings across checks with correct severities', () => {
    writeLocale('shared.json', { ok: 'OK', leftover: 'X' });
    const a = analysis({
      routes: [
        { id: 'noscope', entry: '/p/n.tsx', scopes: [], keys: [] },
        { id: 'a', entry: '/p/a.tsx', scopes: ['shared.idx'], keys: [k('shared.missing')] },
      ],
    });
    const r = runStrictExtraction({
      analysis: a,
      rootDir: '/p',
      localesDir,
      defaultLocale: 'en',
      dynamicKeys: ['orphaned.dyn'],
      config: {
        mode: 'warn',
        scopeRegistration: 'error',
        missingKeys: 'error',
        unusedKeys: 'warn',
        orphanDynamic: 'warn',
      },
      defaultReportPath: '/tmp/r',
    });
    expect(r.summary.scopeRegistration.error).toBe(1);
    expect(r.summary.missingKeys.error).toBe(1);
    // Both `shared.ok` and `shared.leftover` are unused — the route only
    // references `shared.missing` (which itself is in missingKeys).
    expect(r.summary.unusedKeys.warn).toBe(2);
    expect(r.summary.orphanDynamic.warn).toBe(1);
    expect(r.hasErrors).toBe(true);
  });
});

describe('writeStrictExtractionReport', () => {
  it('writes a parseable JSON report at the given path', () => {
    const a = analysis({ routes: [{ id: 'a', entry: '/p/a.tsx', scopes: [], keys: [] }] });
    const r = runStrictExtraction({
      analysis: a,
      rootDir: '/p',
      localesDir,
      defaultLocale: 'en',
      config: 'warn',
      defaultReportPath: path.join(tmpDir, 'report.json'),
    });
    const out = path.join(tmpDir, 'report.json');
    writeStrictExtractionReport(out, r);

    const parsed = JSON.parse(fs.readFileSync(out, 'utf-8'));
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.summary.scopeRegistration.warn).toBe(1);
    expect(typeof parsed.writtenAt).toBe('string');
  });

  it('creates parent dirs on demand', () => {
    const a = analysis({ routes: [] });
    const r = runStrictExtraction({
      analysis: a,
      rootDir: '/p',
      localesDir,
      defaultLocale: 'en',
      config: 'off',
      defaultReportPath: path.join(tmpDir, 'a/b/c/report.json'),
    });
    writeStrictExtractionReport(path.join(tmpDir, 'a/b/c/report.json'), r);
    expect(fs.existsSync(path.join(tmpDir, 'a/b/c/report.json'))).toBe(true);
  });
});

describe('assertNoStrictExtractionErrors', () => {
  it('throws an aggregated Error when any finding has severity error', () => {
    const a = analysis({ routes: [{ id: 'a', entry: '/p/a.tsx', scopes: [], keys: [] }] });
    const r = runStrictExtraction({
      analysis: a,
      rootDir: '/p',
      localesDir,
      defaultLocale: 'en',
      config: 'error',
      defaultReportPath: '/tmp/r',
    });
    expect(() => assertNoStrictExtractionErrors(r)).toThrow(/strictExtraction failed/);
  });

  it('returns silently when only warns are present', () => {
    const a = analysis({ routes: [{ id: 'a', entry: '/p/a.tsx', scopes: [], keys: [] }] });
    const r = runStrictExtraction({
      analysis: a,
      rootDir: '/p',
      localesDir,
      defaultLocale: 'en',
      config: 'warn',
      defaultReportPath: '/tmp/r',
    });
    expect(() => assertNoStrictExtractionErrors(r)).not.toThrow();
  });
});
