import { getStore } from "@netlify/blobs";

const STORE_NAME = "archetype-data";
const BLOB_KEY = "scores";

interface ScoresData {
  __meta?: { categories: string[] };
  [cardName: string]:
    | Record<string, number>
    | { categories: string[] }
    | undefined;
}

async function loadScores(
  store: ReturnType<typeof getStore>,
  siteOrigin: string
): Promise<ScoresData> {
  const existing = (await store.get(BLOB_KEY, {
    type: "json",
  })) as ScoresData | null;
  if (existing) return existing;

  // First access — seed blob store from the static JSON deployed with the site
  const res = await fetch(
    `${siteOrigin}/assets/sorcery_card_archetype_scores.json`
  );
  if (!res.ok) {
    // No seed data available, start empty
    const empty: ScoresData = { __meta: { categories: [] } };
    await store.setJSON(BLOB_KEY, empty);
    return empty;
  }

  const raw = (await res.json()) as Record<string, unknown>;
  const seed = { ...raw, __meta: { categories: [] } } as ScoresData;
  await store.setJSON(BLOB_KEY, seed);
  return seed;
}

async function saveScores(
  store: ReturnType<typeof getStore>,
  scores: ScoresData
): Promise<void> {
  const sorted: ScoresData = {};
  const keys = Object.keys(scores)
    .filter((k) => k !== "__meta")
    .sort();
  if (scores.__meta) {
    sorted.__meta = scores.__meta;
  }
  for (const key of keys) {
    sorted[key] = scores[key];
  }
  await store.setJSON(BLOB_KEY, sorted);
}

export default async (req: Request) => {
  const store = getStore(STORE_NAME);
  const url = new URL(req.url);
  const siteOrigin = url.origin;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  // GET — load all scores
  if (req.method === "GET") {
    const scores = await loadScores(store, siteOrigin);
    return new Response(JSON.stringify(scores), { status: 200, headers });
  }

  // POST — mutations
  if (req.method === "POST") {
    const action = url.searchParams.get("action");

    if (action === "update-score") {
      const { cardName, archetype, delta } = (await req.json()) as {
        cardName: string;
        archetype: string;
        delta: number;
      };

      if (!cardName || !archetype || typeof delta !== "number") {
        return new Response(
          JSON.stringify({ error: "Missing cardName, archetype, or delta" }),
          { status: 400, headers }
        );
      }

      const scores = await loadScores(store, siteOrigin);
      const cardScores =
        (scores[cardName] as Record<string, number>) ?? {};
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

      await saveScores(store, scores);
      return new Response(JSON.stringify({ ok: true, score: next }), {
        status: 200,
        headers,
      });
    }

    if (action === "add-category") {
      const { categoryName } = (await req.json()) as {
        categoryName: string;
      };

      if (!categoryName || typeof categoryName !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing categoryName" }),
          { status: 400, headers }
        );
      }

      const sanitized = categoryName
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");

      if (!sanitized) {
        return new Response(
          JSON.stringify({ error: "Invalid category name" }),
          { status: 400, headers }
        );
      }

      const scores = await loadScores(store, siteOrigin);
      if (!scores.__meta) scores.__meta = { categories: [] };

      const existingFromData = new Set<string>();
      for (const [key, val] of Object.entries(scores)) {
        if (key === "__meta") continue;
        if (val && typeof val === "object") {
          for (const arch of Object.keys(val)) {
            existingFromData.add(arch);
          }
        }
      }

      if (
        scores.__meta.categories.includes(sanitized) ||
        existingFromData.has(sanitized)
      ) {
        return new Response(
          JSON.stringify({
            error: "Category already exists",
            name: sanitized,
          }),
          { status: 409, headers }
        );
      }

      scores.__meta.categories.push(sanitized);
      await saveScores(store, scores);

      return new Response(
        JSON.stringify({ ok: true, name: sanitized }),
        { status: 200, headers }
      );
    }

    if (action === "save-full") {
      const incoming = (await req.json()) as ScoresData;

      const current = await loadScores(store, siteOrigin);
      const meta = current.__meta ?? { categories: [] };
      incoming.__meta = incoming.__meta ?? meta;

      await saveScores(store, incoming);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers,
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers,
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers,
  });
};
