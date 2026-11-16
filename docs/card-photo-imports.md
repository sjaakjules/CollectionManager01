# Frostmage vs Lavamancer photo import

**Status, 16 November 2026:** All 71 photographed cards now have official
SorceryTCG metadata in the bundled catalogue. The original transcriptions are
archived in `offlineData/card-photos/2026-11-13/transcriptions.json` and the
runtime supplement in `src/data/provisionalCards.json` is empty. The official
name is `Reed Cord Measurer`; saved uses of the photographed hyphenated name
migrate automatically. Humming Hummocks' artist is confirmed as **Jeff A.
Menges**. The historical uncertainty below describes the initial photo import.

The owner subsequently supplied 74 official WebPs on 16 November, including
Permafrost in a follow-up attachment. These replace all 71 photo images, plus
the earlier Flame Wave, Polar Bears and Rubble images. All thumbnails and both
atlas tiers have been rebuilt. See the
[current import record](../offlineData/card-images/2026-11-16.json) and
[catalogue update notes](card-catalog-updates.md). The photos and transcriptions
below remain an archive of the initial import, not the active metadata source.

The 13 November 2026 import contains **71 distinct photographed cards**: 35 on
the Frost Mage side and 36 on the Lavamancer side. It adds 69 new names and the
new Fireball and Winter River printings. Repeated photographs are deduplicated.
The set name was supplied by the owner; its release date is left unset.

## Images and reproducibility

- Review sheets: [Frost Mage](../offlineData/card-photos/2026-11-13/contact-sheet-frost-mage.jpg)
  and [Lavamancer](../offlineData/card-photos/2026-11-13/contact-sheet-lavamancer.jpg).
- Individual images: `public/assets/Cards/<name_slug>.webp`.
- Source photographs and four-corner manifests:
  `offlineData/card-photos/2026-11-13/batch-2/photo-{4,5,6,7}.{jpg,json}`.
  Photo 4 contains the 36 fire-side cards; Photo 5 the 8 winter sites and avatar;
  Photos 6 and 7 the remaining 26 winter cards. These are archival filenames,
  independent of the numbering in the user's duplicate uploads.
- The original overview and alternate fire overview remain in the archive.
- Previous official Fireball and Winter River images are retained under
  `offlineData/card-photos/2026-11-13/official-image-backups/`.

The best available source for each card was rotated, cropped, perspective
corrected, bicubically resampled and gently sharpened. Rounded corners use an
antialiased transparency mask. The WebPs use quality 96 and the standard full
card dimensions: **744 × 1039 portrait**, **1039 × 744 landscape**. Enlargement
does not recover lost detail. No artwork or text was generated or inpainted.

To reproduce a batch (requires Python, NumPy and OpenCV):

```sh
python3 scripts/extract-card-photos.py offlineData/card-photos/2026-11-13/batch-2/photo-4.json tmp/card-photo-review
```

Repeat for manifests 5, 6 and 7. Review the crops, copy the reviewed WebPs into
`public/assets/Cards`, then run `pnpm cards:thumbs+atlas`. This import maps all
1,177 source images into 17 thumbnail atlas pages and 99 medium atlas pages.
The established LOD sizes, page caps and device budgets are unchanged.

## Transcriptions and remaining uncertainty

`offlineData/card-photos/2026-11-13/transcriptions.json` is the archived authored transcription source. Each entry
has the existing card schema, a source photograph, `uncertainFields` and notes.
Online corroboration is recorded per entry under `verification`, with the exact
fields checked, source URL, source kind and date. It does not mark the whole card
as officially released.
Costs, thresholds, power, life, rarity, type, subtypes, rules, type lines and
legible artist/flavor credits were transcribed from the close-ups. Unprinted or
unconfirmed release information is left empty. Element symbols use the existing
`(A)`, `(E)`, `(F)`, `(W)` notation; circled costs retain their circled digits.
Printed positional diagrams are included as annotated text, with the image as
the visual reference.

The close-ups resolve the earlier working spellings to **Aria Wraith**, **Jussi
Puffins**, **Icicle Dome**, **Nanurluk**, **Swealand Longship** and **Bouldermaw**.
Jormungand and Springstem Meadow retain their printed names.

