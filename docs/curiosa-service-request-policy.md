# Curiosa Deck Import Request Policy

This document describes the current Curiosa deck import behavior in
`src/data/curiosaService.ts` and the matching production PHP proxy behavior.

The important principle is that this feature is not a crawler and does not poll
Curiosa in the background. A user-triggered deck import makes at most two
Curiosa requests: one public deck page request and one batched decklist request.

## Background

Curiosa deck data is public without login, but the decklist endpoint used by the
site is an internal tRPC endpoint rather than a published public API. The app
uses same-origin proxy paths so browser CORS does not block requests:

- Dev: `/api/curiosa/*` is proxied by Vite to `https://curiosa.io/*`.
- Production: `/api/curiosa/*` is routed through the PHP Curiosa proxy.

The live check performed on June 7, 2026 showed:

- The example deck page loaded publicly:
  `https://curiosa.io/decks/cmm45q5mu00dh04l7mzhl477o`.
- A bare tRPC request returned `403 Forbidden: Invalid origin`.
- The same unauthenticated tRPC request worked when sent with
  `Origin: https://curiosa.io`.
- Curiosa returned `x-ratelimit-limit: 30` and
  `x-ratelimit-remaining: 29` on the successful tRPC response.

## What Happens Now

The current import is deliberately user-triggered and conservative.

1. The user opens the Decks panel and enters a Curiosa deck URL.
2. The app validates that the input is either a raw deck ID or a Curiosa
   `/decks/{id}` URL.
3. The import flow creates an `AbortController` for the request.
4. The app fetches the public deck page through `/api/curiosa/decks/{id}`.
5. In production, the PHP proxy applies its shared server-side Curiosa throttle
   before forwarding the request upstream.
6. If the deck page is `403`, `404`, or `410`, the import stops immediately.
7. Metadata is parsed from `__NEXT_DATA__` first, then from title/meta/h1
   fallback candidates.
8. The app waits for the local rate limiter before making the tRPC request.
9. The PHP proxy applies the shared server-side throttle again in production.
10. The app sends one batched tRPC request for all boards.
11. The response must be a four-entry batch, and each entry must contain result
   JSON rather than a tRPC error.
12. The deck is converted into the internal `Deck` model and added to guest or
   account data through the normal app state flow.
13. Unknown card names are preserved in deck boards and surfaced to the user as
    warnings.
14. If the user cancels, switches away from the deck import panel, or the panel
    unmounts, the `AbortController` cancels pending client waits/fetches and the
    app ignores stale results.

## Fairness Controls

The current limiter has two layers: a conservative client-side limiter and a
production PHP proxy backstop.

### Client-side limiter

The client-side limiter is global to the loaded app instance.

- Requests are serialized with a promise queue, so only one Curiosa request is
  in flight from this app instance.
- A local token bucket has capacity `1`.
- Tokens refill every `3000ms`.
- The first request can start immediately.
- The second request in the same import waits for the next 3-second token.
- Concurrent imports line up behind the same queue.

The service also reads Curiosa rate-limit and retry headers:

- `x-ratelimit-limit`
- `x-ratelimit-remaining`
- `x-ratelimit-reset`
- `Retry-After`

If `x-ratelimit-remaining` is `2` or lower, the service waits before the next
request. It prefers Curiosa's reset header when present. If no reset header is
available, it waits enough local 3-second ticks to estimate a return to at least
5 remaining requests.

If Curiosa returns `429` or `503` with `Retry-After`, the service retries at
most once. That keeps recovery possible when Curiosa explicitly asks clients to
wait, while avoiding retry loops.

When the client expects a polite wait of at least one second, the import UI can
show:

> Slowing download to be kind to Curiosa.io

The same message is also shown if an import remains pending long enough that a
server-side throttle delay may be happening before response headers are
available.

### Server-side PHP proxy throttle

The production PHP Curiosa proxy has a shared throttle configured in
`server/php/api/proxy-curiosa.php`. It is intentionally less strict than the
client-side limiter, but it protects Curiosa if several clients import decks at
the same time, if client-side timing behaves differently across browsers, or if
debugging client-side delay behavior is difficult.

Current production proxy settings:

- Namespace: `curiosa`
- Minimum interval: `1000ms` between proxied Curiosa requests
- Low remaining threshold: `2`
- Safe remaining target: `5`
- Maximum server sleep: `8000ms`

The shared throttle stores state in the PHP temp directory and uses a file lock,
so Curiosa proxy requests through one deployed server are serialized. It records
Curiosa `x-ratelimit-*` and `Retry-After` headers, delays before forwarding when
the shared budget is low, and returns `429` with `Retry-After` if the expected
delay is longer than the configured maximum server sleep. This means the server
does not keep making upstream requests when Curiosa has signaled that it should
wait.

Failed PHP proxy attempts also advance the shared spacing window. That makes
debugging safer because repeated proxy/network failures cannot create immediate
retry bursts toward Curiosa.

