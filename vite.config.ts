import { defineConfig } from 'vite';

const SERVER_ORIGIN = 'http://127.0.0.1:3333';

/**
 * Dev: Vite serves the SPA; Mist API and WebSocket hub run on JUNOS_CONSOLE_SERVER_PORT (default 3333).
 */
export default defineConfig({
  root: '.',
  /** Keep Vite logs visible when running next to the Node server (concurrently). */
  clearScreen: false,
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: './index.html',
        support: './support.html',
      },
    },
  },
  server: {
    // Bind all interfaces so http://127.0.0.1:3000 and http://localhost:3000 both work (avoids some IPv6/localhost mismatches on macOS).
    host: true,
    port: 3000,
    strictPort: true,
    open: '/index.html',
    proxy: {
      '/mist-proxy': {
        target: SERVER_ORIGIN,
        changeOrigin: true,
      },
      '/ws': {
        target: SERVER_ORIGIN,
        ws: true,
      },
    },
  },
  preview: {
    port: 3000,
    proxy: {
      '/mist-proxy': {
        target: SERVER_ORIGIN,
        changeOrigin: true,
      },
      '/ws': {
        target: SERVER_ORIGIN,
        ws: true,
      },
    },
  },
});
