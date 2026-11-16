# Scripts Guide

This guide lists the project scripts, what they do, and the common ways to run
them. Commands assume you are in the repository root and use `pnpm`.

The project expects Node `>=20.0.0`.

## Package Script Map

These are the scripts currently exposed through `package.json`:

| Command | Underlying command | Purpose |
| --- | --- | --- |
| `pnpm dev` | `vite` | Start the local development server. |
| `pnpm build` | Image versions, `tsc` and `vite build` | Refresh image cache versions, typecheck and build production assets into `dist`. |
| `pnpm preview` | `vite preview` | Serve the built `dist` output locally. |
| `pnpm lint` | `eslint src --ext .ts,.tsx` | Lint source files. |
| `pnpm test` | `vitest run` | Run tests. |
| `pnpm typecheck` | `tsc --noEmit` | Run TypeScript without emitting output. |
| `pnpm build:ventraip` | `scripts/build-ventraip.sh` | Build staging and production deploy artifacts. |
| `pnpm deploy:staging` | `scripts/deploy-staging.sh` | Upload the staging deploy artifact. |
| `pnpm promote:production` | `scripts/promote-production.sh` | Upload the production deploy artifact after confirmation. |
| `pnpm cards:thumbs` | `scripts/generate-card-thumbs.mjs` | Generate standalone card thumbnails. |
| `pnpm cards:thumbs:force` | `scripts/generate-card-thumbs.mjs --force` | Regenerate all standalone card thumbnails. |
| `pnpm cards:atlas` | `scripts/generate-card-thumb-atlases.mjs` | Generate the thumbnail atlas tier. |
| `pnpm cards:atlas:medium` | `scripts/generate-card-thumb-atlases.mjs` | Generate the medium atlas tier. |
| `pnpm cards:atlas:all` | Image versions, `cards:atlas` and `cards:atlas:medium` | Refresh image cache versions and generate both atlas tiers. |
| `pnpm cards:thumbs+atlas` | `cards:thumbs` and `cards:atlas:all` | Generate standalone thumbnails and both atlas tiers. |
| `pnpm cards:images:versions` | `scripts/generate-card-image-versions.mjs` | Generate per-card content hashes for cache-safe full and fallback image URLs. |
| `pnpm sorcery:request` | `scripts/sorcery-request.mjs` | Download one response through the shared host throttle. |
| `pnpm sorcery:decks` | `scripts/fetch-sorcery-decks.mjs` | Download decklists through the shared host throttle. |
| `pnpm sorcery:search-decks` | `scripts/search-sorcery-decks.mjs` | Search SorceryTCG sequentially and archive matching decks. |
| `pnpm sorcery:competitive-decks` | `scripts/search-sorcery-decks.mjs --preset competitive-2026` | Refresh competition decks and rebuild Deck Lookup. |
| `pnpm sorcery:seed-decks` | `scripts/build-guest-seed-decks.mjs` | Build bundled guest seeds from the saved archive. |
| `pnpm deck-styles:build` | `scripts/build-deck-style-associations.mjs` | Build the Deck Lookup and deck-style card score asset. |
| `pnpm analytics:import <file>` | `scripts/import-play-sorcery-analytics.mjs` | Validate a saved Play Sorcery Online response offline and archive it locally. See [the analytics workflow](play-sorcery-analytics.md). |

Helper scripts that are not package commands:

| Script | Purpose |
| --- | --- |
| `scripts/add-ftps-keychain-password.sh` | Store staging or production FTPS passwords in macOS Keychain. |
| `scripts/lib/deploy-assets.mjs` | Create and compare deployment asset manifests. |
| `scripts/lib/ventra-ftps.sh` | Shared VentraIP FTPS deployment functions. |

## App Lifecycle

### `pnpm dev`

Starts the Vite development server for local app work.

Use this when changing React, Pixi, CSS, or runtime data-loading code and you
want live reload.

```sh
pnpm dev
```

### `pnpm build`

Creates a production build in `dist`.

