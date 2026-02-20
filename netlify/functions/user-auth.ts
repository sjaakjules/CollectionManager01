import { getStore } from "@netlify/blobs";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const STORE_NAME = "sorcery-user-auth";
const ACCOUNT_PREFIX = "account:";
const USER_DATA_PREFIX = "user-data:";
const SESSION_PREFIX = "session:";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;

interface CredentialsPayload {
  username?: string;
  password?: string;
}

interface AccountRecord {
  userId: string;
  username: string;
  usernameNormalized: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
}

interface SessionRecord {
  userId: string;
  username: string;
  expiresAt: number;
}

interface CanvasLabelPayload {
  id: string;
  text: string;
  x: number;
  y: number;
}

interface UserDataPayload {
  name?: string;
  id?: string;
  decks?: unknown[];
  collection?: unknown[];
  selectedArchetype?: string | null;
  archetypeScores?: Record<string, Record<string, number>> & {
    __meta?: { categories: string[] };
  };
  canvasLabels?: CanvasLabelPayload[];
}

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: headers(),
  });
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

function validateCredentials(payload: CredentialsPayload): {
  username: string;
  usernameNormalized: string;
  password: string;
} | null {
  const username = payload.username?.trim() ?? "";
  const password = payload.password ?? "";
  const usernameNormalized = normalizeUsername(username);

  if (
    !USERNAME_RE.test(username) ||
    password.length < 6 ||
    usernameNormalized === "guest"
  ) {
    return null;
  }

  return {
    username,
    usernameNormalized,
    password,
  };
}

function createEmptyUserData(userId: string, username: string): UserDataPayload {
  return {
    name: username,
    id: userId,
    decks: [],
    collection: [],
    selectedArchetype: null,
    canvasLabels: [],
  };
}

function sanitizeUserData(
  payload: UserDataPayload,
  userId: string,
  username: string
): UserDataPayload {
  const decks = Array.isArray(payload.decks) ? payload.decks : [];
  const collection = Array.isArray(payload.collection) ? payload.collection : [];
  const selectedArchetype =
    typeof payload.selectedArchetype === "string" ||
    payload.selectedArchetype === null
      ? payload.selectedArchetype
      : null;
  const canvasLabels = Array.isArray(payload.canvasLabels)
    ? payload.canvasLabels.filter((label) => {
        return (
          typeof label?.id === "string" &&
          typeof label?.text === "string" &&
          typeof label?.x === "number" &&
          typeof label?.y === "number"
        );
      })
    : [];
  const archetypeScores =
    payload.archetypeScores &&
    typeof payload.archetypeScores === "object" &&
    !Array.isArray(payload.archetypeScores)
      ? payload.archetypeScores
      : undefined;

  return {
    name: username,
    id: userId,
    decks,
    collection,
    selectedArchetype,
    canvasLabels,
    archetypeScores,
  };
}

async function createSession(
  store: ReturnType<typeof getStore>,
  userId: string,
  username: string
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const session: SessionRecord = {
    userId,
    username,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  await store.setJSON(`${SESSION_PREFIX}${token}`, session);
  return token;
}

async function getSessionFromRequest(
  req: Request,
  store: ReturnType<typeof getStore>
): Promise<SessionRecord | null> {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) return null;

  const session = (await store.get(`${SESSION_PREFIX}${token}`, {
    type: "json",
  })) as SessionRecord | null;

  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    return null;
  }

  return session;
}

async function readCredentials(req: Request): Promise<CredentialsPayload | null> {
  try {
    return (await req.json()) as CredentialsPayload;
  } catch {
    return null;
  }
}

async function handleSignup(
  req: Request,
  store: ReturnType<typeof getStore>
): Promise<Response> {
  const payload = await readCredentials(req);
  if (!payload) {
    return json(400, { message: "Invalid request body" });
  }

  const credentials = validateCredentials(payload);
  if (!credentials) {
    return json(400, {
      message:
        "Username must be 3-24 letters/numbers/underscore and password must be at least 6 characters",
    });
  }

  const existing = (await store.get(
    `${ACCOUNT_PREFIX}${credentials.usernameNormalized}`,
    { type: "json" }
  )) as AccountRecord | null;

  if (existing) {
    return json(409, { message: "Username already exists" });
  }

  const userId = randomUUID();
  const salt = randomBytes(16).toString("hex");
  const account: AccountRecord = {
    userId,
    username: credentials.username,
    usernameNormalized: credentials.usernameNormalized,
    passwordHash: hashPassword(credentials.password, salt),
    salt,
    createdAt: new Date().toISOString(),
  };

  await store.setJSON(`${ACCOUNT_PREFIX}${credentials.usernameNormalized}`, account);
  await store.setJSON(
    `${USER_DATA_PREFIX}${userId}`,
    createEmptyUserData(userId, credentials.username)
  );

  const token = await createSession(store, userId, credentials.username);

  return json(200, {
    userId,
    username: credentials.username,
    token,
  });
}

async function handleLogin(
  req: Request,
  store: ReturnType<typeof getStore>
): Promise<Response> {
  const payload = await readCredentials(req);
  if (!payload) {
    return json(400, { message: "Invalid request body" });
  }

  const username = payload.username?.trim();
  const password = payload.password ?? "";
  if (!username || !password) {
    return json(400, { message: "Username and password are required" });
  }

  const normalized = normalizeUsername(username);
  const account = (await store.get(`${ACCOUNT_PREFIX}${normalized}`, {
    type: "json",
  })) as AccountRecord | null;

  if (!account) {
    return json(401, { message: "Invalid credentials" });
  }

  const expectedHash = hashPassword(password, account.salt);
  if (expectedHash !== account.passwordHash) {
    return json(401, { message: "Invalid credentials" });
  }

  const token = await createSession(store, account.userId, account.username);
  return json(200, {
    userId: account.userId,
    username: account.username,
    token,
  });
}

async function handleUserData(
  req: Request,
  store: ReturnType<typeof getStore>,
  path: string | null
): Promise<Response> {
  const pathParts = (path ?? "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (pathParts.length !== 2 || pathParts[1] !== "data") {
    return json(404, { message: "Not found" });
  }

  const userId = pathParts[0];
  if (!userId) {
    return json(400, { message: "Invalid user path" });
  }

  const session = await getSessionFromRequest(req, store);
  if (!session) {
    return json(401, { message: "Unauthorized" });
  }

  if (session.userId !== userId) {
    return json(403, { message: "Forbidden" });
  }

  if (req.method === "GET") {
    const data = (await store.get(`${USER_DATA_PREFIX}${userId}`, {
      type: "json",
    })) as UserDataPayload | null;

    if (!data) {
      return json(404, { message: "User data not found" });
    }

    return json(200, data);
  }

  if (req.method === "PUT") {
    let payload: UserDataPayload;
    try {
      payload = (await req.json()) as UserDataPayload;
    } catch {
      return json(400, { message: "Invalid request body" });
    }

    const sanitized = sanitizeUserData(payload, userId, session.username);
    await store.setJSON(`${USER_DATA_PREFIX}${userId}`, sanitized);
    return json(200, { ok: true });
  }

  return json(405, { message: "Method not allowed" });
}

export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: headers() });
  }

  const store = getStore(STORE_NAME);
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "signup" && req.method === "POST") {
    return handleSignup(req, store);
  }

  if (action === "login" && req.method === "POST") {
    return handleLogin(req, store);
  }

  if (action === "user") {
    return handleUserData(req, store, url.searchParams.get("path"));
  }

  return json(404, { message: "Not found" });
};
