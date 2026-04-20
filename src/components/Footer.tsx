import { useI18n } from '../react/useI18n'

export function Footer() {
  const { t } = useI18n()

  return (
    <footer style={{ borderTop: '1px solid #e5e4e7', padding: '16px 24px', marginTop: 'auto', fontSize: 14, color: '#6b6375' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          {t('global.footer.madeWith', { framework: 'Vite + React' }, 'Made with {{framework}}')}
          {' | '}
          {t('global.footer.version', { version: '0.1.0' }, 'Version {{version}}')}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <a href="#privacy">{t('global.footer.privacy', 'Privacy')}</a>
          <a href="#terms">{t('global.footer.terms', 'Terms')}</a>
          <a href="#contact">{t('global.footer.contact', 'Contact')}</a>
        </div>
      </div>
      <div style={{ marginTop: 8, textAlign: 'center' }}>
        &copy; 2026 {t('global.appName', 'Store')} — {t('shared.copyright', 'All rights reserved')}
      </div>
    </footer>
  )
}
