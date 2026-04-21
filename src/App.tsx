import { useState, useEffect } from 'react'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { ProductsPage } from './pages/ProductsPage'
import { CartPage } from './pages/CartPage'
import { AccountPage } from './pages/AccountPage'
import { useI18n } from './react/useI18n'
import { DevToolbar } from './react/DevToolbar'

function getPage() {
  return window.location.hash.slice(1) || 'products'
}

function App() {
  const [page, setPage] = useState(getPage)
  const { t } = useI18n()

  useEffect(() => {
    function onHashChange() {
      setPage(getPage())
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header />
      <main style={{ flex: 1 }}>
        {page === 'products' && <ProductsPage />}
        {page === 'cart' && <CartPage />}
        {page === 'account' && <AccountPage />}
        {!['products', 'cart', 'account'].includes(page) && (
          <div style={{ padding: 24 }}>
            <h1>{t('shared.error', 'Something went wrong')}</h1>
            <div></div>
            <a href="#products">{t('products.show.tabs.description', {  percent: 12}, 'Back to home')}</a>
  
          </div>
        )}
      </main>
      <Footer />
      <DevToolbar />
    </div>
  )
}

export default App
