# SorceryTCG request policy

SorceryTCG is a community service. The limits below are project requirements,
not claims about an allowance published by SorceryTCG. They apply to
`sorcerytcg.com`, `api.sorcerytcg.com` and every route to
those services. A missing rate-limit header is not permission to send faster.

## Required pacing

- One upstream request at a time, including receipt of the response body.
- At least **3 seconds after completion or failure** before the next request.
  Idle time never accumulates permission for a burst.
- Honour the longest of local spacing, `Retry-After` and a low-budget reset.
  `Retry-After` supports seconds and HTTP dates. `x-ratelimit-reset` supports
  epoch seconds and relative seconds, preserving the earlier adapter behavior.
- When `x-ratelimit-remaining` is 2 or less, wait for its future reset or
  `(5 - remaining) × 3 seconds` from the response that reported it.
- Retry a request at most once, only for 429/503 with valid `Retry-After`.
  A 429/503 without it stops that request and blocks subsequent requests for
  at least 60 seconds. Network failures and other statuses are not retried.
- Proxies forward one attempt; the caller owns the permitted retry. Disable
  automatic redirects so they cannot introduce unthrottled extra calls.
- Cancellation removes pending work and aborts active transport where possible.
  A request already forwarded by a server may still finish upstream.

## Enforcement by path

| Path | Enforcement |
| --- | --- |
| Browser card catalogue, deck import and deck search | One `sorceryClient` singleton in `src/data/sorceryRequest.ts`; a 30-second transport timeout starts after the queue wait |
| Card startup | Existing 24-hour browser cache and bundled/stale fallback; concurrent catalogue loads share a download; no 250ms retry loop |
| Archive/search commands | `nodeSorceryClient` in `scripts/lib/sorcery-client.ts`; queries, pages, downloads and retries use the same queue |
| Manual diagnostics/downloads | `pnpm sorcery:request <https-url> <output-file>` uses that same Node client |
| Vite `/api/sorcery`, `/api/decks` | `scripts/lib/sorcery-dev-proxy.ts` uses the shared Node client, including requests made directly to the dev proxy |
| PHP card/deck proxies | Mandatory limiter in `server/php/api/shared/proxy.php`; one `sorcerytcg` namespace and file lock across visitors/routes; minimum interval cannot be configured below 3000ms |

The deployed catalogue also uses `server/php/api/shared/catalogue-cache.php`: a
shared 24-hour cache, one refresh lock and one-hour failed-refresh backoff.

Node maintenance commands and development servers share an exclusive lock and
persisted deadlines under the operating system temp directory, in
`sorcery-stacks-requests-<user-id>`. PHP uses its temp directory and
`sorcery-stacks-proxy-rate-sorcerytcg` state/lock files. Both hold the lock during
the upstream attempt and preserve spacing after a failure. If the limiter
cannot safely read/write/lock its state, work must stop without sending a call.
For long waits PHP returns 429 with `Retry-After` instead of sleeping more than
8 seconds; it does not contact upstream on that response.

These budgets are shared per host/user or deployed PHP filesystem, not globally
across unrelated machines. Never run several maintenance jobs or live probes
from different environments to increase throughput. A multi-host deployment
would need a shared external limiter. Do not change namespaces or remove state
to reset the allowance. A stale Node lock reports its path: confirm its owner
process has stopped before removing **only the lock directory**, retaining
`state.json` and its deadlines. Never steal a lock because it seems old.

## Agent and maintenance workflow

1. Inspect local source, saved fixtures, cached data and previous search results
   first. Tests and builds should make **zero live SorceryTCG requests**.
2. If a live response is necessary, stop other upstream jobs and download it
   once through the helper. Reuse that saved response for inspection/tests:
   ```sh
   pnpm sorcery:request https://api.sorcerytcg.com/api/cards /tmp/sorcery-cards.json
   pnpm cards:check /tmp/sorcery-cards.json
   ```
3. Use `pnpm sorcery:competitive-decks --card-data <saved-file>` for an explicitly
   requested competition refresh. The preset retains its search terms, follows
   cursors sequentially, deduplicates IDs and skips unchanged decklists.
4. Check health/wait logs and archive results locally. Do not repeat a successful
   download or crawl merely to confirm it worked.

Do not use ad-hoc `curl`, direct fetches, parallel request batches, browser page
reload loops, or separately launched agents to reach upstream. Normal visiting
of SorceryTCG in a user's browser is outside this app's transport controls;
automated diagnostics must use the helper instead. Local image/atlas assets
and the app's own login/storage endpoints are not SorceryTCG upstream requests.

The deployed catalogue route uses a shared daily cache **as well as** this
limiter. A fresh reviewed deployment snapshot is served directly. After 24
hours, one visitor can refresh it; concurrent visitors receive the last good
catalogue. Failed, malformed, empty or unexpectedly small responses retain that
catalogue and defer another attempt for at least an hour. The upstream budget
can extend the wait further. `X-Sorcery-Catalogue-Cache` reports fresh, refreshed
or stale; stale responses do not acquire a new 24-hour browser-cache timestamp.
Cache files are separated by deployment path and contain public card data only.
The route accepts GET without catalogue query parameters. Vite uses the shared
Node limiter for development requests. No background crawls are scheduled.

## Offline regression coverage

Tests exercise mixed card/deck traffic, concurrent callers, full body downloads,
idle gaps, failed/aborted attempts, numeric/date `Retry-After`, longer reset
deadlines, exhausted budgets, retry caps and shared host state. PHP timing and
lock tests use local processes/files and do not call SorceryTCG. Live rate-limit
or load testing against SorceryTCG is prohibited.
