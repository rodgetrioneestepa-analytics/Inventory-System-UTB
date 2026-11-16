import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: resolve(import.meta.dirname, '../frontend'),
  build: { outDir: resolve(import.meta.dirname, '../dist/web'), emptyOutDir: true },
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3001' } },
});
