import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

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

/**
 * Dev-only plugin: emulates signup/login and per-user data APIs.
 */
function authUserDevApi(): Plugin {
  const dbPath = resolve(__dirname, 'tmp/dev-user-auth.json');

  interface DevAccountRecord {
    userId: string;
    username: string;
    usernameNormalized: string;
    passwordHash: string;
    salt: string;
    createdAt: string;
  }

  interface DevSessionRecord {
    userId: string;
    username: string;
    expiresAt: number;
  }

  interface DevDb {
    accounts: Record<string, DevAccountRecord>;
    userData: Record<string, Record<string, unknown>>;
    sessions: Record<string, DevSessionRecord>;
  }

  const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
  const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;

  function emptyDb(): DevDb {
    return { accounts: {}, userData: {}, sessions: {} };
  }

  function readDb(): DevDb {
    if (!existsSync(dbPath)) return emptyDb();
    try {
      return JSON.parse(readFileSync(dbPath, 'utf-8')) as DevDb;
    } catch {
      return emptyDb();
    }
  }

  function writeDb(db: DevDb): void {
    mkdirSync(dirname(dbPath), { recursive: true });
    writeFileSync(dbPath, JSON.stringify(db, null, 2) + '\n');
  }

  function hashPassword(password: string, salt: string): string {
    return createHash('sha256').update(`${salt}:${password}`).digest('hex');
  }

  function normalizeUsername(username: string): string {
    return username.trim().toLowerCase();
  }

  function readBody(req: import('http').IncomingMessage): Promise<string> {
    return new Promise((resolveBody) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => resolveBody(body));
    });
  }

  function jsonResponse(
    res: import('http').ServerResponse,
    status: number,
    data: unknown
  ): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }

  function getSessionFromAuthHeader(
    authHeader: string | undefined,
    db: DevDb
  ): DevSessionRecord | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice('Bearer '.length).trim();
    const session = db.sessions[token];
    if (!session) return null;
    if (session.expiresAt <= Date.now()) return null;
    return session;
  }

  function sanitizeUserData(
    payload: Record<string, unknown>,
    userId: string,
    username: string
  ): Record<string, unknown> {
    const decks = Array.isArray(payload.decks) ? payload.decks : [];
    const collection = Array.isArray(payload.collection) ? payload.collection : [];
    const selectedArchetype =
      typeof payload.selectedArchetype === 'string' || payload.selectedArchetype === null
        ? payload.selectedArchetype
        : null;
    const archetypeScores =
      payload.archetypeScores && typeof payload.archetypeScores === 'object'
        ? payload.archetypeScores
        : undefined;
    const canvasLabels = Array.isArray(payload.canvasLabels)
      ? payload.canvasLabels.filter((label) => {
          if (!label || typeof label !== 'object') return false;
          const obj = label as Record<string, unknown>;
          return (
            typeof obj.id === 'string' &&
            typeof obj.text === 'string' &&
            typeof obj.x === 'number' &&
            Number.isFinite(obj.x) &&
            typeof obj.y === 'number' &&
            Number.isFinite(obj.y)
          );
        })
      : [];
    const canvasAreas = Array.isArray(payload.canvasAreas)
      ? payload.canvasAreas.filter((area) => {
          if (!area || typeof area !== 'object' || Array.isArray(area)) return false;
          const obj = area as Record<string, unknown>;
          return (
            typeof obj.id === 'string' &&
            typeof obj.name === 'string' &&
            (obj.type === 'stack' || obj.type === 'deck')
          );
        })
      : [];

    return {
      name: username,
      id: userId,
      decks,
      collection,
      selectedArchetype,
      archetypeScores,
      canvasLabels,
      canvasAreas,
    };
  }

  return {
    name: 'auth-user-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/signup', async (req, res) => {
        if (req.method !== 'POST') {
          jsonResponse(res, 405, { message: 'Method not allowed' });
          return;
        }

        let payload: { username?: string; password?: string };
        try {
          payload = JSON.parse(await readBody(req)) as {
            username?: string;
            password?: string;
          };
        } catch {
          jsonResponse(res, 400, { message: 'Invalid request body' });
          return;
        }

        const username = payload.username?.trim() ?? '';
        const password = payload.password ?? '';
        const normalized = normalizeUsername(username);

        if (!USERNAME_RE.test(username) || password.length < 6 || normalized === 'guest') {
          jsonResponse(res, 400, {
            message:
              'Username must be 3-24 letters/numbers/underscore and password must be at least 6 characters',
          });
          return;
        }

        const db = readDb();

        if (db.accounts[normalized]) {
          jsonResponse(res, 409, { message: 'Username already exists' });
          return;
        }

        const userId = randomUUID();
        const salt = randomBytes(16).toString('hex');
        const account: DevAccountRecord = {
          userId,
          username,
          usernameNormalized: normalized,
          passwordHash: hashPassword(password, salt),
          salt,
          createdAt: new Date().toISOString(),
        };

        db.accounts[normalized] = account;
        db.userData[userId] = {
          name: username,
          id: userId,
          decks: [],
          collection: [],
          selectedArchetype: null,
          canvasLabels: [],
          canvasAreas: [],
        };

        const token = randomBytes(32).toString('base64url');
        db.sessions[token] = {
          userId,
          username,
          expiresAt: Date.now() + SESSION_TTL_MS,
        };

        writeDb(db);
        jsonResponse(res, 200, { userId, username, token });
      });

      server.middlewares.use('/api/login', async (req, res) => {
        if (req.method !== 'POST') {
          jsonResponse(res, 405, { message: 'Method not allowed' });
          return;
        }

        let payload: { username?: string; password?: string };
        try {
          payload = JSON.parse(await readBody(req)) as {
            username?: string;
            password?: string;
          };
        } catch {
          jsonResponse(res, 400, { message: 'Invalid request body' });
          return;
        }

        const username = payload.username?.trim();
        const password = payload.password ?? '';
        if (!username || !password) {
          jsonResponse(res, 400, { message: 'Username and password are required' });
          return;
        }

        const db = readDb();
        const account = db.accounts[normalizeUsername(username)];
        if (!account || hashPassword(password, account.salt) !== account.passwordHash) {
          jsonResponse(res, 401, { message: 'Invalid credentials' });
          return;
        }

        const token = randomBytes(32).toString('base64url');
        db.sessions[token] = {
          userId: account.userId,
          username: account.username,
          expiresAt: Date.now() + SESSION_TTL_MS,
        };
        writeDb(db);
        jsonResponse(res, 200, {
          userId: account.userId,
          username: account.username,
          token,
        });
      });

      server.middlewares.use('/api/user', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const pathParts = url.pathname.split('/').filter(Boolean);

        if (pathParts.length !== 2 || pathParts[1] !== 'data') {
          jsonResponse(res, 404, { message: 'Not found' });
          return;
        }

        const [userId] = pathParts;
        if (!userId) {
          jsonResponse(res, 400, { message: 'Invalid user path' });
          return;
        }

        const db = readDb();
        const session = getSessionFromAuthHeader(req.headers.authorization, db);
        if (!session) {
          jsonResponse(res, 401, { message: 'Unauthorized' });
          return;
        }
        if (session.userId !== userId) {
          jsonResponse(res, 403, { message: 'Forbidden' });
          return;
        }

        if (req.method === 'GET') {
          const data = db.userData[userId];
          if (!data) {
            jsonResponse(res, 404, { message: 'User data not found' });
            return;
          }
          jsonResponse(res, 200, data);
          return;
        }

        if (req.method === 'PUT') {
          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(await readBody(req)) as Record<string, unknown>;
          } catch {
            jsonResponse(res, 400, { message: 'Invalid request body' });
            return;
          }

          db.userData[userId] = sanitizeUserData(payload, userId, session.username);
          writeDb(db);
          jsonResponse(res, 200, { ok: true });
          return;
        }

        jsonResponse(res, 405, { message: 'Method not allowed' });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), archetypeScoresDevApi(), authUserDevApi()],
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
