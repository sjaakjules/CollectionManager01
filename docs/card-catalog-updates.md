# Card catalogue compatibility and updates

The Sorcery API inspected on 30 September 2026 returns `engine` and `printings`
instead of the earlier `guardian` and `sets` format. This was the cause of the
startup crash at `canvasAreas.ts` (`card.guardian.type`): the raw response was
cast to `Card[]` and cached without validation.

Source: https://api.sorcerytcg.com/api/cards

## Current release — 16 November 2026

One throttled official download validated **1,169 cards**, including **120** with
the **Frost Mage Vs. Lavamancer** printing (released 13 November 2026). Both
`docs/Sorcery_CardInfo.json` and `public/assets/sorcery_cards.json` now contain
that normalized response. All 71 photographed cards have official replacements;
the Frost Mage/Lavamancer photo transcriptions are retired and archived.
A separate [Baldassare's Travels trailer preview supplement](baldassares-travels-previews.md)
now adds 46 provisional identities and one existing-card set appearance.
`Reed-cord Measurer` migrates to the official `Reed Cord Measurer` in saved
decks, canvas cards, collections and text imports. Humming Hummocks' official
artist is Jeff A. Menges. Official rules, statistics and printings are used as
published, including cases where the API omits a printed positional diagram.

The previous snapshot's nine individual Foot Soldier/Frog token records are
absent from the new feed; no saved deck is deleted because a record disappears.
The published set name is retained exactly, as is the API's `Promo` set name.
The browser cache revision is `2026-11-16`; earlier caches refresh once and
prefer the newer bundled snapshot on failure. Guest/account data is not reset.

The owner's **74 downloaded official WebPs** were imported on 16 November from
the project-local `tmp/New Cards/` directory and the subsequent Permafrost
attachment. Exact printing slugs were matched
to the official catalogue before renaming into `public/assets/Cards`. Fifty-five
files retain their original bytes; 19 sideways sites were rotated clockwise
into landscape WebPs with lossless encoding and verified visible pixels/alpha.
The import record and hashes are in `offlineData/card-images/2026-11-16.json`.
Original downloads remain locally in `tmp/imported-card-originals-2026-11-16`.

These replace all 71 photo scans plus Flame Wave, Polar Bears and Rubble.
Permafrost's official image completes the replacement; no photo images remain
in use for the photographed set.
Reprints use current engine rules/statistics: Polar Bears is cost 3, power 3;
Fireball uses the updated explosion text. No older printing overrides the
current rules. All standalone thumbnails and both atlas tiers are current:
1,220 main card images, 18 thumbnail pages and 102 medium pages, including
the subsequent 43 trailer preview images. Eight additional trailer captures
(seven Treasure variants and The White Death) are available in the preview
gallery. Existing archived token images account for the remaining difference
between the main image count and the 1,212 combined catalogue records.

Individual image URLs now include a per-card content hash, shared by canvas,
hover previews and stack panels. Builds and `cards:atlas:all` refresh these
hashes automatically so old immutable browser images cannot replace the latest
artwork. Atlas page URLs remain tied to their manifest revision.

## Runtime contract

`src/data/cardCatalog.ts` converts API responses, cached data and bundled
snapshots into the same internal `Card` model before they reach React or Pixi.
It supports both formats, including these changes:

| Current API | Internal model |
| --- | --- |
| `engine.type`, `engine.rarity` | `guardian.type`, `guardian.rarity` |
| `engine.rules`, `engine.defense` | `guardian.rulesText`, `guardian.defence` |
| `engine.air/earth/fire/water` | `guardian.thresholds` |
| `engine.elements`, `engine.subtypes` | `elements`, `subTypes` strings |
| `engine.keywords`, `engine.umbrellas` | Searchable keywords and classifications |
| `printings[].set`, `printings[].meta` | Grouped `sets[].variants` |

Evil is an umbrella classification in this feed, so it is available in the
subtype filter as well as text search. Ward is a keyword and remains searchable.
Types and finishes are open strings: a future Trap type can load without an
enum change. Unknown non-Site/non-Avatar types use portrait spell layout and
count toward spell totals. This is a display/deck-building default, not an
implementation of new gameplay mechanics. Additional orientations or special
deck rules will still require deliberate support once published.

Missing optional fields get safe defaults. Unknown cost and rarity remain
`null`; new rarity names are retained, with no invented copy limit. Known
rarities keep their existing limits. Missing current rules can fall back to
the latest usable legacy set metadata, with a warning. Records without a name
or usable type/rules record are skipped and identified in a visible warning
(full details in the console). Saved decks and collections are never rewritten
because a catalogue record is unavailable; imports still flag unknown names.

Every cache read is validated, including data cached by older app versions.
Partially broken responses never overwrite the last complete cache. A wholly
incompatible response falls back to a validated stale cache or the bundled
snapshot, with a visible notice that newer cards may be unavailable. If none
is usable, startup shows its existing retryable error. No browser-data reset
is needed, and the guest/account user-data schema is unchanged.

## Reviewing a release

Follow the [mandatory request policy](sorcery-request-policy.md) for every live
check. Use the shared download helper, reuse its saved response, and do not run
another upstream job concurrently. The app uses the same queue for cards and
decks, deduplicates simultaneous catalogue loads and retains its 24-hour cache.

1. Download the public feed once to a temporary file and validate it:
   ```sh
   pnpm sorcery:request https://api.sorcerytcg.com/api/cards /tmp/sorcery-cards.json
   pnpm cards:check /tmp/sorcery-cards.json
   ```
   This runs the same adapter as the app over **every** record and reports card
   types, sets and records needing review. An unsupported format or record
   issue gives a nonzero exit code. New type names alone are valid.
2. Review new type/rarity semantics and preview completeness. Keep a small
   representative fixture in `src/data/__fixtures__` for each upstream format
   change and add regression coverage to `cardCatalog.test.ts`.
3. After review, update `docs/Sorcery_CardInfo.json` in the normalized internal
   format used by the metadata scripts:
   ```sh
   pnpm cards:snapshot --input /tmp/sorcery-cards.json --output docs/Sorcery_CardInfo.json
   pnpm cards:snapshot
   ```
   Snapshot creation validates every record and refuses to replace the file
   if any records require repair or would be skipped.
   Update `CARD_CATALOGUE_REVISION` in `src/data/cardService.ts` to the review
   date so older browser catalogues refresh without clearing saved user data.
4. Add images to `public/assets/Cards`, then regenerate thumbnails and atlases
   with `pnpm cards:thumbs+atlas`. Metadata updates do not download artwork.
   Match incoming official printing slugs against `sets[].variants[].slug`;
   use the latest supplied printing for an existing name. Preserve original
   pixels and alpha, correcting sideways Site orientation where needed.
   The combined atlas command and every build refresh
   `src/data/cardImageVersions.json`; individual URLs use these content hashes.
   Rebuild category/deck association assets as needed using their existing
   workflows. Missing artwork displays a named placeholder and does not block
   startup; a successfully loaded image replaces it when available.
5. Run `pnpm test`, `pnpm lint`, and `pnpm build`. Check startup, filters, new
   types on desktop/phone layouts, imports and guest/offline use before deploy.

The existing bundled snapshot remains a known compatible fallback; it is not
automatically replaced by the live API during a production build.

Preview cards awaiting an official release are maintained separately and
supplement all runtime loading paths. See [Baldassare's Travels previews](baldassares-travels-previews.md)
for the active batch and [provisional photo imports](card-photo-imports.md)
for the retired Frost Mage/Lavamancer archive.

The deployed PHP route now shares its catalogue response for a day and keeps
the last good response during an upstream failure; see the request policy.
