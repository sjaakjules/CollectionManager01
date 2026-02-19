import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Dev-only plugin: exposes POST /api/save-archetype-scores
 * to write edited scores back to the JSON file on disk.
 */
function archetypeScoresSaver(): Plugin {
  const jsonPath = resolve(__dirname, 'public/assets/sorcery_card_archetype_scores.json');

  return {
    name: 'archetype-scores-saver',
    configureServer(server) {
      server.middlewares.use('/api/save-archetype-scores', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const scores = JSON.parse(body);
            // Sort keys for stable diffs
            const sorted = Object.fromEntries(
              Object.entries(scores).sort(([a], [b]) => a.localeCompare(b))
            );
            writeFileSync(jsonPath, JSON.stringify(sorted, null, 2) + '\n');
            res.statusCode = 200;
            res.end('OK');
          } catch (err) {
            res.statusCode = 400;
            res.end(String(err));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), archetypeScoresSaver()],
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
      '/api/curiosa': {
        target: 'https://curiosa.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/curiosa/, ''),
        secure: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Origin', 'https://curiosa.io');
          });
        },
      },
    },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
  // Disable source maps for dependencies to avoid PixiJS shader warnings
  optimizeDeps: {
    esbuildOptions: {
      sourcemap: false,
    },
  },
});
