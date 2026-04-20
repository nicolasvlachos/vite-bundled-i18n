import { useState } from 'react'
import { useI18n } from '../react/useI18n'
import { ConfirmDialog } from '../components/ConfirmDialog'

const MOCK_CART = [
  { id: 1, name: 'Wireless Headphones', price: 79.99, quantity: 2 },
  { id: 3, name: 'Mechanical Keyboard', price: 129.99, quantity: 1 },
]

export function CartPage() {
  const { t, ready } = useI18n('cart')
  const [showConfirm, setShowConfirm] = useState(false)

  if (!ready) return <div>{t('shared.loading', 'Loading...')}</div>

  const subtotal = MOCK_CART.reduce((sum, item) => sum + item.price * item.quantity, 0)

  return (
    <div style={{ padding: 24 }}>
      <h1>{t('cart.title', 'Your Cart')}</h1>

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {MOCK_CART.map((item) => (
          <li key={item.id} style={{ border: '1px solid #e5e4e7', borderRadius: 8, padding: 16, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>{item.name}</strong>
              <p>{t('cart.item.quantity', { count: item.quantity }, 'Qty: {{count}}')}</p>
              <p>{t('cart.item.priceEach', { amount: item.price.toFixed(2) }, '{{amount}} each')}</p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowConfirm(true)}>
                {t('cart.item.remove', 'Remove')}
              </button>
              <button>{t('cart.item.moveToWishlist', 'Move to wishlist')}</button>
            </div>
          </li>
        ))}
      </ul>

      {showConfirm && (
        <ConfirmDialog
          message={t('cart.item.remove', 'Remove') + '?'}
          onConfirm={() => setShowConfirm(false)}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      <div style={{ marginTop: 16, padding: 16, background: '#fafafa', borderRadius: 8 }}>
        <PromoCodeInput />
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{t('cart.summary.subtotal', 'Subtotal')}</span>
            <span>${subtotal.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{t('cart.summary.shipping', 'Shipping')}</span>
            <span>{t('cart.summary.freeShipping', 'Free shipping')}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{t('cart.summary.tax', 'Tax')}</span>
            <span>${(subtotal * 0.2).toFixed(2)}</span>
          </div>
          <hr />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
            <span>{t('cart.summary.total', 'Total')}</span>
            <span>${(subtotal * 1.2).toFixed(2)}</span>
          </div>
          <p style={{ fontSize: 14, color: '#6b6375' }}>
            {t('cart.summary.estimatedDelivery', { date: '25 Apr 2026' }, 'Estimated delivery: {{date}}')}
          </p>
        </div>
        <button style={{ marginTop: 12, width: '100%' }}>{t('actions.checkout', 'Checkout')}</button>
      </div>
    </div>
  )
}

function PromoCodeInput() {
  const { t } = useI18n()

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        type="text"
        placeholder={t('cart.promoCode.placeholder', 'Enter code')}
        style={{ padding: '6px 12px', flex: 1 }}
      />
      <button>{t('cart.promoCode.apply', 'Apply')}</button>
    </div>
  )
}
