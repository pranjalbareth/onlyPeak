import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png'],
      manifest: {
        name: 'OnlyPeak',
        short_name: 'OnlyPeak',
        description: 'Play only the best part of every song.',
        theme_color: '#10b981',
        background_color: '#09090b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: '/logo.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Never let the SPA navigation fallback hijack backend API calls.
        navigateFallbackDenylist: [/^\/api/],
        globPatterns: ['**/*.{js,css,html,png,svg}'],
      },
    }),
  ],
  server: {
    // Honor the PORT env var (e.g. assigned by the preview tooling); default to Vite's 5173.
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
