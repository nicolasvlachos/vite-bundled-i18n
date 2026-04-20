import { useI18n } from '../react/useI18n'

export function SearchBar() {
  const { t } = useI18n()

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        type="text"
        placeholder={t('shared.search', 'Search')}
        style={{ padding: '6px 12px', flex: 1 }}
      />
      <button>{t('shared.search', 'Search')}</button>
    </div>
  )
}
