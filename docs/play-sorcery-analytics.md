# Play Sorcery Online card statistics

The **Card Stats** tab imports aggregate statistics from
[Play Sorcery Online](https://playsorceryonline.com/game-analytics). It works in
guest mode, saves one snapshot in IndexedDB on this browser, and makes no source
requests. It does not change `guest.json` or account JSON, upload statistics with
decks, or bundle authenticated data into public assets.

## Download without sharing credentials

1. Sign in yourself through Discord on Play Sorcery Online in your own browser.
2. Open the [full Constructed card response](https://playsorceryonline.com/api/game-analytics/cards?format=constructed)
   in that same browser. Save the response as JSON. This makes one request.
3. Alternatively, reuse a response already present in the Network inspector:
   choose the `cards?format=constructed` request, check its Preview, and use
   **Save File** in Safari. This exports the already downloaded response body.
   Safari may name it `cards` without an extension; rename it to `cards.json`.
4. In this app choose **Card Stats → Import JSON**, then select the saved file.
   **Export snapshot** saves a validated JSON envelope for later reimport.

Use the full Constructed response without date or Avatar filters. The raw API
body does not record request filters, so the import cannot recover or verify
them. This first integration supports this one cohort only. Do not mix in
Draft, Sealed, or filtered exports. The app's export envelope records the known
source URL and format, and rejects unsupported versions/formats.

Do not export HAR files, “Copy as cURL”, cookies, or request headers. A session
cookie is a credential even though it is not a Discord password. Sign in through
the browser instead of putting credentials in chat, source code, shell history,
or frontend configuration. The import allowlists aggregate fields and discards
unrelated properties; malformed input errors never repeat file content.

## Local maintenance command

```sh
pnpm analytics:import ~/Downloads/cards.json
```

For Safari's extensionless response:

```sh
pnpm analytics:import ~/Downloads/cards
```

The command uses the same validator as the UI and the existing catalogue adapter,
reports unmatched names, and writes `offlineData/playsorcery/constructed.json`
atomically with owner-only permissions. This directory is Git-ignored. Select
that file in the app's import control. It is not automatically published or
copied into `public/`. Options: `--output <file>` and `--card-data <catalogue.json>`.
An invalid input leaves the previous output intact. This command is entirely
offline and requires a Node release that supports TypeScript stripping, as do
the existing Sorcery request scripts (validated with Node 24).

## Observed data and interpretation

The response inspected on 5 November 2026 reported 24,634 matches, 49,268
player-games, 1,037 card rows, and a release cutoff of 31 October 2026 UTC.
1,017 names matched the bundled catalogue; 20 were unmatched and retained.
These are observations of that snapshot, not fixed catalogue sizes.

Top-level fields are `releasedThrough`, `dataAvailable`, `totalGames`,
`generatedAt` (Unix milliseconds), `totalPlayerGames`, and `cards`. Card rows have
`cardKey`, `cardName`, `deckShare` (0–1), and six cohorts:

| Cohort | Meaning shown by the source |
| --- | --- |
| `inDeck` | Card included in the player's deck |
| `played` | Played at least once; unreliable play histories excluded |
| `openingHand` | In the kept hand after the mulligan |
| `inHand` | Seen in hand after mulligan, including later draws |
| `notInHand` | Included but never seen in hand; incomplete histories excluded |
| `inDeckUnplayed` | Included but not played; unreliable play histories excluded |

Each cohort supplies `playerGames`, `matches`, `wins`, and `winRate` (0–1).
Some cohorts are entirely `null`. Keep those as unavailable, never zero or an
inferred complement. The UI shows the source rate and sample count, allows a
minimum sample, and preserves unknown names rather than guessing mappings.
Catalogue matching normalizes case, Unicode composition, apostrophes, and spaces.
It does not strip accents or use fuzzy matching. No card metadata is duplicated.

The drawn-rate difference is `(inHand.winRate - notInHand.winRate) * 100`, in
percentage points, and is absent if either rate is absent. Rates are descriptive,
not causal card scores or predicted deck win rates. Opponents, deck quality,
player skill, repeated players, and whether a game lasted long enough to play a
card can influence them. The same match/card may appear in several cohorts;
do not add their sample counts. No decklists or individual replays are downloaded.

The site also exposes Query data, Meta (Avatars/colors), and Site openings views.
Only the card response has been validated for this integration; these other
views are not a verified bulk export contract. The supplied video could not be
retrieved by the research tool; metric definitions above came from the dashboard.

## Request policy and future automation

This task reused the existing card response rather than polling or crawling.
The source said releases arrive in batches; its response had
`Cache-Control: private, max-age=300`. Five minutes of HTTP cache freshness is
not a recommended polling interval. Refresh manually after a new release.

Before adding unattended access or publicly redistributing these authenticated
aggregates, establish a supported API/export and its reuse terms with the site
operator. No such contract was established here. The current path needs neither
a shared login nor a cookie in the app/backend.

Any future automated client must follow the project's conservative request
rules: one request at a time, at least three seconds after completion, durable
shared pacing, respect `Retry-After` and rate-budget headers, no parallel crawls,
and reuse the last good snapshot on errors. Do not add proxy retries or automate
an interactive Discord login. Test using saved/synthetic data, not repeated live
downloads. This implementation adds no background job.
