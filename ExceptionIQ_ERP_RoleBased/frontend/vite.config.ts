import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies /api to the Next.js backend, so the browser sees one origin (no CORS, no token leakage to other origins).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': { target: process.env.VITE_API_TARGET ?? 'http://localhost:3001', changeOrigin: true } } },
  preview: { proxy: { '/api': { target: process.env.VITE_API_TARGET ?? 'http://localhost:3001', changeOrigin: true } } },
});
