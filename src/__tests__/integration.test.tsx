/**
 * Integration tests for the full translation flow.
 *
 * Tests the complete path: createI18n → I18nProvider → useI18n → t()
 * with mocked fetch simulating the dev plugin's bundle responses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createI18n } from '../core/createI18n';
import { I18nProvider } from '../react/I18nProvider';
import { useI18n } from '../react/useI18n';


// -- Mock data simulating what the dev plugin would serve --

const EN_DICT_GLOBAL = {
  shared: { ok: 'OK', cancel: 'Cancel', loading: 'Loading...', error: 'Something went wrong' },
  global: { appName: 'Vite Store', nav: { home: 'Home', products: 'Products', cart: 'Cart' } },
  actions: { save: 'Save', addToCart: 'Add to cart', sortBy: 'Sort by {{field}}' },
};

const BG_DICT_GLOBAL = {
  shared: { ok: 'Добре', cancel: 'Отказ', loading: 'Зареждане...', error: 'Нещо се обърка' },
  global: { appName: 'Vite Магазин', nav: { home: 'Начало', products: 'Продукти', cart: 'Количка' } },
  actions: { save: 'Запази', addToCart: 'Добави в количката', sortBy: 'Сортирай по {{field}}' },
};

const EN_PRODUCTS = {
  products: {
    show: { title: 'Product Details', price: 'Price: {{amount}}' },
    index: { heading: 'All Products', subheading: 'Browse {{count}} items' },
  },
};

const BG_PRODUCTS = {
  products: {
    show: { title: 'Детайли за продукта', price: 'Цена: {{amount}}' },
    index: { heading: 'Всички продукти', subheading: 'Разгледайте {{count}} артикула' },
  },
};

const EN_CART = {
  cart: {
    title: 'Your Cart',
    summary: { total: 'Total', freeShipping: 'Free shipping' },
  },
};

const BG_CART = {
  cart: {
    title: 'Вашата количка',
    summary: { total: 'Общо', freeShipping: 'Безплатна доставка' },
  },
};

// -- Helpers --

function mockFetch() {
  return vi.fn((url: string | URL | Request) => {
    const urlStr = String(url);

    // Dictionary bundles
    if (urlStr.includes('en/_dict/global')) return respond(EN_DICT_GLOBAL);
    if (urlStr.includes('bg/_dict/global')) return respond(BG_DICT_GLOBAL);

    // Scope bundles
    if (urlStr.includes('en/products')) return respond(EN_PRODUCTS);
    if (urlStr.includes('bg/products')) return respond(BG_PRODUCTS);
    if (urlStr.includes('en/cart')) return respond(EN_CART);
    if (urlStr.includes('bg/cart')) return respond(BG_CART);

    return Promise.reject(new Error(`Unmocked URL: ${urlStr}`));
  }) as typeof globalThis.fetch;
}

function respond(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  } as Response);
}

function createTestInstance() {
  return createI18n({
    locale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'bg'],
    localesDir: '/locales',
    dictionaries: {
      global: { keys: ['shared', 'global', 'actions'] },
    },
  });
}

// -- Test components --

function Header() {
  const { t, locale } = useI18n();
  return (
    <header>
      <span data-testid="app-name">{t('global.appName', 'Store')}</span>
      <span data-testid="nav-home">{t('global.nav.home', 'Home')}</span>
      <span data-testid="nav-products">{t('global.nav.products', 'Products')}</span>
      <span data-testid="locale">{locale}</span>
    </header>
  );
}

function Footer() {
  const { t } = useI18n();
  return (
    <footer>
      <span data-testid="ok-btn">{t('shared.ok', 'OK')}</span>
      <span data-testid="cancel-btn">{t('shared.cancel', 'Cancel')}</span>
      <span data-testid="sort">{t('actions.sortBy', { field: 'price' }, 'Sort by {{field}}')}</span>
    </footer>
  );
}

function ProductsPage() {
  const { t, ready } = useI18n('products.index');
  if (!ready) return <span data-testid="products-loading">loading</span>;
  return (
    <div>
      <span data-testid="products-heading">{t('products.index.heading', 'All Products')}</span>
      <span data-testid="products-sub">{t('products.index.subheading', { count: 5 }, 'Browse {{count}} items')}</span>
      <span data-testid="products-price">{t('products.show.price', { amount: 29.99 }, 'Price: {{amount}}')}</span>
      {/* Dictionary keys work inside scoped components */}
      <span data-testid="products-add">{t('actions.addToCart', 'Add to cart')}</span>
    </div>
  );
}

