import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { i18nDevPlugin } from '../../plugin/devPlugin';

interface MockResponse {
  headers: Record<string, string>;
  body: string;
}

type WatchEvent = 'add' | 'change' | 'unlink';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-plugin-dev-'));
  fs.mkdirSync(path.join(tmpDir, 'locales/en'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'src/pages'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'src/components'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'public'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'locales/en/shared.json'),
    JSON.stringify({ ok: 'OK', loading: 'Loading...', secret: 'Classified' }),
  );
  fs.writeFileSync(
    path.join(tmpDir, 'locales/en/global.json'),
    JSON.stringify({ appName: 'Store' }),
  );
  fs.writeFileSync(
    path.join(tmpDir, 'locales/en/actions.json'),
    JSON.stringify({ save: 'Save' }),
  );
  fs.writeFileSync(
    path.join(tmpDir, 'locales/en/products.json'),
    JSON.stringify({ index: { heading: 'All Products' }, show: { title: 'Product Details' } }),
  );
  fs.writeFileSync(
    path.join(tmpDir, 'src/pages/ProductsPage.tsx'),
    [
      "import { useI18n } from 'vite-bundled-i18n/react';",
      "import { ProductCard } from '../components/ProductCard';",
      'export function ProductsPage() {',
      "  const { t } = useI18n('products.index');",
      "  return <section>{t('shared.ok')}<ProductCard />{t('shared.secret')}</section>;",
      '}',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(tmpDir, 'src/components/ProductCard.tsx'),
    [
      "import { t } from 'vite-bundled-i18n';",
      'export function ProductCard() {',
      "  return <article>{t('products.index.heading')}</article>;",
      '}',
    ].join('\n'),
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createPluginHarness(
  options?: Parameters<typeof i18nDevPlugin>[1],
  resolvedConfigOverrides?: {
    publicDir?: string | false;
  },
  configOverrides?: Partial<Parameters<typeof i18nDevPlugin>[0]>,
) {
  const plugin = i18nDevPlugin({
    localesDir: 'locales',
    dictionaries: {
      global: { include: ['shared.*', 'global.*', 'actions.*'], exclude: ['shared.secret'] },
    },
    ...configOverrides,
  }, options);

  const watcherHandlers: Record<WatchEvent, Array<(filePath: string) => void>> = {
    add: [],
    change: [],
    unlink: [],
  };
  const watcherAdd = vi.fn();
  const wsSend = vi.fn();
  const loggerWarn = vi.fn();
  const httpServerOnce = vi.fn();
  const closeHandlers: Array<() => void> = [];
  let middleware:
    | ((req: { url?: string }, res: { setHeader: (name: string, value: string) => void; end: (body: string) => void }, next: () => void) => void)
    | undefined;

  plugin.configResolved?.({
    root: tmpDir,
    publicDir: path.join(tmpDir, 'public'),
    logger: {
      warn: loggerWarn,
    },
    ...resolvedConfigOverrides,
  } as never);

  plugin.configureServer?.({
    watcher: {
      add: watcherAdd,
      on: vi.fn((event: WatchEvent, handler: (filePath: string) => void) => {
        watcherHandlers[event].push(handler);
      }),
    },
    ws: {
      send: wsSend,
    },
    httpServer: {
      once: httpServerOnce.mockImplementation((event: string, handler: () => void) => {
        if (event === 'close') {
          closeHandlers.push(handler);
        }
      }),
    },
    middlewares: {
      use(fn: typeof middleware) {
        middleware = fn;
      },
    },
  } as never);

  if (!middleware) {
    throw new Error('Expected dev middleware to be registered');
  }

  const publicDir = resolvedConfigOverrides?.publicDir === false
    ? path.join(tmpDir, 'public')
    : (resolvedConfigOverrides?.publicDir ?? path.join(tmpDir, 'public'));

  return {
    plugin,
    middleware,
    publicAssetsDir: path.join(publicDir, options?.assetsDir ?? '__i18n'),
    watcherAdd,
    wsSend,
    loggerWarn,
    httpServerOnce,
    close() {
      for (const handler of closeHandlers) {
        handler();
      }
    },
    trigger(event: WatchEvent, filePath: string) {
      for (const handler of watcherHandlers[event]) {
        handler(filePath);
      }
    },
  };
}

function runMiddleware(
  middleware: ReturnType<typeof createPluginHarness>['middleware'],
  url: string,
): { response: MockResponse; next: ReturnType<typeof vi.fn> } {
  const response: MockResponse = {
    headers: {},
    body: '',
  };
  const next = vi.fn();

  middleware(
    { url },
    {
      setHeader(name, value) {
        response.headers[name] = value;
      },
      end(body) {
        response.body = body;
      },
    },
    next,
  );

  return { response, next };
}

describe('i18nDevPlugin', () => {
  it('serves named dictionary bundles from /__i18n/{locale}/_dict/{name}.json', () => {
    const { middleware } = createPluginHarness();
    const { response, next } = runMiddleware(middleware, '/__i18n/en/_dict/global.json');

    expect(next).not.toHaveBeenCalled();
    expect(response.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(response.body)).toEqual({
      actions: { save: 'Save' },
      global: { appName: 'Store' },
      shared: { ok: 'OK', loading: 'Loading...', secret: 'Classified' },
    });
  });

  it('serves scope bundles from /__i18n/{locale}/{scope}.json', () => {
    const { middleware } = createPluginHarness();
    const { response, next } = runMiddleware(middleware, '/__i18n/en/products.index.json');

    expect(next).not.toHaveBeenCalled();
    expect(response.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(response.body)).toEqual({
      products: {
        index: { heading: 'All Products' },
        show: { title: 'Product Details' },
      },
    });
  });

  it('serves namespace-backed dev scope bundles from /__i18n/{locale}/_scope/{namespace}.json', () => {
    const { middleware } = createPluginHarness();
    const { response, next } = runMiddleware(middleware, '/__i18n/en/_scope/products.json');

    expect(next).not.toHaveBeenCalled();
    expect(response.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(response.body)).toEqual({
      products: {
        index: { heading: 'All Products' },
        show: { title: 'Product Details' },
      },
    });
  });

  it('includes cross-namespace extras in the scope bundle response when crossNamespacePacking is on', () => {
    // Add a vendors namespace + a giftcards.show page that references it.
    fs.writeFileSync(
      path.join(tmpDir, 'locales/en/vendors.json'),
      JSON.stringify({ compact: { name: 'Vendor' }, full: { bio: 'Bio' } }),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'locales/en/giftcards.json'),
      JSON.stringify({ show: { title: 'Gift card' } }),
    );
    fs.mkdirSync(path.join(tmpDir, 'src/pages/giftcards'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src/pages/giftcards/show.tsx'),
      [
        "import { useI18n } from 'vite-bundled-i18n/react';",
        'export function GiftcardShow() {',
        "  const { t } = useI18n('giftcards.show');",
        "  return <div>{t('giftcards.show.title')}{t('vendors.compact.name')}</div>;",
        '}',
      ].join('\n'),
    );

    const { middleware } = createPluginHarness(
      { pages: ['src/pages/**/*.tsx'], defaultLocale: 'en' },
      undefined,
      { bundling: { crossNamespacePacking: true } },
    );
    const { response, next } = runMiddleware(middleware, '/__i18n/en/giftcards.show.json');

    expect(next).not.toHaveBeenCalled();
    const body = JSON.parse(response.body);
    expect(body.giftcards).toEqual({ show: { title: 'Gift card' } });
    // Extras namespace is included (full data — dev doesn't tree-shake).
    expect(body.vendors).toEqual({ compact: { name: 'Vendor' }, full: { bio: 'Bio' } });
  });

  it('serves /__i18n/scope-map.json with page entries derived from pages glob', () => {
    const { middleware } = createPluginHarness({
      pages: ['src/pages/**/*.tsx'],
      defaultLocale: 'en',
    });
    const { response, next } = runMiddleware(middleware, '/__i18n/scope-map.json');

    expect(next).not.toHaveBeenCalled();
    expect(response.headers['Content-Type']).toBe('application/json');

    const map = JSON.parse(response.body);
    expect(map.version).toBe(1);
    expect(map.defaultLocale).toBe('en');
    // ProductsPage.tsx is in src/pages/ with no subdirectory — default
    // identifier strips the prefix and the .tsx, leaving 'ProductsPage'.
    expect(map.pages['ProductsPage']).toBeDefined();
    expect(map.pages['ProductsPage'].scopes).toContain('products.index');
    expect(map.pages['ProductsPage'].dictionaries).toEqual(['global']);
  });

  it('returns an empty scope-map when pages is not configured', () => {
    const { middleware } = createPluginHarness();
    const { response } = runMiddleware(middleware, '/__i18n/scope-map.json');

    const map = JSON.parse(response.body);
    expect(map.version).toBe(1);
    expect(map.pages).toEqual({});
  });

  it('applies bundling.dynamicKeys so dev-served scope-map matches production', () => {
    // Dev must match prod: declared dynamic keys should appear in the
    // dev-served /__i18n/scope-map.json scopes for any route whose primary
    // namespace matches the key's namespace.
    fs.writeFileSync(
      path.join(tmpDir, 'locales/en/status.json'),
      JSON.stringify({ active: 'Active', pending: 'Pending' }),
    );
    fs.mkdirSync(path.join(tmpDir, 'src/pages/status'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src/pages/status/index.tsx'),
      [
        "import { useI18n } from 'vite-bundled-i18n/react';",
        'export function StatusPage() {',
        "  const { t } = useI18n('status.dashboard');",
        "  return <div>{t.dynamic('status.' + 'active')}</div>;",
        '}',
      ].join('\n'),
    );

    const { middleware } = createPluginHarness(
      { pages: ['src/pages/**/*.tsx'], defaultLocale: 'en' },
      undefined,
      { bundling: { dynamicKeys: ['status.active', 'status.pending'] } },
    );
    const { response } = runMiddleware(middleware, '/__i18n/scope-map.json');

    const map = JSON.parse(response.body);
    // The status/index route registers status.dashboard — dynamic
    // status.* keys must have flowed through the route's key list so the
    // emitted map is consistent with what production would produce.
    expect(map.pages['status/index']).toBeDefined();
    expect(map.pages['status/index'].scopes).toContain('status.dashboard');
  });

  it('honors custom pageIdentifier in the dev response', () => {
    const { middleware } = createPluginHarness({
      pages: ['src/pages/**/*.tsx'],
      defaultLocale: 'en',
      pageIdentifier: (abs) => `custom:${path.basename(abs, '.tsx')}`,
    });
    const { response } = runMiddleware(middleware, '/__i18n/scope-map.json');

    const map = JSON.parse(response.body);
    expect(Object.keys(map.pages)).toEqual(['custom:ProductsPage']);
  });

  it('transform hook returns null for source files and rejects irrelevant ids', () => {
    const { plugin } = createPluginHarness(
      { pages: ['src/pages/**/*.tsx'], defaultLocale: 'en', cache: true },
    );

    const transformFn = (plugin as unknown as {
      transform?: (code: string, id: string) => unknown;
    }).transform;
    expect(typeof transformFn).toBe('function');

    // Source file — returns null (never modifies code).
    const srcPath = path.join(tmpDir, 'src/pages/ProductsPage.tsx');
    expect(transformFn!.call(plugin, fs.readFileSync(srcPath, 'utf-8'), srcPath)).toBeNull();

    // Virtual module — short-circuits without reading from disk.
    expect(transformFn!.call(plugin, '', '\0virtual:i18n')).toBeNull();

    // node_modules — rejected by the fast-path filter.
    expect(transformFn!.call(plugin, '', path.join(tmpDir, 'node_modules', 'react', 'index.js'))).toBeNull();

    // Non-JS asset — rejected.
    expect(transformFn!.call(plugin, 'body { color: red }', path.join(tmpDir, 'src/styles.css'))).toBeNull();
  });

  it('does not inline extras into scope bundle responses when crossNamespacePacking is off', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'locales/en/vendors.json'),
      JSON.stringify({ compact: { name: 'Vendor' } }),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'locales/en/giftcards.json'),
      JSON.stringify({ show: { title: 'Gift card' } }),
    );
    fs.mkdirSync(path.join(tmpDir, 'src/pages/giftcards'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src/pages/giftcards/show.tsx'),
      [
        "import { useI18n } from 'vite-bundled-i18n/react';",
        'export function GiftcardShow() {',
        "  const { t } = useI18n('giftcards.show');",
        "  return <div>{t('vendors.compact.name')}</div>;",
        '}',
      ].join('\n'),
    );

    const { middleware } = createPluginHarness({
      pages: ['src/pages/**/*.tsx'],
      defaultLocale: 'en',
    });
    const { response } = runMiddleware(middleware, '/__i18n/en/giftcards.show.json');

    const body = JSON.parse(response.body);
    expect(body.giftcards).toBeDefined();
    expect(body.vendors).toBeUndefined();
  });

  it('handles query strings on i18n asset requests', () => {
    const { middleware } = createPluginHarness();
    const { response, next } = runMiddleware(middleware, '/__i18n/en/_dict/global.json?v=1');

    expect(next).not.toHaveBeenCalled();
    expect(JSON.parse(response.body)).toEqual({
      actions: { save: 'Save' },
      global: { appName: 'Store' },
      shared: { ok: 'OK', loading: 'Loading...', secret: 'Classified' },
    });
  });

  it('falls through for non-i18n requests', () => {
    const { middleware } = createPluginHarness();
    const { response, next } = runMiddleware(middleware, '/api/health');

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.body).toBe('');
  });

  it('serves dev route diagnostics from /__i18n/__dev/analysis.json', () => {
    const { middleware } = createPluginHarness({
      pages: ['src/pages/**/*.tsx'],
      defaultLocale: 'en',
    });
    const { response, next } = runMiddleware(middleware, '/__i18n/__dev/analysis.json');

    expect(next).not.toHaveBeenCalled();
    expect(response.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(response.body) as {
      available: boolean;
      routes: Array<{
        routeId: string;
        files: string[];
        dictionaryOwnedKeys: string[];
        explicitlyExcludedKeys: string[];
      }>;
    };

    expect(body.available).toBe(true);
    expect(body.routes).toHaveLength(1);
    expect(body.routes[0].routeId).toBe('ProductsPage');
    expect(body.routes[0].files.some((file) => file.endsWith('src/pages/ProductsPage.tsx'))).toBe(true);
    expect(body.routes[0].files.some((file) => file.endsWith('src/components/ProductCard.tsx'))).toBe(true);
    expect(body.routes[0].dictionaryOwnedKeys).toContain('shared.ok');
    expect(body.routes[0].explicitlyExcludedKeys).toContain('shared.secret');
  });

  it('emits dev bundles into public/__i18n for Laravel sidecar setups', () => {
    const harness = createPluginHarness({
      pages: ['src/pages/**/*.tsx'],
      defaultLocale: 'en',
      emitPublicAssets: true,
    }, {
      publicDir: false,
    });

    expect(harness.loggerWarn).not.toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(path.join(harness.publicAssetsDir, 'en/_dict/global.json'), 'utf-8'))).toEqual({
      actions: { save: 'Save' },
      global: { appName: 'Store' },
      shared: { ok: 'OK', loading: 'Loading...', secret: 'Classified' },
    });
    expect(JSON.parse(fs.readFileSync(path.join(harness.publicAssetsDir, 'en/_scope/products.json'), 'utf-8'))).toEqual({
      products: {
        index: { heading: 'All Products' },
        show: { title: 'Product Details' },
      },
    });

    const diagnostics = JSON.parse(fs.readFileSync(path.join(harness.publicAssetsDir, '__dev/analysis.json'), 'utf-8')) as {
      available: boolean;
      message?: string;
    };
    expect(diagnostics.available).toBe(false);
    expect(diagnostics.message).toContain('on demand');
  });

  it('refreshes emitted public bundles when locale files change', () => {
    const harness = createPluginHarness({
      pages: ['src/pages/**/*.tsx'],
      defaultLocale: 'en',
      emitPublicAssets: true,
    }, {
      publicDir: false,
    });

    fs.writeFileSync(
      path.join(tmpDir, 'locales/en/products.json'),
      JSON.stringify({ index: { heading: 'Updated Products' }, show: { title: 'Product Details' } }),
    );
    harness.trigger('change', path.join(tmpDir, 'locales/en/products.json'));

    expect(JSON.parse(fs.readFileSync(path.join(harness.publicAssetsDir, 'en/_scope/products.json'), 'utf-8'))).toEqual({
      products: {
        index: { heading: 'Updated Products' },
        show: { title: 'Product Details' },
      },
    });
    expect(harness.wsSend).toHaveBeenCalledWith({
      type: 'custom',
      event: 'vite-bundled-i18n:resources-updated',
      data: expect.objectContaining({
        locales: ['en'],
        reason: 'locale',
        changedFile: path.join(tmpDir, 'locales/en/products.json'),
      }),
    });
  });

  it('ignores source file changes because dev assets depend only on locale files', () => {
    const harness = createPluginHarness({
      pages: ['src/pages/**/*.tsx'],
      defaultLocale: 'en',
      emitPublicAssets: true,
    }, {
      publicDir: false,
    });

    fs.writeFileSync(
      path.join(tmpDir, 'src/pages/ProductsPage.tsx'),
      [
        "import { useI18n } from 'vite-bundled-i18n/react';",
        "import { ProductCard } from '../components/ProductCard';",
        'export function ProductsPage() {',
        "  const { t } = useI18n('products.show');",
        "  return <section>{t('shared.ok')}<ProductCard />{t('shared.secret')}</section>;",
        '}',
      ].join('\n'),
    );

    harness.trigger('change', path.join(tmpDir, 'src/pages/ProductsPage.tsx'));

    expect(fs.existsSync(path.join(harness.publicAssetsDir, 'en/_scope/products.json'))).toBe(true);
    expect(harness.wsSend).not.toHaveBeenCalled();
  });

  it('ignores changes to the generated types file to avoid self-trigger loops', () => {
    const harness = createPluginHarness({
      pages: ['src/pages/**/*.tsx'],
      defaultLocale: 'en',
    });

    const generatedTypesPath = path.join(tmpDir, '.i18n', 'i18n-generated.ts');
    expect(fs.existsSync(generatedTypesPath)).toBe(true);

    harness.trigger('change', generatedTypesPath);

    expect(harness.wsSend).not.toHaveBeenCalled();
  });

  it('cleans emitted public bundles on dev server shutdown', () => {
    const harness = createPluginHarness({
      pages: ['src/pages/**/*.tsx'],
      defaultLocale: 'en',
      emitPublicAssets: true,
    }, {
      publicDir: false,
    });

    expect(fs.existsSync(path.join(harness.publicAssetsDir, 'en/_scope/products.json'))).toBe(true);

    harness.close();

    expect(fs.existsSync(path.join(harness.publicAssetsDir, 'en/_scope/products.json'))).toBe(false);
    expect(fs.existsSync(path.join(harness.publicAssetsDir, 'en/_dict/global.json'))).toBe(false);
    expect(fs.existsSync(harness.publicAssetsDir)).toBe(false);
  });
});
