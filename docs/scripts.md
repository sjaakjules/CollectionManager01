# Scripts Guide

This guide lists the project scripts, what they do, and the common ways to run
them. Commands assume you are in the repository root and use `pnpm`.

The project expects Node `>=20.0.0`.

## Package Script Map

These are the scripts currently exposed through `package.json`:

| Command | Underlying command | Purpose |
| --- | --- | --- |
| `pnpm dev` | `vite` | Start the local development server. |
| `pnpm build` | `tsc` and `vite build` | Typecheck and build production assets into `dist`. |
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
| `pnpm cards:atlas:all` | `cards:atlas` and `cards:atlas:medium` | Generate both atlas tiers. |
| `pnpm cards:thumbs+atlas` | `cards:thumbs` and `cards:atlas:all` | Generate standalone thumbnails and both atlas tiers. |
| `pnpm curiosa:decks` | `scripts/fetch-curiosa-decks.mjs` | Download decklists from input files into an archive. |
| `pnpm curiosa:search-decks` | `scripts/search-curiosa-decks.mjs` | Search Curiosa and archive matching decklists. |
| `pnpm associations:build` | `scripts/build-card-associations.mjs` | Build the Associations tab data asset. |

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

This includes the script tests such as Curiosa archive handling, association
generation, and deployment asset manifest logic.

## Curiosa Deck Archives

The Curiosa scripts write local archive files. These are data inputs for
offline analysis and association generation; they are separate from
`guest.json` and `username.json`.

Recommended local archive path:

```txt
offlineData/deckArchive.json
```

### `pnpm curiosa:search-decks`

Searches Curiosa, saves a search snapshot, then downloads matching decklists
into an archive.

Common command:

```sh
pnpm curiosa:search-decks --query cornerstone --output offlineData/deckArchive.json --skip-processed
```

Useful options:

```txt
--query <term>             Search term. Required.
--output <file>            Main deck archive JSON. Required.
--search-output <file>     Search snapshot JSON. Defaults to <output>.search.json.
--skipped-output <file>    Failed or invalid deck archive. Defaults to <output>.skipped.json.
--log <file>               Archive log. Defaults to <output>.log.
--card-data <file>         Card catalog. Defaults to docs/Sorcery_CardInfo.json.
--curiosa-base-url <url>   Defaults to https://curiosa.io.
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
pnpm curiosa:search-decks --query cornerstone --output offlineData/deckArchive.json --search-output offlineData/search.cornerstone.json --skip-processed
pnpm curiosa:search-decks --query riptide --output offlineData/deckArchive.json --search-output offlineData/search.riptide.json --skip-processed
pnpm curiosa:search-decks --query battlemage --output offlineData/deckArchive.json --search-output offlineData/search.battlemage.json --skip-processed
```

All three commands append/merge into `offlineData/deckArchive.json` by deck ID
and reuse `offlineData/deckArchive.json.skipped.json` unless you pass a
different `--skipped-output`.

### `pnpm curiosa:decks`

Downloads decklists from one or more input JSON files into an archive.

Common command:

```sh
pnpm curiosa:decks --input tmp/Search_SCG.json --output offlineData/deckArchive.json --skip-processed
```

Multiple input files can be passed by repeating `--input`:

```sh
pnpm curiosa:decks --input tmp/search-a.json --input tmp/search-b.json --output offlineData/deckArchive.json --skip-processed
```

Useful options:

```txt
--input <file>          Input JSON file. Can be repeated.
--output <file>         Main deck archive JSON.
--log <file>            Log file. Defaults to <output>.log.
--skipped-output <file> Failed or invalid deck archive. Defaults to <output>.skipped.json.
--card-data <file>      Card catalog. Defaults to docs/Sorcery_CardInfo.json.
--curiosa-base-url <url> Defaults to https://curiosa.io.
--limit-per-file <n>    Process only the first n entries from each input file.
--skip-processed        Do not re-fetch IDs already in output or skipped-output.
```

Validation behavior:

- Unknown mainboard cards make the deck invalid.
- Spellbooks smaller than 60 cards are skipped as invalid.
- Atlases smaller than 30 cards are skipped as invalid.
- Invalid and failed decks are preserved in `<output>.skipped.json` with
  reason, attempts, source, hint, and deckinfo when available.

## Card And Avatar Associations

### `pnpm associations:build`

Builds the read-only card/avatar association index used by the Associations UI
tab.

Default command:

```sh
pnpm associations:build
```

Defaults:

```txt
Input archive:  offlineData/deckArchive.json
Card data:      docs/Sorcery_CardInfo.json
Output:         public/assets/sorcery_card_associations_balanced.json
                public/assets/sorcery_card_associations_meta.json
Top links:      60 per source node
Threshold:      0.32
Min evidence:   3
Filters:        Constructed full decks only by default
```

Recommended command when including good skipped decks:

```sh
pnpm associations:build --include-skipped --min-spells 50 --min-atlas 20
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
--output-base <path>        Output prefix. Defaults to public/assets/sorcery_card_associations.
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
scripts/fetch-curiosa-decks.test.mjs
scripts/search-curiosa-decks.test.mjs
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

### Update Deck Data And Associations

```sh
pnpm curiosa:search-decks --query cornerstone --output offlineData/deckArchive.json --search-output offlineData/search.cornerstone.json --skip-processed
pnpm curiosa:search-decks --query riptide --output offlineData/deckArchive.json --search-output offlineData/search.riptide.json --skip-processed
pnpm associations:build --include-skipped --min-spells 50 --min-atlas 20
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