This script first removes the existing `dist` directory, then runs TypeScript
and Vite:

```sh
pnpm build
```

Use this before deployment or when you want to verify that the full app still
packages correctly.

### `pnpm preview`

Serves the built `dist` output locally through Vite.

Run `pnpm build` first:

```sh
pnpm build
pnpm preview
```

### `pnpm typecheck`

Runs TypeScript without emitting files.

```sh
pnpm typecheck
```

Use this for a fast type-only verification pass.

### `pnpm lint`

Runs ESLint against `src/**/*.ts` and `src/**/*.tsx`.

```sh
pnpm lint
```

### `pnpm test`

Runs the Vitest test suite.

```sh
pnpm test
```

This includes the script tests such as Sorcery archive handling, association
generation, and deployment asset manifest logic.

## SorceryTCG Deck Archives

Follow the [mandatory request policy](sorcery-request-policy.md). Every query,
page, deck download, retry and manual diagnostic uses one shared host budget:
one request at a time, at least three seconds after the previous response/failure,
plus any longer server-directed wait. Do not run parallel upstream jobs or use
raw `curl`/fetch to avoid the queue. Use saved files and mocked tests to verify
changes without contacting SorceryTCG again.

### `pnpm sorcery:request <https-url> <output-file>`

Downloads a response using the same throttle and persisted deadlines as archive
commands and Vite. Accepts HTTPS URLs on `sorcerytcg.com` and
`api.sorcerytcg.com`; it does not follow redirects. An HTTP error leaves the
existing output file untouched.

```sh
pnpm sorcery:request https://api.sorcerytcg.com/api/cards /tmp/sorcery-cards.json
pnpm cards:check /tmp/sorcery-cards.json
```

Reuse the downloaded file for subsequent validation and archive commands.

### Archive command compatibility

Use `pnpm sorcery:decks`, `pnpm sorcery:search-decks`, and
`pnpm sorcery:competitive-decks`, with `--sorcery-base-url` when needed.
Retired commands, hosts and proxy aliases have been removed. Imports use one `deck.get` request; search follows
`nextCursor` until it is absent, because the old `deck.count` endpoint is gone.
The old `relevance` search option now selects SorceryTCG's popularity order;
`latest` selects update time. Search audit counts are totals discovered so far.

The deck scripts write local archive files. These are data inputs for
offline analysis and association generation; they are separate from
`guest.json` and `username.json`.

Recommended local archive path:

```txt
offlineData/deckArchive.json
```

### `pnpm sorcery:competitive-decks`

Refreshes the competition archive using the existing `competitive-2026` preset:
36 event, placement and tournament search terms, Constructed format, and a
1 January 2026 cutoff. Matching decks are merged by ID, unchanged decklists are
reused, and new or updated lists are validated before entering the archive.
The command rebuilds Deck Lookup after the refresh.

```sh
pnpm sorcery:competitive-decks
```

For a newly released set, first download the public card catalogue and validate
it with `pnpm cards:check <file>`, then pass that file with `--card-data <file>`.
The override is used for both archive validation and the Deck Lookup rebuild.
Both legacy `guardian/sets` and current `engine/printings` catalogues are accepted.
The default is `public/assets/sorcery_cards.json`.

Use `--no-rebuild-lookup` to separate the two steps, then run
`pnpm deck-styles:build --card-data <file>` with the same catalogue. A catalogue
validation failure leaves the existing Deck Lookup asset untouched.

The 30 September 2026 refresh searched 881 unique results, selected 371 eligible
decks, added 59 and updated 29. Fourteen lists failed the existing minimum-size
rules; no network requests failed. All 631 archived decks were retained in
Deck Lookup, including 416 tagged for the 2026 competition season. Search and
skip details are recorded in `offlineData/deckArchive.json.search.json` and
`offlineData/deckArchive.json.skipped.json`.

The 4 October 2026 refresh reused the preset plus the older `place` search:

```sh
pnpm sorcery:competitive-decks --query place --skip-processed
```

