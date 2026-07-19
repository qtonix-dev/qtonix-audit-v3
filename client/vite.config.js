import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The frontend calls the API at /api and /uploads. In dev we proxy those to the
// Node server on :4000. In production (Vercel), set VITE_API_BASE to the Railway
// URL — see .env.production and client/src/config.js.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist' },
});
