# Play Sorcery Online card statistics

Card analytics are prepared **offline**, then published as a static JSON asset.
The website reads this asset once per page session for card hover details,
optional Pixi overlays, and threshold highlights in the bottom **Card Stats**
panel. It never contacts Play Sorcery Online, asks for Discord credentials, or
imports raw analytics into browser storage. Guest and account data keep the same
schema; statistics are reference data, separate from decks and collections.

## Refresh and publish

The saved response currently lives at `offlineData/playsorcery/constructed.json`
(Git-ignored). To rebuild using that file:

```sh
pnpm analytics:build
```

To prepare a newly saved response directly:

```sh
pnpm analytics:build ~/Downloads/cards.json
```

The command produces `public/assets/card_statistics.json`. Upload this file to
the site's `/assets/card_statistics.json`, or build and deploy the site normally
(`pnpm build` copies the prepared file into `dist/assets/`). The first rollout
needs the updated application as well as this asset. Later snapshots can replace
just the asset. Readers receive the new snapshot on their next page load.

The command never downloads anything. Options are `--input <file>`,
`--output <file>`, and `--card-data <catalogue.json>`. It accepts the raw response
body or the previous local archive envelope. The default catalogue is
`public/assets/sorcery_cards.json`; provisional cards are not guessed into
matches. Rebuild after catalogue updates to resolve newly known names.

Validation and canonical-name matching run before an atomic file replacement.
Invalid input preserves the previous published asset. Output is deterministic,
contains only allowlisted aggregates, and has normal public-file permissions.
The raw input is neither modified nor copied into the site. This command needs
Node with TypeScript stripping (validated with Node 24), like the other
maintenance scripts.

## Download a new snapshot without copying credentials

1. Sign in yourself at [Play Sorcery Online](https://playsorceryonline.com/game-analytics)
   in your own browser.
2. Reuse a completed `cards?format=constructed` response in the Network inspector
   when available. In Safari, select it and use **Save File**. This saves the
   already downloaded response body without another request. Safari may name it
   `cards` without an extension; the builder accepts that too.
3. Otherwise open the [full Constructed card response](https://playsorceryonline.com/api/game-analytics/cards?format=constructed)
   in the signed-in browser and save it. That makes one request.
4. Run the offline build above. Keep any raw export you want to reuse under
   `offlineData/playsorcery/`; publish only the prepared asset.

Use the full Constructed response, without date or Avatar filters. The raw body
does not record those request filters, so the builder cannot verify them.
Draft, Sealed and filtered exports are not supported by this asset contract.
Save the response body, never a HAR, request headers, “Copy as cURL”, or cookies.
The scripts need no password, session token, backend proxy, or environment secret.

Refresh manually after a new source release. The observed five-minute HTTP
cache lifetime is not a suggested polling interval. This workflow adds no
background job and needs no further live requests to rebuild or test.

## Published data contract

Version `card-statistics-v1` includes source, Constructed format, release cutoff,
source generation time, match count, player-game count, `cards`, and `unmatched`.
Both dictionaries hold only metric values and their sample sizes:

```json
{
  "inDeck": { "value": 55, "games": 200 },
  "drawnDifference": { "value": -10, "games": 100 }
}
```

This is a partial example; each card has all eight metrics below.

| Metric | Value | Sample used for minimum |
| --- | --- | --- |
| `deckShare` | Percentage of player-games including the card | All player-games |
| `inDeck` | Win rate when included in the deck | In-deck player-games |
| `played` | Win rate when played at least once | Played player-games |
| `openingHand` | Win rate when kept after the mulligan | Opening-hand player-games |
| `inHand` | Win rate when seen in hand, including later draws | In-hand player-games |
| `notInHand` | Win rate when included but never seen in hand | Never-drawn player-games |
| `inDeckUnplayed` | Win rate when included but not played | Unplayed player-games |
| `drawnDifference` | In-hand minus never-drawn win rate, in percentage points | Smaller of the two groups |

The builder converts upstream rates from 0–1 to percentages and rounds to six
decimal places. Differences retain their sign. Null values and counts remain
unavailable; the builder never infers suppressed values or treats them as zero.
Drawn difference is unavailable when either contributing rate or sample is
missing. Requiring its sample to meet a minimum ensures both groups meet it.

`cards` uses canonical catalogue names. Matching normalizes case, Unicode
composition, apostrophes and spaces; it does not strip accents or match fuzzily.
Unmatched names remain in `unmatched`, are reported by the command, and appear
in the panel's explanation. No card metadata, identity fields or request headers
are published.

The saved snapshot reports 24,634 matches, 49,268 player-games, 1,037 rows and a
release cutoff of 31 October 2026 UTC. The current catalogue matches 1,035 rows.
The two unmatched names are “Fireball 2” and “Pass plug serpent”. These counts
describe the saved snapshot, not a promise about future data.

## Display and interpretation

The bottom Card Stats panel controls hover details, up to three on-card values
and a table of editable highlight rules. Check one or more rows and switch on
**Highlight cards**. A colour appears when both the inclusive value cutoff
(≥ or ≤) and the row's minimum player-games are met. A missing value leaves
that colour absent. If several rules match, the card perimeter carries a
segment for each colour across the catalogue, decks and stacks.

**Scale end** sets the other end of the shading range. Choose three equal bands
or a smooth gradient. Both display lower numeric values darker and higher
values brighter, including for ≤ rules. Values past the scale end retain the
endpoint shade. The starting values are screens for investigation, drawing on
the examples in [Sorcery Moneyball](https://www.youtube.com/watch?v=-4p3fYyhLkM).
The sample minimum for drawn difference applies to both groups.

Switching to a category or deck-style highlight pauses statistics highlighting.
The panel retains the rules and overlay choices for the current visit.

Hover details show all metrics with exact sample sizes, flag samples below
the row's minimum and mark any matching colours. Numeric overlays include compact samples and appear when
a card is at least 160 screen pixels wide. Pixi owns rendering; React passes
memoized display models. Statistics never trigger artwork requests, change
image LOD thresholds, or run analysis on animation frames. Missing or invalid
assets disable statistics gracefully and are not retried or polled.

One match can contribute two player-games. These are observed results, not causal
card scores or predicted deck win rates. Skill, deck strength, opponents and
game length can influence rates. Played/unplayed groups exclude uncertain play
histories; never-drawn groups exclude incomplete hand histories. Cohorts overlap:
do not add their samples. No decklists or individual replays are downloaded.

The raw parser lives under `scripts/lib/`, separate from the website. The former
browser JSON upload/export interface and per-browser IndexedDB snapshot store
have been removed. Tests use synthetic data, cover failed builds retaining the
last good asset, and verify threshold/overlay behaviour without live requests.