It searched 37 terms once (79 search pages), found 1,012 unique results, and
downloaded 21 new valid decks. Two of those downloads came from correcting
event-name matching in the saved results, without repeating the searches.
All 100 upstream requests completed successfully, sequentially through the
shared limiter with at least three seconds after each response. The saved card
catalogue was reused, and previously processed decklists were not downloaded.

The archive and rebuilt Deck Lookup now contain 652 decks. Reclassification
from cached titles and primers made another 42 existing decks visible in
Competitions, for 479 decks in the 2026 season. All 631 previous deck contents
were retained; only their competition annotations were refreshed locally.
New event facets are Ed Beard Jr Championship, Elemental Series, Fall Classic,
Forja Hobby Store 1K, Sin City Open, Sorcerers at the Core, Texas League,
Tournament Grounds, Twin Cities Peasant League, and Unland Cup. Invercargill,
London, Milan, Oulu, Texas, and Tuscany also now appear as location facets.
The newly discovered Texas League, Milano, and Toscana titles supplied the
additional labels; reviewing them required no further upstream calls.
Event seasons written directly after a name,
such as `SorceryCon26`, take priority over historical years in a primer.

### `pnpm sorcery:search-decks`

Searches SorceryTCG, saves a search snapshot, then downloads matching decklists
into an archive.

Common command:

```sh
pnpm sorcery:search-decks --query cornerstone --output offlineData/deckArchive.json --skip-processed
```

Useful options:

```txt
--query <term>             Search term. Required.
--output <file>            Main deck archive JSON. Required.
--search-output <file>     Search snapshot JSON. Defaults to <output>.search.json.
--skipped-output <file>    Failed or invalid deck archive. Defaults to <output>.skipped.json.
--log <file>               Archive log. Defaults to <output>.log.
--card-data <file>         Card catalog. Defaults to public/assets/sorcery_cards.json.
--sorcery-base-url <url>   Defaults to https://sorcerytcg.com.
--min-views <n>            Download only decks with at least n views.
--min-likes <n>            Download only decks with at least n likes.
--max-decks <n>            Stop after this many filtered decks.
--page-size <n>            Search page size. Defaults to 30.
--skip-processed           Do not re-fetch IDs already in output or skipped-output.
```

Archive behavior:

- The main archive is a JSON object keyed by deck ID.
- Running multiple searches with the same `--output` merges decks by ID.
- Existing deck IDs are updated only when the fetched deck is newer.
- Invalid decks are written to the skipped archive instead of the main archive.
- If an ID later becomes valid, it is moved out of the skipped archive.
- `--skip-processed` skips IDs already found in either the main archive or the
  skipped archive.

Search snapshot behavior:

- `--search-output` is a snapshot for the current query.
- If you reuse the default `<output>.search.json`, each search rewrites that
  search snapshot.
- If you want to keep one search JSON per query, pass a unique
  `--search-output`.

Example multi-query workflow:

```sh
pnpm sorcery:search-decks --query cornerstone --output offlineData/deckArchive.json --search-output offlineData/search.cornerstone.json --skip-processed
pnpm sorcery:search-decks --query riptide --output offlineData/deckArchive.json --search-output offlineData/search.riptide.json --skip-processed
pnpm sorcery:search-decks --query battlemage --output offlineData/deckArchive.json --search-output offlineData/search.battlemage.json --skip-processed
```

All three commands append/merge into `offlineData/deckArchive.json` by deck ID
and reuse `offlineData/deckArchive.json.skipped.json` unless you pass a
different `--skipped-output`.

### `pnpm sorcery:decks`

Downloads decklists from one or more input JSON files into an archive.

Common command:

```sh
pnpm sorcery:decks --input tmp/Search_SCG.json --output offlineData/deckArchive.json --skip-processed
```

Multiple input files can be passed by repeating `--input`:

```sh
pnpm sorcery:decks --input tmp/search-a.json --input tmp/search-b.json --output offlineData/deckArchive.json --skip-processed
```

