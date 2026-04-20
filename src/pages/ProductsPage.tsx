import { useI18n } from '../react/useI18n'
import { SearchBar } from '../components/SearchBar'

const MOCK_PRODUCTS = [
  { id: 1, name: 'Wireless Headphones', price: 79.99, stock: 12 },
  { id: 2, name: 'USB-C Hub', price: 49.99, stock: 0 },
  { id: 3, name: 'Mechanical Keyboard', price: 129.99, stock: 5 },
]

export function ProductsPage() {
  const { t, ready } = useI18n('products.index')

  if (!ready) return <div>{t('shared.loading', 'Loading...')}</div>

  return (
    <div style={{ padding: 24 }}>
      <h1>{t('products.index.heading', 'All Products')}</h1>
    
      <p>{t('products.index.subheading', { count: MOCK_PRODUCTS.length }, 'Browse our collection of {{count}} items')}</p>

      <SearchBar />

      <div style={{ marginTop: 16, display: 'flex', gap: 8, fontSize: 14 }}>
        <span>{t('products.index.filters.category', 'Category')}</span>
        <span>{t('products.index.filters.priceRange', 'Price range')}</span>
        <span>{t('products.index.filters.inStock', 'In stock only')}</span>
        <button>{t('actions.clearFilters', 'Clear all filters')}</button>
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8, fontSize: 14 }}>
        <span>{t('actions.sortBy', { field: t('products.index.sort.popular', 'Most popular') }, 'Sort by {{field}}')}</span>
      </div>

      <ul style={{ marginTop: 16, listStyle: 'none', padding: 0 }}>
        {MOCK_PRODUCTS.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </ul>
    </div>
  )
}

function ProductCard({ product }: { product: { id: number; name: string; price: number; stock: number } }) {
  const { t } = useI18n()

  return (
    <li style={{ border: '1px solid #e5e4e7', borderRadius: 8, padding: 16, marginBottom: 8 }}>
      <h3>{product.name}</h3>
      <p>{t('products.show.price', { amount: product.price.toFixed(2) }, 'Price: {{amount}}')}</p>
      <p style={{ color: product.stock > 0 ? 'green' : 'red' }}>
        {product.stock > 0
          ? t('products.show.availability.inStock', { count: product.stock }, 'In stock — {{count}} remaining')
          : t('products.show.availability.outOfStock', 'Out of stock')
        }
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button disabled={product.stock === 0}>{t('actions.addToCart', 'Add to cart')}</button>
        <button>{t('actions.viewDetails', 'View details')}</button>
      </div>
    </li>
  )
}
