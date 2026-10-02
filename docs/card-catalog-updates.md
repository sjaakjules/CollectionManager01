# Card catalogue compatibility and updates

The Sorcery API inspected on 30 September 2026 returns `engine` and `printings`
instead of the earlier `guardian` and `sets` format. This was the cause of the
startup crash at `canvasAreas.ts` (`card.guardian.type`): the raw response was
cast to `Card[]` and cached without validation.

Source: https://api.sorcerytcg.com/api/cards

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
4. Add images to `public/assets/Cards`, then regenerate thumbnails and atlases
   with `pnpm cards:thumbs+atlas`. Metadata updates do not download artwork.
   Rebuild category/deck association assets as needed using their existing
   workflows. Missing artwork displays a named placeholder and does not block
   startup; a successfully loaded image replaces it when available.
5. Run `pnpm test`, `pnpm lint`, and `pnpm build`. Check startup, filters, new
   types on desktop/phone layouts, imports and guest/offline use before deploy.

The existing bundled snapshot remains a known compatible fallback; it is not
automatically replaced by the live API during a production build.
