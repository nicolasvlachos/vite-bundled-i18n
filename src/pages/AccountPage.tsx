import { useI18n } from '../react/useI18n'

const MOCK_ORDERS = [
  { number: '10042', date: '2026-04-10', status: 'delivered' as const },
  { number: '10039', date: '2026-03-28', status: 'shipped' as const },
  { number: '10035', date: '2026-03-15', status: 'cancelled' as const },
]

export function AccountPage() {
  const { t, ready } = useI18n('account')

  if (!ready) return <div>{t('shared.loading', 'Loading...')}</div>

  return (
    <div style={{ padding: 24 }}>
      <h1>{t('account.profile.heading', 'My Account')}</h1>

      <section style={{ marginBottom: 24 }}>
        <h2>{t('account.profile.personalInfo', 'Personal Information')}</h2>
        <ProfileForm />
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>{t('account.orders.heading', 'Order History')}</h2>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {MOCK_ORDERS.map((order) => (
            <OrderRow key={order.number} order={order} />
          ))}
        </ul>
      </section>

      <section>
        <h2>{t('account.addresses.heading', 'Saved Addresses')}</h2>
        <button>{t('account.addresses.addNew', 'Add new address')}</button>
      </section>
    </div>
  )
}

function ProfileForm() {
  const { t } = useI18n()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 400 }}>
      <label>
        {t('account.profile.name', 'Full name')}
        <input type="text" defaultValue="Nikola Vlachov" style={{ display: 'block', width: '100%', padding: '6px 12px' }} />
      </label>
      <label>
        {t('account.profile.email', 'Email address')}
        <input type="email" defaultValue="nikola@example.com" style={{ display: 'block', width: '100%', padding: '6px 12px' }} />
      </label>
      <label>
        {t('account.profile.phone', 'Phone number')}
        <input type="tel" defaultValue="+359 888 123 456" style={{ display: 'block', width: '100%', padding: '6px 12px' }} />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button>{t('actions.save', 'Save')}</button>
        <button>{t('shared.cancel', 'Cancel')}</button>
      </div>
    </div>
  )
}

function OrderRow({ order }: { order: { number: string; date: string; status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' } }) {
  const { t } = useI18n()

  const statusKey = `account.orders.status.${order.status}` as const

  return (
    <li style={{ border: '1px solid #e5e4e7', borderRadius: 8, padding: 16, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <strong>{t('account.orders.orderNumber', { number: order.number }, 'Order #{{number}}')}</strong>
        <p style={{ fontSize: 14, color: '#6b6375' }}>
          {t('account.orders.placedOn', { date: order.date }, 'Placed on {{date}}')}
        </p>
        <span>{t(statusKey, order.status)}</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {order.status === 'shipped' && (
          <button>{t('account.orders.trackOrder', 'Track order')}</button>
        )}
        {order.status === 'delivered' && (
          <button>{t('account.orders.reorder', 'Order again')}</button>
        )}
      </div>
    </li>
  )
}
