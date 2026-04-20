import { useI18n } from '../react/useI18n'
import { LocaleSwitcher } from './LocaleSwitcher'

export function Header() {
  const { t } = useI18n()

  return (
    <header style={{ borderBottom: '1px solid #e5e4e7', padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <strong>{t('global.appName', 'Store')}</strong>
        <nav style={{ display: 'flex', gap: 12 }}>
          <a href="#home">{t('global.nav.home', 'Home')}</a>
          <a href="#products">{t('global.nav.products', 'Products')}</a>
          <a href="#cart">{t('global.nav.cart', 'Cart')}</a>
          <a href="#account">{t('global.nav.account', 'Account')}</a>
        </nav>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <LocaleSwitcher />
        <button>{t('actions.signIn', 'Sign in')}</button>
      </div>
    </header>
  )
}