Useful options:

```txt
--input <file>          Input JSON file. Can be repeated.
--output <file>         Main deck archive JSON.
--log <file>            Log file. Defaults to <output>.log.
--skipped-output <file> Failed or invalid deck archive. Defaults to <output>.skipped.json.
--card-data <file>      Card catalog. Defaults to public/assets/sorcery_cards.json.
--sorcery-base-url <url> Defaults to https://sorcerytcg.com.
--limit-per-file <n>    Process only the first n entries from each input file.
--skip-processed        Do not re-fetch IDs already in output or skipped-output.
```

Validation behavior:

- Unknown mainboard cards make the deck invalid.
- Spellbooks smaller than 60 cards are skipped as invalid.
- Atlases smaller than 30 cards are skipped as invalid.
- Invalid and failed decks are preserved in `<output>.skipped.json` with
  reason, attempts, source, hint, and deckinfo when available.

## Legacy Card And Avatar Associations

### `node scripts/build-card-associations.mjs`

Builds the old offline card/avatar association index. This no longer feeds the
live UI; generated files are kept under `tmp/oldAssociations` for reference.

Default command:

```sh
node scripts/build-card-associations.mjs
```

Defaults:

```txt
Input archive:  offlineData/deckArchive.json
Card data:      docs/Sorcery_CardInfo.json
Output:         tmp/oldAssociations/sorcery_card_associations_balanced.json
                tmp/oldAssociations/sorcery_card_associations_meta.json
Top links:      60 per source node
Threshold:      0.32
Min evidence:   3
Filters:        Constructed full decks only by default
```

Recommended command when including good skipped decks:

```sh
node scripts/build-card-associations.mjs --include-skipped --min-spells 50 --min-atlas 20
```

This loads:

```txt
offlineData/deckArchive.json
offlineData/deckArchive.json.skipped.json
```

and includes skipped decks that still have at least 50 spellbook cards and 20
atlas cards in their embedded deckinfo.

Useful options:

```txt
--archive <file>            Deck archive JSON. Defaults to offlineData/deckArchive.json.
--include-skipped           Include filtered decks from the skipped archive.
--skipped-archive <file>    Skipped archive. Defaults to <archive>.skipped.json.
--min-spells <n>            Minimum skipped spellbook cards. Defaults to 50.
--min-atlas <n>             Minimum skipped atlas cards. Defaults to 20.
--card-data <file>          Card catalog. Defaults to docs/Sorcery_CardInfo.json.
--output-base <path>        Output prefix. Defaults to tmp/oldAssociations/sorcery_card_associations.
--output <file>             Compatibility alias; writes both suffixed mode assets.
--top-links <n>             Links per source node. Defaults to 60.
--threshold <n>             Deck graph similarity threshold. Defaults to 0.32.
--min-evidence <n>          Reliability midpoint. Defaults to 3.
--spellbook-weight <n>      Similarity weight. Defaults to 0.75.
--atlas-weight <n>          Similarity weight. Defaults to 0.20.
--collection-weight <n>     Similarity weight. Defaults to 0.00.
--avatar-weight <n>         Similarity weight. Defaults to 0.05.
--allow-non-constructed     Include non-Constructed decks.
--allow-incomplete          Include decks below full deck size.
```

Association model:

- `main` is deck avatar plus spellbook plus atlas.
- `collection` is the deck collection zone.
- `maybe` is ignored.
- Cards and avatars are canonical node IDs in `nodes`, with `card:<name>` and
  `avatar:<name>` kept separate.
- Zone evidence is stored on directed edge channels: `mainMain`,
  `mainCollection.mainToCollection`, `mainCollection.collectionToMain`, and
  `collectionCollection`.
- Deck archetype clusters are built with Graphology Louvain using weighted
  edges and deterministic traversal (`randomWalk: false`). If Graphology
  clustering fails, the builder falls back to the deterministic greedy
  modularity approximation.
- Balanced mode uses `1 / sqrt(clusterSize)` deck weights. Meta mode uses
  deck weight `1`.
