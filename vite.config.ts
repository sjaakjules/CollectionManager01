import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sorceryDevProxy } from './scripts/lib/sorcery-dev-proxy';
import { sanitizeDevUserData } from './scripts/lib/dev-user-data';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

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


  return {
    name: 'auth-user-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/signup', async (req, res) => {
        if (req.method !== 'POST') {
          jsonResponse(res, 405, { message: 'Method not allowed' });
          return;
        }

        let payload: { username?: string; password?: string; userData?: Record<string, unknown> };
        try {
          payload = JSON.parse(await readBody(req)) as {
            username?: string;
            password?: string;
            userData?: Record<string, unknown>;
          };
        } catch {
          jsonResponse(res, 400, { message: 'Invalid request body' });
          return;
        }

        const username = payload.username?.trim() ?? '';
        const password = payload.password ?? '';
        const normalized = normalizeUsername(username);

        if ('userData' in payload && (!payload.userData || Array.isArray(payload.userData)
          || !Array.isArray(payload.userData.decks) || !Array.isArray(payload.userData.collection))) {
          jsonResponse(res, 400, { message: 'Guest workspace could not be read. Your guest data has not been changed.' });
          return;
        }

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
        db.userData[userId] = sanitizeDevUserData(payload.userData ?? {}, userId, username);

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

          db.userData[userId] = sanitizeDevUserData(payload, userId, session.username);
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
  plugins: [react(), authUserDevApi(), sorceryDevProxy()],
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
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'index.html'),
        baldassaresReview: resolve(__dirname, 'previews/baldassares-travels.html'),
      },
    },
  },
  // Disable source maps for dependencies to avoid PixiJS shader warnings
  optimizeDeps: {
    esbuildOptions: {
      sourcemap: false,
    },
  },
});
