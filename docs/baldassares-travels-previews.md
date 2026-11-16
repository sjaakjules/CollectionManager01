# Baldassare's Travels trailer previews

Reviewed **16 November 2026** from SorceryTCG's [official trailer](https://www.youtube.com/watch?v=NPd_t2Un-4g), uploaded 15 November. The closing title at **01:23.5** announces **31 March 2027**. The [official product page](https://sorcerytcg.com/product/baldassares-travels) confirms the set name. This is a preview subset, not a complete set list or a guarantee that every card shown is a new printing.

The catalogue adds **43 provisional identities** and associates the existing **The White Death** with this set as a provisional trailer appearance: **44 entries** in the set filter. There are **51 extracted images**, because Treasure has eight illustrations. Treasure remains one usable token record; its crown illustration is the default in decks. All eight images are available in the [review gallery](https://staging.sorcerystacks.com/previews/baldassares-travels.html).

The White Death retains its current official rules, statistics, older printings and full-resolution artwork. Its lower-resolution trailer crop is archived separately. All other preview cards use ordinary catalogue selection, quick-add, search, deck import/export, Collection and Maybe. The unidentified avatar is included in avatar layouts. Preview notes appear above the desktop hover image, and catalogue loading reports incomplete provisional details. Guest/account schemas are unchanged: decks still store names and quantities only.

## Image provenance and limitations

- [Extraction manifest](../offlineData/card-previews/baldassares-travels/manifest.json): source video, frame timestamps, original 3840 × 2160 frame coordinates, tight PNG source patches, hashes, perspective corners, orientation, partial-image flags and output paths.
- Review sheets: [first 26 images](../offlineData/card-previews/baldassares-travels/contact-sheet-1.jpg), [remaining 25](../offlineData/card-previews/baldassares-travels/contact-sheet-2.jpg).
- [Release announcement](../offlineData/card-previews/baldassares-travels/release-announcement.jpg).
- Runtime transcriptions: `src/data/provisionalCards.json`.
- Usable card images: `public/assets/Cards/<name_slug>.webp`.
- Seven additional Treasure illustrations and The White Death trailer crop: `public/assets/CardPreviews/baldassares_travels/`.
- Standalone gallery: `public/previews/baldassares-travels.html`.

Each source patch is perspective corrected, bicubically resampled, gently sharpened, given rounded transparent corners and encoded as quality-96 WebP. Portraits are **744 × 1039**, sites **1039 × 744**. No artwork, text or missing pixels were generated or inpainted. Offscreen areas stay grey; overlapping cards remain visible. Enlargement does not restore details lost to motion blur or the video's original card scale.

The archived PNG patches are sufficient to reproduce the images without downloading the video again. The large video and expiring download URLs are not committed.

```sh
python3 scripts/extract-card-previews.py offlineData/card-previews/baldassares-travels/manifest.json .
pnpm cards:thumbs+atlas
```

The extraction command deliberately targets only the paths in the reviewed manifest. In particular, it cannot replace The White Death's official image with its trailer crop.

## Fields needing review

All records are provisional, even when the text is legible. `uncertainFields` and `notes` identify specific gaps. Unknown numerical statistics and rarity are null, unreadable rules are empty or limited to the readable keyword, and unreadable artist credits are blank. The existing numeric threshold schema uses zero for an unreadable count, accompanied by an explicit threshold uncertainty; that zero does **not** confirm absence of an element. Small tentative counts are flagged. Deck legality estimates therefore remain provisional.

| Card | Outstanding detail |
| --- | --- |
| Unidentified Avatar (BT trailer) | Robed figure with sun, moon and planets at 00:30; title, abilities and power unreadable. |
| Unidentified Site (BT trailer) | Dark site with a red doorway at 00:30; title, rarity and rules unreadable. |
| Unidentified Fae (BT trailer) | Red Fae at 01:04; Treasure overlaps the title and power. |
| Enbiggen, Undari Guide, Orohi Sloth, Zig-Zag Dragonfly | Tentative title spellings to confirm against official records. Sloth thresholds/power and Dragonfly power also need review. |
| Broadside | Only the top portion appears; rarity and all rules are unavailable. |
| Sing-song Siren | Submerge is legible; remaining rules and the bottom of the image are cut off. |
| Realm in a Bottle | Ability cut off/covered by cloud. |
| Nellie Bly | Title and power visible; most of the card stays behind two other cards. |
| Baron of Felbog | Submerge readable; the transformation ability is too blurred for a reliable complete transcription. |
| Powder Keg, Guard Post, Krampus Crew, The Jade Monkey, Set Sail | Small/motion-blurred rule text needs confirmation; transcribed portions are flagged. Powder Keg's diagram is represented as three text rows. |
| Spawn of Zahhak, Loot Goblin | Small cost/threshold/power glyphs need confirmation as recorded per card. |
| Blunderbuss Buffoons, Man Mountain Mattis | Minor clipping/overlap at an image edge. |
| The White Death | Trailer appearance only; a printing in this set is not independently confirmed. |

The gallery lists all cards, individual limitations and source timestamps. Unknown and tentative names need manual matching; no fuzzy identification or invented rules are used.

## Official release replacement

`withProvisionalCards` supplements live responses, fresh/stale browser caches and the bundled fallback. An official record with a matching trimmed, case-insensitive name wins **in full**, including changed rules/statistics and printings. The existing-card trailer appearance adds only a set association and reuses its official guardian; it never overrides rules. Once an official printing for that set exists, the association disappears. Set matching tolerates punctuation and spaces. Repeated application is idempotent.

Only official upstream records enter the browser cache and the two official JSON snapshots. No additional polling, live per-card calls or artwork fetching was introduced. The shared Sorcery request limiter and daily caches are unchanged.

For the March release, follow [catalogue updates](card-catalog-updates.md) and the [request policy](sorcery-request-policy.md):

1. Reuse one throttled official response to update both snapshots and the catalogue revision.
2. Manually identify the three placeholders and review tentative spellings. Add explicit aliases/migrations in `catalogueMigrations.ts` **before** retiring those names, so saved decks, collections and canvas cards keep working. A differently spelled official name cannot safely match itself.
3. Retire replaced entries/appearance records from the runtime supplement. Preserve this source archive for provenance.
4. Import official artwork into the same canonical filenames and rebuild thumbnails, both atlases and image versions. Metadata refresh alone does not replace images.
5. Run the catalogue, import/merge and image-coverage checks, then build and deploy staging.

No future scheduled job was created. Replacement follows the ordinary catalogue refresh and the deliberate image import workflow.
