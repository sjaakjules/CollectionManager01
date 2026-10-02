import type { Deck } from "./dataModels";

export const SORCERY_DECK_ORIGIN = "https://sorcerytcg.com";
export const SORCERY_DECK_PROXY = "/api/decks";
const DECK_HOSTS = new Set([
  "sorcerytcg.com", "www.sorcerytcg.com", "curiosa.io", "www.curiosa.io",
]);

export function extractDeckId(urlOrId: string): string {
  const raw = urlOrId.trim();
  const candidate = raw.replace(/[?#].*$/, "").replace(/\/+$/, "");
  if (/^[a-zA-Z0-9_-]+$/.test(candidate)) return candidate;

  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!DECK_HOSTS.has(url.hostname.toLowerCase()) ||
        !["https:", "http:"].includes(url.protocol) ||
        url.username || url.password || url.port) return "";
    return url.pathname.match(/^\/decks\/([a-zA-Z0-9_-]+)\/?$/)?.[1] ?? "";
  } catch {
    return "";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// Sorcery now uses Portable Text blocks; old archived primers are HTML strings.
export function readDeckPrimer(value: unknown): string | null | undefined {
  if (value === null || typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  return value.map((block) => {
    const children = asRecord(block)?.children;
    return Array.isArray(children)
      ? children.map((span) => readString(asRecord(span)?.text) ?? "").join("")
      : "";
  }).filter(Boolean).join("\n");
}

export function buildDeckRequestInput(id: string) {
  return { "0": { json: { id, collectionTracking: false } } };
}

export function readDeckResponse(raw: unknown): unknown {
  if (!Array.isArray(raw) || raw.length !== 1) {
    throw new Error("Unexpected response format from SorceryTCG");
  }
  const entry = asRecord(raw[0]);
  const error = asRecord(asRecord(entry?.error)?.json);
  if (typeof error?.message === "string") throw new Error(`SorceryTCG: ${error.message}`);
  const data = asRecord(asRecord(entry?.result)?.data);
  if (!data || !("json" in data)) throw new Error("Unexpected response format from SorceryTCG");
  return data.json;
}

export function parseSorceryDeck(raw: unknown, expectedId: string) {
  const deck = asRecord(raw);
  if (!deck) throw new Error("SorceryTCG deck is unavailable or private");
  const name = readString(deck.name)?.trim();
  if (deck.id !== expectedId || !name || !Array.isArray(deck.decklist)) {
    throw new Error("Unexpected SorceryTCG deck data; the deck was not imported");
  }

  const boards: Deck["boards"] = { mainboard: [], avatar: [], collection: [], maybeboard: [] };
  const boardNames: Record<string, keyof Deck["boards"]> = {
    main: "mainboard", mainboard: "mainboard", avatar: "avatar",
    // The new website calls the deck's reserve board Collection. This is
    // separate from the visitor's personal collection, which imports never edit.
    collection: "collection", sideboard: "collection", maybeboard: "maybeboard",
  };
  for (const value of deck.decklist) {
    const entry = asRecord(value);
    const label = readString(entry?.board)?.trim();
    const key = label?.toLowerCase();
    const board = key && Object.hasOwn(boardNames, key) ? boardNames[key] : undefined;
    if (!board) throw new Error(`Unsupported SorceryTCG deck board: ${label ?? "missing"}. The deck was not imported.`);
    const cardName = readString(asRecord(entry?.card)?.name)?.trim();
    const quantity = entry?.quantity;
    if (!cardName || typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error(`Invalid card or quantity in SorceryTCG ${label}; the deck was not imported`);
    }
    // Separate printings of one card still represent a single deck entry here.
    const existing = boards[board].find((card) => card.name === cardName);
    if (existing) existing.quantity += quantity;
    else boards[board].push({ name: cardName, quantity });
  }

  const owner = asRecord(deck.owner) ?? asRecord(deck.user);
  const count = asRecord(deck._count);
  return {
    id: expectedId,
    metadata: {
      id: expectedId, name,
      createdAt: readString(deck.createdAt), updatedAt: readString(deck.updatedAt),
      format: readString(deck.format), primer: readDeckPrimer(deck.primer),
      hotscore: readNumber(deck.popularity) ?? readNumber(deck.hotscore),
      elements: Array.isArray(deck.elements)
        ? deck.elements.filter((element): element is string => typeof element === "string")
        : undefined,
      user: owner ? { id: readString(owner.id), username: readString(owner.username) } : undefined,
      views: readNumber(deck.views), likes: readNumber(count?.likes),
    },
    boards,
  };
}
