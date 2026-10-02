# SorceryTCG deck integration and request policy

The website moved from Curiosa to SorceryTCG. The app and archive tools now use
`https://sorcerytcg.com`. Historical filenames, exported function names,
`curiosa:*` commands and saved `curiosa-<id>` deck IDs remain compatible.

The [SorceryTCG request policy](sorcery-request-policy.md) is mandatory for all
upstream traffic, including agent diagnostics, card data, dev proxies and CLI
maintenance. This document records deck integration details.

## Migration review

Verified against the live site on 30 September 2026:

| Area | Migration problem | Current behavior |
| --- | --- | --- |
| URL input | SorceryTCG links rejected by a Curiosa-only hostname check | Accepts both domains, their www forms, and raw deck IDs; rejects unrelated hosts and paths |
| Proxies | Curiosa target and Origin/Referer headers | Vite and PHP target SorceryTCG directly |
| Deck retrieval | Four removed `get*ById` procedures returned 404 | One `deck.get` request returns metadata and every board |
| Author and title | Old `__NEXT_DATA__` HTML parsing no longer worked | Reads the deck name and owner from the JSON response |
| Boards | Separate board responses became a flat `decklist` | Main → mainboard, Avatar → avatar, Collection → collection, Maybeboard → maybeboard |
| Search | `deck.count` removed; search input and pagination changed | Uses current filters/sort enums and follows `nextCursor` |
| Search metadata | `user` became `owner`, `hotscore` became `popularity`, primers became Portable Text | Normalizes these into the existing archive format |
| Text import | Collection/Spellbook/Atlas headers were unrecognized | Recognizes those labels alongside legacy headers |
| Archive card lookup | Only read `guardian.type` | Also understands the current `engine.type` |

The supplied deck, `https://sorcerytcg.com/decks/cmtboarx300cb04i4mt5aayo5`,
returned **Heeeey Red** by **sjaak**: 106 mainboard cards, 1 avatar, 10 Collection
cards and 30 Maybeboard cards. An old Curiosa example ID,
`cmm45q5mu00dh04l7mzhl477o`, also resolved on SorceryTCG. Card counts can change
when authors edit decks; the regression fixture records this observed response.

## Request flow

The visitor explicitly submits a deck URL or ID. The app validates it, then
requests `/api/decks/api/trpc/deck.get` with a one-entry batch containing
`{ id, collectionTracking: false }`. The server forwards that request to
SorceryTCG with its Origin and Referer headers. No upstream login is required
for decks that SorceryTCG makes available publicly/by link.

The importer validates the returned ID, name, board list, card names and positive
integer quantities before changing app state. Separate printings of a card are
combined. Unknown card names remain in the deck and are shown as warnings by the
normal import flow. Unknown boards or malformed entries reject the whole import
rather than silently saving a partial deck. Unavailable/private decks and API
errors are shown to the visitor. Deck Collection entries never modify the
visitor's personal collection.

Guest and logged-in users use the same import path and shared UserData schema.
Legacy `sideboard` saves migrate to `collection` at the storage boundary.
Stable deck IDs associate imports through either domain with the same deck.

## Routing and request limits

- Development: `/api/decks/*` → `https://sorcerytcg.com/*` via Vite.
- Staging/production: the same route uses `server/php/api/proxy-curiosa.php`.
- `/api/curiosa/*` remains a route alias for maintenance tools with old settings.
- `/api/sorcery/*` still targets the separate public card API at
  `https://api.sorcerytcg.com/api/*`.
- Cards, imports and searches share one browser queue, with at least three
  seconds after the full response or failure before another request starts.
- Scripts, manual downloads and Vite share a host lock and persisted budget.
- Both PHP proxies use one `sorcerytcg` namespace with the same three-second
  minimum and at most eight seconds of server sleeping per request.
- All layers honour the longest rate-limit/Retry-After wait. Clients retry a
  429/503 at most once only with valid Retry-After; proxies do not retry.
  A headerless 429/503 pauses the shared budget for at least 60 seconds.
- Automatic redirects are disabled. Failures cannot bypass the spacing window.
- Cancelling import aborts pending browser requests/waits and ignores stale
  results; it cannot recall an upstream request already forwarded by PHP.

The URL validator accepts only the two known domains and deck paths. The proxy
has a fixed upstream host, validates paths and allows GET/POST. The same-origin
bridge is broader than the importer: it is not a per-procedure allowlist.

## Archive tools

Use `pnpm sorcery:decks`, `pnpm sorcery:search-decks`, or
`pnpm sorcery:competitive-decks`. The existing `curiosa:*` names and
`--curiosa-base-url` remain aliases; `--sorcery-base-url` is the current flag.
Both use `src/data/sorceryDeckSource.ts` for URL and deck payload parsing.

Search follows the server's next cursor, even when a page contains fewer than
the requested number of results, and stops if the cursor fails to advance.
Search totals are counts discovered so far. The old `relevance` option now maps
to `PopularityDesc`; `latest` maps to `UpdatedDesc`. Search snapshots keep compact
metadata instead of copying every card printing returned by the new endpoint.

These commands are manually invoked; they do not crawl in the background.
Default card validation uses the app's bundled `public/assets/sorcery_cards.json`.
The competition preset retains the original 36 search terms and rebuilds Deck
Lookup after merging new and changed decks. The builder uses the shared card
catalogue adapter, including when `--card-data` supplies a fresh catalogue. See
[the refresh workflow and latest results](scripts.md#pnpm-sorcerycompetitive-decks).

## Deck creation entry points

The side-panel plus button and Deck Lookup plus button share `DeckCreatePanel`.
Both offer URL import, a local deck, then pasted text, in that order. Closing the
creation panel aborts an active URL import and ignores late responses. The local
avatar picker reads the current catalogue so new avatars do not need a separate
hard-coded option. Deck Lookup opens on Avatars, followed by Styles,
Competitions, Favourites and Added. Added shares the right panel's saved library;
its metrics and style estimates use bundled data without upstream calls.

## Validation and remaining dependency

Service tests cover the projected live example, current/legacy URLs, all boards,
duplicate printings, unknown data, errors, cancellation and request limits.
Archive tests cover shared parsing, current metadata, pagination and old inputs.

Deck retrieval and search still depend on the website's internal tRPC API. Its
contract can change again. Keep the adapter isolated, validate responses, and
update recorded fixtures when the upstream changes. The public card catalogue
API is separate and continues to use the catalogue adapter described in
[card-catalog-updates.md](card-catalog-updates.md).
