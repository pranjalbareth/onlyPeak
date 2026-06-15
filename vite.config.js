import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'

// Set HTTPS=true to serve the dev server over HTTPS with a self-signed cert.
// Needed only to TEST on a phone over the LAN: YouTube refuses to play its embed
// on a non-secure context (plain http:// on a raw IP), so http://<LAN-IP> shows
// "Video Unavailable". localhost is exempt (a secure context), which is why
// desktop works without this. Production (Vercel) is HTTPS, so this is dev-only.
const useHttps = process.env.HTTPS === 'true'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    useHttps && basicSsl(),
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
        // Precache the app shell (JS/CSS/HTML/icons) so the installed PWA opens
        // instantly. Playback streams from the YouTube IFrame player at runtime.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
        // Offline navigations fall back to the cached app shell.
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: {
    // Honor the PORT env var (e.g. assigned by the preview tooling); default to
    // 5180 (5173 falls in a Windows reserved/excluded port range on some hosts).
    port: Number(process.env.PORT) || 5180,
  },
})