| Card | Remaining limitation |
| --- | --- |
| Lava Elemental | Another card covers its lower border in the photographs; the artist is now verified |
| Humming Hummocks | Artist credit too faint to confirm; no reliable online attribution found; left empty |

All gameplay text is transcribed. These remain provisional readings until the
official release data arrives. Lava Elemental's hidden border was not restored;
Aria Wraith's source clips a small part of its top border without losing text.

### Online validation, 13 November 2026

- **Scoria — Mark Poole.** SorceryTCG.gg reproduces the publisher's artist
  spotlight, identifying Scoria and Tundra as his first Sorcery paintings.
  This also corroborates the existing Tundra credit.
  [Artist spotlight](https://sorcerytcg.gg/fantasy-legend-mark-poole-joins-sorcery-contested-realm/).
- **Lava Elemental — Brian Smith.** Corefield's card record supplies the missing
  artist credit and matches the photographed rules and type line.
  [Card record](https://sorcery.moxfield.com/cards/fro/booster/standard/lava_elemental).
- **Ash of Effort — flavor text completed.** Corefield supplies the previously
  unreadable couplet and corroborates the existing rules and Scott Kirschner
  credit. [Card record](https://sorcery.moxfield.com/cards/fro/booster/standard/ash_of_effort).
- Corefield also corroborates the names, rules, type lines and artists for
  [Aria Wraith](https://sorcery.moxfield.com/cards/fro/booster/standard/aria_wraith),
  [Icicle Dome](https://sorcery.moxfield.com/cards/fro/booster/standard/icicle_dome)
  and [Volcanic Eruption](https://sorcery.moxfield.com/cards/fro/booster/standard/volcanic_eruption).
  In particular, Icicle Dome's Trap cost is 1 and Volcanic Eruption's is 2,
  matching the close-up transcriptions.

These are field-specific checks against an independent card catalogue and a
reproduced publisher article, not a validation of every field on all 71 cards.
The single official API request through the shared limiter failed, so no live
official catalogue was imported and the failed request was not retried. Online
set listings were incomplete/inconsistent across cached versions; they were not
used to remove photographed cards or change the release date. The remaining
Humming Hummocks credit stays unconfirmed. WebP images were unchanged.

## Official replacement and caching

`withProvisionalCards` runs for live API results, fresh cache, stale cache and
the bundled offline snapshot. New names are matched after trimming and case
normalization. When an official record for a new card appears, it wins in full,
including rules, stats and printings, without creating a duplicate.

Fireball and Winter River already existed. Each photo entry records a content
fingerprint of its known pre-release official guardian. Only while that exact
old guardian remains and the new set is absent, the app uses the photographed
guardian and appends the photographed printing, preserving older official
printings and subtypes. This matters for Fireball's new damage diagram. An
official guardian change or the arrival of the new set retires that overlay.
Set comparison tolerates spaces and punctuation, including “Frost Mage vs.
Lavamancer”. The merge is idempotent and does not mutate official records.

Only upstream records enter the official browser cache. Photo transcriptions
stay in the application bundle, so corrections take effect even with an
unexpired cache. The usual 24-hour catalogue cache remains in effect. Decks and
collections still store names and quantities; guest/account schemas are
unchanged. The official JSON snapshots remain official-only. Atlas generation
uses the same supplement function as runtime.

When official data becomes available:

1. Follow the [catalogue update workflow](card-catalog-updates.md) and
   [request policy](sorcery-request-policy.md), reusing a single saved response.
2. Review any genuine spelling differences before renaming cards already used
   in decks. Card-name matching deliberately does not use fuzzy matching.
3. Update the official snapshots and retire matching photo entries after
   confirming their replacement. Normal catalogue refreshes already prefer
   official metadata according to the rules above.
4. Replace local WebPs with official artwork using the same filename slugs and
   rebuild thumbnails and both atlases. **Metadata refresh does not download
   artwork automatically.** There is no new polling or visitor-triggered image
   download process.
5. Keep the source photos and corner manifests as provenance for corrections.