function CartPage() {
  const { t, ready } = useI18n('cart');
  if (!ready) return <span data-testid="cart-loading">loading</span>;
  return (
    <div>
      <span data-testid="cart-title">{t('cart.title', 'Your Cart')}</span>
      <span data-testid="cart-total">{t('cart.summary.total', 'Total')}</span>
      <span data-testid="cart-shipping">{t('cart.summary.freeShipping', 'Free shipping')}</span>
    </div>
  );
}

function NestedButton() {
  const { t } = useI18n();
  return <button data-testid="nested-save">{t('actions.save', 'Save')}</button>;
}

function DeepProductMeta() {
  const { t } = useI18n();
  return (
    <div>
      <span data-testid="deep-price">
        {t('products.show.price', { amount: 9.99 }, 'Price: {{amount}}')}
      </span>
      <span data-testid="deep-ok">{t('shared.ok', 'OK')}</span>
    </div>
  );
}

function SectionFrame({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section>
      <h2 data-testid="section-title">{t('products.index.heading', 'All Products')}</h2>
      {children}
    </section>
  );
}

function ContentShell({ children }: { children: ReactNode }) {
  return <div data-testid="content-shell">{children}</div>;
}

function MultiNestedProductsPage() {
  const { ready } = useI18n('products.index');
  if (!ready) return <span data-testid="multi-loading">loading</span>;

  return (
    <ContentShell>
      <SectionFrame>
        <DeepProductMeta />
        <NestedButton />
      </SectionFrame>
    </ContentShell>
  );
}

// -- Tests --

