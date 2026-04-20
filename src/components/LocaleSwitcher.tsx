import { useI18n } from '../react/useI18n'
import { i18n } from '../i18n'

export function LocaleSwitcher() {
  const { locale } = useI18n()

  async function handleChange(newLocale: string) {
    await i18n.changeLocale(newLocale)
  }

  return (
    <select
      value={locale}
      onChange={(e) => handleChange(e.target.value)}
      style={{ padding: '4px 8px' }}
    >
      {i18n.config.supportedLocales.map((loc) => (
        <option key={loc} value={loc}>
          {loc.toUpperCase()}
        </option>
      ))}
    </select>
  )
}
