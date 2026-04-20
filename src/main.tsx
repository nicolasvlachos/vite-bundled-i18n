import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { I18nProvider } from './react/I18nProvider'
import { i18n } from './i18n'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider instance={i18n}>
      <App />
    </I18nProvider>
  </StrictMode>,
)
