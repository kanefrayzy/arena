import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'offline.html'],
      manifest: {
        name: 'Arena1v1 — Skill PvP',
        short_name: 'Arena1v1',
        description: 'Skill-based 1v1 PvP arena. Real money, pure skill.',
        theme_color: '#0b0d12',
        background_color: '#0b0d12',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'ru',
        categories: ['games', 'entertainment'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/ws/, /^\/uploads/],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // IMPORTANT: do NOT register any runtimeCaching rule for /api/.
        // A NetworkOnly handler still wraps every fetch and re-throws as
        // workbox "no-response" errors that flood the console when the
        // network is blocked (e.g. users on Russian ISPs without VPN).
        // With no rule, workbox stays out of the way and lets the browser
        // surface a normal TypeError that our app code already handles.
        runtimeCaching: [
          {
            urlPattern: /\/uploads\//,
            handler: 'NetworkFirst',
            options: { cacheName: 'arena-uploads', expiration: { maxEntries: 50, maxAgeSeconds: 24 * 60 * 60 } },
          },
          {
            urlPattern: /\.(?:js|css)$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'arena-static' },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|webp|woff2)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'arena-assets',
              expiration: { maxEntries: 80, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws/lobby': { target: 'ws://localhost:3000', ws: true },
      '/ws/match': { target: 'ws://localhost:3001', ws: true },
    },
  },
  optimizeDeps: {
    include: ['@arena/protocol', '@arena/shared', '@msgpack/msgpack'],
  },
  build: {
    commonjsOptions: {
      include: [/packages[\\/](protocol|shared)[\\/]/, /node_modules/],
      transformMixedEsModules: true,
    },
  },
});
