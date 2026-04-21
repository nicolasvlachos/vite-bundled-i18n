import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { i18nPlugin } from './src/plugin'
import { i18nConfig } from './src/i18n.config'

// https://vite.dev/config/
export default defineConfig({
  build: {
    outDir: 'demo-dist',
  },
  plugins: [
    react(),
    i18nPlugin(i18nConfig, {
      pages: ['src/pages/**/*.tsx'],
      locales: ['en', 'bg'],
      defaultLocale: 'en',
      generatedOutDir: '.i18n',
      extractionScope: 'global',
    }),
  ],
})