The proxy emits debugging/status headers on Curiosa responses:

- `X-Sorcery-Proxy-Throttle: active`
- `X-Sorcery-Proxy-Min-Interval-Ms`
- `X-Sorcery-Proxy-Delay-Ms`
- `X-Sorcery-Proxy-Delay-Reason`

The Vite development proxy does not run this PHP throttle. Local development
still uses the client-side limiter.

## Header Behavior

The tRPC endpoint currently requires an acceptable origin signal.

- Dev Vite proxy now sends:
  - `Origin: https://curiosa.io`
  - `Referer: https://curiosa.io/`
- Production PHP proxy already sends those headers.
- Production PHP proxy responses also include Sorcery proxy throttle headers
  when the Curiosa throttle is active.

The service does not scrape or send a Next.js build ID. The live check showed
that `Origin` was sufficient, so build ID scraping was intentionally avoided.

## Security Notes

Current security-related behavior:

- The frontend only accepts raw IDs or Curiosa deck URLs.
- Non-Curiosa URLs are rejected before fetch.
- The PHP shared proxy validates paths and rejects empty paths, absolute URLs,
  `//`, `..`, and control characters.
- The production proxy only allows `GET` and `POST`.
- The production Curiosa proxy applies a shared server-side throttle before
  forwarding requests upstream.
- Curiosa imports use an app-level `AbortController`; cancelling the import,
  switching away from the deck panel, or unmounting the panel aborts pending
  client waits/fetches and prevents stale results from being applied.
- Deck metadata is rendered through React text paths, so normal React escaping
  applies.

Current security limitations:

- The Vite dev proxy is broader than the frontend validator. If code elsewhere
  called `/api/curiosa/...`, Vite would still proxy it.
- The PHP proxy forwards Curiosa responses with limited filtering. It is safe
  for the current use case, but it is still a general same-origin bridge to
  Curiosa paths.
- The PHP throttle is shared per deployed server filesystem. If the app is ever
  served from multiple independent PHP hosts, each host would have its own
  throttle state unless a shared store is added.
- App-level cancellation stops pending browser work and stale UI updates, but it
  cannot always recall a PHP/cURL request that the proxy has already forwarded
  upstream.

## Known Issues And Tradeoffs

- The client-side limiter is per browser/app instance. The production PHP
  limiter adds a shared backstop for one deployed server, but not for separate
  PHP hosts.
- The first HTML deck page response may not include rate-limit headers, so the
  service only learns Curiosa's remaining budget when Curiosa provides headers.
- The feature still depends on a non-published endpoint that can change without
  warning.
- The app currently uses a single fixed 3-second interval. This is intentionally
  conservative, while the server-side backstop uses a lighter 1-second interval.
- The service does not cache imported deck payloads, so importing the same deck
  again later will make the same two-request sequence.
- The UI shows a simple kindness message during longer waits, but it does not
  show detailed network timing, proxy reason codes, or a countdown.

## Future Improvements

More secure:

- Add server-side allow-listing in the Curiosa proxy so only `/decks/{id}` and
  the specific deck tRPC endpoint can be proxied.
- Store and display a short, user-facing reason when Curiosa rejects an import,
  without exposing raw upstream payloads in UI text.
- Consider a config flag that disables Curiosa import entirely if the community
  or site owner asks tools not to use the endpoint.
- Add automated integration coverage for the PHP throttle path, including
  `Retry-After`, max-sleep `429`, and shared lock behavior.

More fair:

- Cache successful deck imports locally by Curiosa deck ID for a short time,
  such as 15 to 60 minutes.
- Add an even lower daily/session cap for Curiosa imports from one browser.
- Add a more detailed "waiting for Curiosa rate limit" state or countdown for
  users who want to understand exactly why imports may pause.
- Add jitter to waits, for example 3 to 5 seconds, to avoid synchronized request
  bursts if many clients import at once.
- Ask Curiosa or the Sorcery community maintainers whether there is a preferred
  attribution string, contact email, or import pace.

More efficient:

- Reuse deck metadata from the public page `__NEXT_DATA__` if it ever includes
  full board data, avoiding the tRPC request entirely.
- Deduplicate concurrent imports of the same deck ID so two UI actions share one
  in-flight promise.
- Persist a lightweight import cache in IndexedDB keyed by deck ID and updated
  timestamp.
- Add structured debug logs with request type and wait duration so fairness can
  be audited without extra network traffic.

Potential issue areas:

- If Curiosa changes tRPC procedure names or response shape, imports should now
  fail loudly rather than silently importing an empty deck.
- If Curiosa begins requiring build IDs, cookies, auth, or additional headers,
  the current implementation should not attempt to bypass that automatically.
- If the deployed app has many users, watch the PHP proxy throttle headers and
  adjust the server-side settings before scaling import traffic.
