import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Dev-only plugin: emulates the Netlify Function for archetype scores.
 * Handles GET and POST on /api/archetype-scores and the legacy /api/save-archetype-scores.
 */
function archetypeScoresDevApi(): Plugin {
  const jsonPath = resolve(__dirname, 'public/assets/sorcery_card_archetype_scores.json');

  function readScores(): Record<string, unknown> {
    return JSON.parse(readFileSync(jsonPath, 'utf-8'));
  }

  function writeScores(scores: Record<string, unknown>): void {
    const sorted = Object.fromEntries(
      Object.entries(scores).sort(([a], [b]) => a.localeCompare(b))
    );
    writeFileSync(jsonPath, JSON.stringify(sorted, null, 2) + '\n');
  }

  function readBody(req: import('http').IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => resolve(body));
    });
  }

  function jsonResponse(res: import('http').ServerResponse, status: number, data: unknown): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }

  return {
    name: 'archetype-scores-dev-api',
    configureServer(server) {
      // Main API endpoint (mirrors the Netlify Function)
      server.middlewares.use('/api/archetype-scores', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const action = url.searchParams.get('action');

        // GET — return the full scores JSON
        if (req.method === 'GET') {
          try {
            const scores = readScores();
            jsonResponse(res, 200, scores);
          } catch (err) {
            jsonResponse(res, 500, { error: String(err) });
          }
          return;
        }

        if (req.method === 'POST') {
          const body = await readBody(req);
          const payload = JSON.parse(body);

          if (action === 'update-score') {
            const { cardName, archetype, delta } = payload;
            const scores = readScores() as Record<string, Record<string, number>>;
            const cardScores = scores[cardName] as Record<string, number> ?? {};
            const current = cardScores[archetype] ?? 0;
            const next = current + delta;

            if (next === 0) {
              delete cardScores[archetype];
              if (Object.keys(cardScores).length === 0) {
                delete scores[cardName];
              } else {
                scores[cardName] = cardScores;
              }
            } else {
              scores[cardName] = { ...cardScores, [archetype]: next };
            }

            writeScores(scores);
            jsonResponse(res, 200, { ok: true, score: next });
            return;
          }

          if (action === 'add-category') {
            const { categoryName } = payload;
            const sanitized = categoryName
              .trim()
              .toLowerCase()
              .replace(/\s+/g, '_')
              .replace(/[^a-z0-9_]/g, '');

            if (!sanitized) {
              jsonResponse(res, 400, { error: 'Invalid category name' });
              return;
            }

            const scores = readScores() as Record<string, unknown> & { __meta?: { categories: string[] } };
            if (!scores.__meta) scores.__meta = { categories: [] };

            // Check for duplicates
            const existingFromData = new Set<string>();
            for (const [key, val] of Object.entries(scores)) {
              if (key === '__meta') continue;
              if (val && typeof val === 'object') {
                for (const arch of Object.keys(val as Record<string, unknown>)) {
                  existingFromData.add(arch);
                }
              }
            }

            if (scores.__meta.categories.includes(sanitized) || existingFromData.has(sanitized)) {
              jsonResponse(res, 409, { error: 'Category already exists', name: sanitized });
              return;
            }

            scores.__meta.categories.push(sanitized);
            writeScores(scores);
            jsonResponse(res, 200, { ok: true, name: sanitized });
            return;
          }

          if (action === 'save-full') {
            writeScores(payload);
            jsonResponse(res, 200, { ok: true });
            return;
          }

          jsonResponse(res, 400, { error: 'Unknown action' });
          return;
        }

        res.statusCode = 405;
        res.end('Method not allowed');
      });

      // Legacy endpoint (redirected to save-full on Netlify)
      server.middlewares.use('/api/save-archetype-scores', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        const body = await readBody(req);
        try {
          writeScores(JSON.parse(body));
          jsonResponse(res, 200, { ok: true });
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), archetypeScoresDevApi()],
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