describe('Integration: full translation flow', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('loads dictionaries and renders layout components', async () => {
    const i18n = createTestInstance();

    render(
      <I18nProvider instance={i18n}>
        <Header />
        <Footer />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('app-name').textContent).toBe('Vite Store');
    });

    expect(screen.getByTestId('nav-home').textContent).toBe('Home');
    expect(screen.getByTestId('nav-products').textContent).toBe('Products');
    expect(screen.getByTestId('ok-btn').textContent).toBe('OK');
    expect(screen.getByTestId('cancel-btn').textContent).toBe('Cancel');
    expect(screen.getByTestId('sort').textContent).toBe('Sort by price');
    expect(screen.getByTestId('locale').textContent).toBe('en');

    // Should have fetched dictionary bundle — one request
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith('/__i18n/en/_dict/global.json');
  });

  it('loads scope bundle and renders page with dictionary + scope keys', async () => {
    const i18n = createTestInstance();

    render(
      <I18nProvider instance={i18n}>
        <ProductsPage />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('products-heading').textContent).toBe('All Products');
    });

    expect(screen.getByTestId('products-sub').textContent).toBe('Browse 5 items');
    expect(screen.getByTestId('products-price').textContent).toBe('Price: 29.99');
    expect(screen.getByTestId('products-add').textContent).toBe('Add to cart');

    // Two requests: dictionary bundle + scope bundle
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenCalledWith('/__i18n/en/_dict/global.json');
    expect(globalThis.fetch).toHaveBeenCalledWith('/__i18n/en/products.index.json');
  });

  it('nested components access dictionary keys without a scope', async () => {
    const i18n = createTestInstance();

    render(
      <I18nProvider instance={i18n}>
        <ProductsPage />
        <NestedButton />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('nested-save').textContent).toBe('Save');
    });
  });

  it('switches locale — loads all bundles for new locale before re-rendering', async () => {
    const i18n = createTestInstance();

    render(
      <I18nProvider instance={i18n}>
        <Header />
        <ProductsPage />
      </I18nProvider>,
    );

    // Wait for English to load
    await waitFor(() => {
      expect(screen.getByTestId('app-name').textContent).toBe('Vite Store');
      expect(screen.getByTestId('products-heading').textContent).toBe('All Products');
    });

    // Switch to Bulgarian
    await act(async () => {
      await i18n.changeLocale('bg');
    });

    // Everything should be in Bulgarian now
    expect(screen.getByTestId('app-name').textContent).toBe('Vite Магазин');
    expect(screen.getByTestId('nav-home').textContent).toBe('Начало');
    expect(screen.getByTestId('nav-products').textContent).toBe('Продукти');
    expect(screen.getByTestId('locale').textContent).toBe('bg');
    expect(screen.getByTestId('products-heading').textContent).toBe('Всички продукти');
    expect(screen.getByTestId('products-sub').textContent).toBe('Разгледайте 5 артикула');
  });

  it('fallback chain works: missing key in locale → defaultLocale → fallback string', async () => {
    const i18n = createTestInstance();

    // Load English dictionaries
    await i18n.loadAllDictionaries('en');

    // Add partial Bulgarian — missing "cancel"
    i18n.addResources('bg', 'shared', { ok: 'Добре' });

    // Key exists in bg
    expect(i18n.translate('bg', 'shared.ok')).toBe('Добре');

    // Key missing in bg, falls back to en
    expect(i18n.translate('bg', 'shared.cancel')).toBe('Cancel');

    // Key missing everywhere, uses fallback string
    expect(i18n.translate('bg', 'shared.nonexistent', undefined, 'Fallback')).toBe('Fallback');

    // Key missing everywhere, no fallback, returns key
    expect(i18n.translate('bg', 'shared.nonexistent')).toBe('shared.nonexistent');
  });

  it('key usage tracking records all resolutions', async () => {
    const i18n = createTestInstance();

    // Load dictionaries
    await i18n.loadAllDictionaries('en');

    // Make some translations
    i18n.translate('en', 'shared.ok');
    i18n.translate('en', 'shared.missing', undefined, 'Fallback');
    i18n.translate('en', 'totally.missing');

    // Add partial bg and test fallback-locale
    i18n.addResources('bg', 'shared', {});
    i18n.translate('bg', 'shared.ok'); // falls back to en

    const usage = i18n.getKeyUsage();

    expect(usage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'shared.ok', locale: 'en', resolvedFrom: 'primary' }),
        expect.objectContaining({ key: 'shared.missing', locale: 'en', resolvedFrom: 'fallback-string' }),
        expect.objectContaining({ key: 'totally.missing', locale: 'en', resolvedFrom: 'key-as-value' }),
        expect.objectContaining({ key: 'shared.ok', locale: 'bg', resolvedFrom: 'fallback-locale' }),
      ]),
    );
  });

  it('multiple pages load independent scope bundles', async () => {
    const i18n = createTestInstance();

    const { unmount } = render(
      <I18nProvider instance={i18n}>
        <ProductsPage />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('products-heading').textContent).toBe('All Products');
    });

    unmount();

    render(
      <I18nProvider instance={i18n}>
        <CartPage />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('cart-title').textContent).toBe('Your Cart');
    });

    expect(screen.getByTestId('cart-total').textContent).toBe('Total');
    expect(screen.getByTestId('cart-shipping').textContent).toBe('Free shipping');
  });

  it('interpolation works in all contexts', async () => {
    const i18n = createTestInstance();

    render(
      <I18nProvider instance={i18n}>
        <Footer />
        <ProductsPage />
      </I18nProvider>,
    );

    await waitFor(() => {
      // Interpolation in dictionary key
      expect(screen.getByTestId('sort').textContent).toBe('Sort by price');
      // Interpolation in scope key
      expect(screen.getByTestId('products-sub').textContent).toBe('Browse 5 items');
      expect(screen.getByTestId('products-price').textContent).toBe('Price: 29.99');
    });
  });

  it('multi-nested wrapper trees can resolve both scope and dictionary keys after one scope load', async () => {
    const i18n = createTestInstance();

    render(
      <I18nProvider instance={i18n}>
        <MultiNestedProductsPage />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('section-title').textContent).toBe('All Products');
    });

    expect(screen.getByTestId('deep-price').textContent).toBe('Price: 9.99');
    expect(screen.getByTestId('deep-ok').textContent).toBe('OK');
    expect(screen.getByTestId('nested-save').textContent).toBe('Save');

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenCalledWith('/__i18n/en/_dict/global.json');
    expect(globalThis.fetch).toHaveBeenCalledWith('/__i18n/en/products.index.json');
  });
});
