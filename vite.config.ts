import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        // Enable service worker in dev so offline behaviour is testable locally
        devOptions: { enabled: true, type: 'module' },
        workbox: {
          // Cache all app shell assets
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          // Never intercept WebSocket upgrades or the Socket.io handshake
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              // API calls: try network first, fall back to cache
              urlPattern: /^\/api\//,
              handler: 'NetworkFirst',
              options: { cacheName: 'beacon-api', networkTimeoutSeconds: 4 },
            },
          ],
        },
        manifest: {
          name: 'Beacon Mesh',
          short_name: 'Beacon',
          description: 'Offline-first peer-to-peer emergency mesh communications',
          theme_color: '#000000',
          background_color: '#000000',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [],
        },
      }),
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
