# SorceryTCG integration

The app uses only `https://sorcerytcg.com` for public decks and search, and
`https://api.sorcerytcg.com/api/cards` for card metadata. Runtime services,
maintenance commands, proxy routes and documentation use SorceryTCG names.
There is no retired-host fallback, scraper, route alias or command alias.
The [request policy](sorcery-request-policy.md) applies to every live request.

## API review — 16 November 2026

Three sequential requests through `pnpm sorcery:request` verified the catalogue,
one public deck and one search page. Saved responses were reused for parsing;
no deck crawl or artwork download was run.

| API | Verified behavior |
| --- | --- |
| `/api/cards` on the card API host | 1,169 records in the `engine/printings` format; all passed the shared catalogue adapter |
| `/api/trpc/deck.get` on the website | One batched input `{ id, collectionTracking: false }` returns metadata and every board |
| `/api/trpc/deck.search` on the website | Current filter/sort inputs return `{ decks, nextCursor }`; a one-result page parsed successfully |

The public deck `cmtboarx300cb04i4mt5aayo5` returned 89 Main cards, 1 Avatar,
10 Collection cards and 51 Maybe cards. These are observations of an editable
deck, not permanent card counts. Existing offline fixtures still exercise the
same verified response contract.

## Request flow and validation

`src/data/sorceryDeckService.ts` imports decks and searches. It shares URL and
payload parsing with the CLI through `src/data/sorceryDeckSource.ts`. URL input
accepts `sorcerytcg.com`, its `www` form, or a raw deck ID. Unrelated hosts,
credentials, nonstandard ports and other paths are rejected before transport.

The importer uses `/api/decks/api/trpc/deck.get` and validates the returned ID,
name, board list, card names and positive integer quantities before saving.
Main maps to `mainboard`, Avatar to `avatar`, Collection to `collection`, and
Maybeboard to `maybeboard`. Separate printings of one name combine quantities.
Unknown cards are retained and reported by the import flow; malformed cards or
unsupported boards reject the import. A deck's Collection never changes the
visitor's personal collection.

Search reads `owner`, `popularity` and Portable Text primers. It follows
`nextCursor` even when a page contains fewer than the requested results, and
stops on a cursor that fails to advance. `relevance` selects `PopularityDesc`;
`latest` selects `UpdatedDesc`. No removed count or per-board endpoints are used.

## Routing and pacing

- `/api/decks/*` goes to the website through the Vite proxy or PHP
  `api/proxy-decks.php`.
- `/api/sorcery/cards` goes to the public catalogue through Vite or PHP
  `api/proxy-sorcery.php`.
- Browser requests share `sorceryClient`; maintenance and Vite share the
  filesystem-backed `nodeSorceryClient`.
- PHP card/deck requests share a single upstream lock and budget. The catalogue
  additionally has a shared 24-hour cache and one refresh lock. A fresh reviewed
  deployment snapshot can satisfy visitors without contacting upstream.
- Every upstream attempt waits at least three seconds after the previous body
  completes or fails. Rate-limit and Retry-After deadlines can extend that wait.
  Clients allow at most one qualified 429/503 retry; proxies never retry.
- Cancellation removes queued work. Redirects cannot bypass the limiter.

See the [request policy](sorcery-request-policy.md) for failure backoff, host
boundaries and offline verification. Card refresh failures retain the last good
shared catalogue and the browser's bundled/stale fallbacks.

## Saved data and maintenance commands

New imported/seeded decks use `sorcery-<sourceId>` identities. A storage-only
migration translates the previous identity prefix in guest and account decks,
favourites, deletion records and canvas deck references. This prevents duplicate
seed hydration and preserves deleted decks. Opaque area/card IDs, arrangements,
labels and variants remain attached. If two saved copies already have the same
source identity, the more recently edited deck wins, as in normal account merge.
The migration never sends an upstream request.

Use `pnpm sorcery:decks`, `pnpm sorcery:search-decks`,
`pnpm sorcery:competitive-decks` and `pnpm sorcery:seed-decks`.
The optional base URL flag is `--sorcery-base-url`.
These commands run only when invoked; they do not crawl in the background.
Default card validation uses `public/assets/sorcery_cards.json`.
See [scripts.md](scripts.md) for inputs, archive reuse and competition filtering.

## Canvas additions

Avatars have a dedicated leading catalogue section, including Frost Mage and
Lavamancer. With an active deck on the canvas, selected cards have a corner +.
The row above it is Collection / Main / Maybe for that card. A second outlined
row below it appears for multiple selected instances, with an All Selected
caption. Outside click or Escape closes the menu. Additions use the existing
shared deck/board path, including routing Main avatars to the avatar board.

Deck retrieval and search depend on SorceryTCG's internal tRPC contract. Keep
adapters isolated and validate recorded responses when it changes. The card API
has its own [catalogue adapter and update workflow](card-catalog-updates.md).
