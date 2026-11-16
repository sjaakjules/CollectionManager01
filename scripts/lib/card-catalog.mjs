import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

/** Use the application's actual adapter when checking or publishing snapshots. */
export async function readCardCatalog(input, { includeProvisional = false } = {}) {
  const payload = JSON.parse(await readFile(input, 'utf8'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const server = await createServer({
    root,
    configFile: false,
    // Keep maintenance scripts from replacing an open dev server's dependencies.
    cacheDir: 'node_modules/.vite-card-catalog',
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
  });
  try {
    const { normalizeCardCatalog } = await server.ssrLoadModule('/src/data/cardCatalog.ts');
    const catalog = normalizeCardCatalog(payload);
    if (!includeProvisional) return catalog;
    const { withProvisionalCards } = await server.ssrLoadModule('/src/data/provisionalCards.ts');
    return { ...catalog, cards: withProvisionalCards(catalog.cards) };
  } finally {
    await server.close();
  }
}
