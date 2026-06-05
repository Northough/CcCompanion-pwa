import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'CcCompanion',
        short_name: 'Cc',
        theme_color: '#d96d36',
        background_color: '#1a1a1a',
        display: 'standalone',
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/chat': 'http://localhost:8795',
      '/tmux': 'http://localhost:8795',
      '/favorites': 'http://localhost:8795',
      '/settings': 'http://localhost:8795',
      '/usage': 'http://localhost:8795',
      '/health': 'http://localhost:8795',
      '/attachments': 'http://localhost:8795',
      '/diag': 'http://localhost:8795',
      '/chain': 'http://localhost:8795',
      '/memory': 'http://localhost:8795',
      '/study': 'http://localhost:8795',
    },
  },
})