- The generated files are public static assets. They are intentionally not
  stored in `guest.json` or `username.json`.

## Card Image Assets

Source card images live in:

```txt
public/assets/Cards
```

### `pnpm cards:thumbs`

Generates standalone WebP thumbnail files in `public/assets/CardsThumb`.

```sh
pnpm cards:thumbs
```

Direct script options:

```txt
--input <dir>        Source directory. Defaults to public/assets/Cards.
--output <dir>       Output directory. Defaults to public/assets/CardsThumb.
--size <px>          Max width/height. Defaults to 128.
--quality <1-100>    WebP quality. Defaults to 56.
--effort <0-6>       WebP encode effort. Defaults to 4.
--concurrency <num>  Parallel encodes. Defaults to 8.
--limit <num>        Process only first N files.
--force              Rebuild even if output is newer.
--dry-run            Show work without writing files.
```

### `pnpm cards:thumbs:force`

Regenerates all standalone thumbnail files, even when existing output looks
current.

```sh
pnpm cards:thumbs:force
```

### `pnpm cards:atlas`

Builds the thumbnail atlas tier in `public/assets/CardsThumbAtlas`.

```sh
pnpm cards:atlas
```

The package command uses:

```txt
Input:       public/assets/Cards
Output:      public/assets/CardsThumbAtlas
Card size:   92 x 128
Atlas size:  1024 x 1024
Quality:     58
Effort:      4
```

### `pnpm cards:atlas:medium`

Builds the medium atlas tier in `public/assets/CardsMediumAtlas`.

```sh
pnpm cards:atlas:medium
```

The package command uses:

```txt
Input:       public/assets/Cards
Output:      public/assets/CardsMediumAtlas
Card size:   275 x 384
Atlas size:  1112 x 1160
Quality:     64
Effort:      4
```

### `pnpm cards:atlas:all`

Builds both atlas tiers:

```sh
pnpm cards:atlas:all
```

Equivalent to:

```sh
pnpm cards:atlas
pnpm cards:atlas:medium
```

### `pnpm cards:thumbs+atlas`

Builds standalone thumbnails and both atlas tiers:

```sh
pnpm cards:thumbs+atlas
```

Equivalent to:

```sh
pnpm cards:thumbs
pnpm cards:atlas:all
```

### `scripts/generate-card-thumb-atlases.mjs`

The atlas generator can also be run directly when you need custom dimensions.

```sh
node scripts/generate-card-thumb-atlases.mjs --input public/assets/Cards --output public/assets/CardsThumbAtlas --card-width 92 --card-height 128
```

Useful direct options:

```txt
--input <dir>          Source directory. Defaults to public/assets/Cards.
--output <dir>         Output directory. Defaults to public/assets/CardsThumbAtlas.
--atlas-width <px>     Atlas page width. Defaults to 1024.
--atlas-height <px>    Atlas page max height. Defaults to 1024.
--atlas-count <num>    Fixed number of atlases using contiguous layout chunks.
--padding <px>         Pixel spacing between sprites. Defaults to 2.
--card-width <px>      Force packed card width. Defaults to 92.
--card-height <px>     Force packed card height. Defaults to 128.
--resize-fit <mode>    contain, cover, fill, or inside. Defaults to contain.
--order <mode>         canvas, name, or file. Defaults to canvas.
--metadata <file>      Card metadata for canvas order. Defaults to docs/Sorcery_CardInfo.json.
--quality <1-100>      Atlas WebP quality. Defaults to 58.
--effort <0-6>         Atlas WebP effort. Defaults to 4.
--dry-run              Compute layout without writing files.
```

## VentraIP Deployment

Deployment targets are configured in `hosting/ventraip.deploy.json`.

The scripts use explicit FTPS through `lftp` and read passwords from macOS
Keychain. They refuse unexpected hosts, ports, usernames, domains, missing
artifacts, incomplete artifacts, and secret-like files in the deploy output.

Install `lftp` if needed:

