import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    open: process.env.BROWSER === 'safari' ? 'Safari' : false,
    fs: {
      strict: false,
    },
    // Proxy API requests to avoid CORS issues during development
    proxy: {
      '/api/sorcery': {
        target: 'https://api.sorcerytcg.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/sorcery/, '/api'),
        secure: true,
      },
    },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
});