```sh
brew install lftp
```

### `bash scripts/add-ftps-keychain-password.sh <target>`

Stores the FTPS password in macOS Keychain without putting it in shell history.

Targets:

```txt
staging
production
```

Commands:

```sh
bash scripts/add-ftps-keychain-password.sh staging
bash scripts/add-ftps-keychain-password.sh production
```

Use this before the first deploy on a machine, or when the hosting password
changes.

### `pnpm build:ventraip`

Builds deploy-ready staging and production artifacts under:

```txt
.deploy/sorcerystacks/staging
.deploy/sorcerystacks/production
```

```sh
pnpm build:ventraip
```

This command:

- Runs `pnpm build`.
- Copies the built frontend from `dist`.
- Copies the PHP API from `server/php/api`.
- Applies the staging and production `.htaccess` files.
- Writes `.deploy-ready.json` markers.
- Writes `.deploy-assets.json` asset manifests.
- Refuses artifacts containing `.env*`, `*.duck`, or common system files.

### `pnpm deploy:staging`

Uploads the existing staging artifact to the staging domain.

```sh
pnpm build:ventraip
pnpm deploy:staging
```

Important: `deploy:staging` does not rebuild. It deploys the current
`.deploy/sorcerystacks/staging` artifact.

### `pnpm promote:production`

Uploads the existing production artifact to production.

```sh
pnpm promote:production
```

Important behavior:

- This does not rebuild.
- It uploads `.deploy/sorcerystacks/production`.
- It prompts for the configured confirmation text before uploading.
- The current confirmation text is `sorcerystacks.com`.

Recommended production flow:

```sh
pnpm build:ventraip
pnpm deploy:staging
pnpm promote:production
```

### `scripts/lib/deploy-assets.mjs`

Internal helper used by the deployment scripts to create and compare managed
asset manifests. You usually do not need to run it directly.

Direct commands are available for debugging:

```sh
node scripts/lib/deploy-assets.mjs write-manifest <artifact-dir> [manifest-path]
node scripts/lib/deploy-assets.mjs plan <artifact-dir> <remote-manifest-path|-> <plan-path> [upload-root]
node scripts/lib/deploy-assets.mjs compare <local-manifest-path> <remote-manifest-path|-> [plan-path]
```

### `scripts/lib/ventra-ftps.sh`

Internal shell library used by `deploy-staging.sh`,
`promote-production.sh`, and `add-ftps-keychain-password.sh`.

It handles:

- Target validation.
- Keychain password lookup.
- `lftp` command generation.
- Non-asset file mirroring.
- Asset manifest download.
- Uploading changed assets.
- Deleting stale managed assets.
- Publishing the new remote asset manifest.

## Script Tests

The `.test.mjs` files under `scripts/` are Vitest test files, not manual
commands.

Current script-related test files:

```txt
scripts/build-card-associations.test.mjs
scripts/fetch-sorcery-decks.test.mjs
scripts/search-sorcery-decks.test.mjs
scripts/lib/deploy-assets.test.mjs
```

Run them with the full suite:

```sh
pnpm test
```

or target one file:

```sh
pnpm test scripts/build-card-associations.test.mjs
```

## Common Workflows

### Update Deck Data And Deck Lookup

```sh
pnpm sorcery:search-decks --query cornerstone --output offlineData/deckArchive.json --search-output offlineData/search.cornerstone.json --skip-processed
pnpm sorcery:search-decks --query riptide --output offlineData/deckArchive.json --search-output offlineData/search.riptide.json --skip-processed
pnpm deck-styles:build
pnpm test
pnpm typecheck
pnpm build
```

### Rebuild Card Image LOD Assets

```sh
pnpm cards:thumbs+atlas
pnpm build
```

### Verify A Code Change

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

### Deploy A Staging Candidate

```sh
pnpm test
pnpm typecheck
pnpm build:ventraip
pnpm deploy:staging
```

### Promote The Same Artifact To Production

```sh
pnpm promote:production
```
