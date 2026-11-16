# Baldassare's Travels trailer previews

Reviewed **16 November 2026** from SorceryTCG's [official trailer](https://www.youtube.com/watch?v=NPd_t2Un-4g), uploaded 15 November. The closing title at **01:23.5** announces **31 March 2027**. The [official product page](https://sorcerytcg.com/product/baldassares-travels) confirms the set name. This is a preview subset, not a complete set list or a guarantee that every card shown is a new printing.

The catalogue adds **46 provisional identities** and associates the existing **The White Death** with this set as a provisional trailer appearance, for **47 entries** in the set filter. There are **54 extracted images**, because Treasure has eight illustrations. Treasure remains one usable token record. Its crown illustration is the default in decks, and all eight images are available in the [review gallery](https://staging.sorcerystacks.com/previews/baldassares-travels.html).

The White Death retains its current official rules, statistics, older printings and full-resolution artwork. Its lower-resolution trailer crop is archived separately. All other preview cards use ordinary catalogue selection, quick-add, search, deck import/export, Collection and Maybe. The unidentified avatar is included in avatar layouts. Preview notes appear above the desktop hover image, and catalogue loading reports incomplete provisional details. Guest/account schemas are unchanged: decks still store names and quantities only.

## Image provenance and limitations

- The [extraction manifest](../offlineData/card-previews/baldassares-travels/manifest.json) records the source video, frame timestamps, original 3840 × 2160 frame coordinates, PNG source patches, hashes, perspective corners, orientation, partial-image flags, blend regions and output paths.
- Review sheets [first 26 images](../offlineData/card-previews/baldassares-travels/contact-sheet-1.jpg), [next 25](../offlineData/card-previews/baldassares-travels/contact-sheet-2.jpg), and [three cards on the booster box](../offlineData/card-previews/baldassares-travels/box-card-previews.jpg).
- [Release announcement](../offlineData/card-previews/baldassares-travels/release-announcement.jpg).
- Runtime transcriptions: `src/data/provisionalCards.json`.
- Usable card images: `public/assets/Cards/<name_slug>.webp`.
- Seven additional Treasure illustrations and The White Death trailer crop: `public/assets/CardPreviews/baldassares_travels/`.
- The unsharpened gallery crops live under `public/assets/CardPreviewFrames/baldassares-travels/`. The comparison index attaches a content hash to each URL.
- Standalone gallery: `previews/baldassares-travels.html` is built by Vite at the same public URL.

Each source patch is perspective corrected, bicubically resampled, gently sharpened, given rounded transparent corners and encoded as quality-96 WebP. Portraits are **744 × 1039**, sites **1039 × 744**.

A second pass tracked nearby frames for 22 blurry or partly covered cards and improved 15. Ten use a sharper frame, with light sharpening where it helps the text. Baron of Felbog uses three aligned frames. Blunderbuss Buffoons, Loot Goblin, The Jade Monkey and the unidentified Fae use two each. The manifest records the source and blend region for each contributing frame. Grey areas still mark portions outside the frame, and overlaps stay visible wherever every useful view is covered. Frame averages and stronger motion reversal did not recover reliable lettering on the unidentified avatar. All improvements use pixels from the trailer.

Further trials used the saved 3840 × 2160 trailer to align up to 37 frames per region across eight of the remaining soft or obstructed images. Averages and joint motion deblurring produced no reliable improvement over the reviewed crops. The hardest areas need a clearer view of the same card.

The avatar moves about 56–61 pixels per frame in the standard-size crop. Matched 4K VP9 and AV1 frames show the same diagonal smear, which points to motion blur already present in the source the two encodes share. Reversing an estimated blur from the card's tracked movement and frequency-weighted combinations of 41 aligned title crops and eight rules crops left the text unreadable. [Avatar comparison](../offlineData/card-previews/baldassares-travels/avatar-motion-comparison.jpg), [camera-motion model](https://www.di.ens.fr/willow/research/deblurring/), [frequency-weighted combination](https://www.cv-foundation.org/openaccess/content_cvpr_2015/html/Delbracio_Burst_Deblurring_Removing_2015_CVPR_paper.html).

Around 01:25–01:26, the side of the box shows **Giant Pelican**, **Treasure Map** and a third card that reads **Zarith** tentatively. The three crops are straightened and their shadows lifted. Their card text remains provisional where the packaging print is soft or covered.

The clearer footage confirms **Grand Heist** (previously transcribed as Guard Post) and **Flying Machine** (previously Flying Machines). Saved decks, collections, canvas cards and imports resolve the old spellings to the corrected names. The closer views also confirm the Sloth's two Earth symbols and 5 power and identify Spawn of Zahhak's subtype as Monster.

The local full trailer is stored at `offlineData/card-previews/baldassares-travels/local-media/baldassares-travels-trailer-4k.webm` as 3840 × 2160 VP9 video at 29.97 fps with Opus audio, combined without re-encoding. The large video stays local and outside deployed assets. The archived PNG patches are sufficient to reproduce the images without downloading the video again.

```sh
python3 scripts/extract-card-previews.py offlineData/card-previews/baldassares-travels/manifest.json .
python3 scripts/extract-card-previews.py offlineData/card-previews/baldassares-travels/manifest.json . --source-frames-only
pnpm cards:thumbs+atlas
```

The extraction command deliberately targets only the paths in the reviewed manifest. In particular, it cannot replace The White Death's official image with its trailer crop.

## Fields needing review

All records are provisional, even when the text is legible. `uncertainFields` and `notes` identify specific gaps. Unknown numerical statistics and rarity are null, unreadable rules are empty or limited to the readable keyword, and unreadable artist credits are blank. The existing numeric threshold schema uses zero for an unreadable count, accompanied by an explicit threshold uncertainty; that zero does **not** confirm absence of an element. Small tentative counts are flagged. Deck legality estimates therefore remain provisional.

| Card | Outstanding detail |
| --- | --- |
| Unidentified Avatar (BT trailer) | Robed figure with sun, moon and planets at 00:30; title, abilities and power unreadable. |
| Unidentified Site (BT trailer) | Dark site with a red doorway at 00:29.9. The alternate frame shows clearer stonework, but the title, rarity and rules are still unreadable. |
| Unidentified Fae (BT trailer) | Red Fae at 01:04. Treasure overlaps the title and power. The second frame makes its rules and artist credit clearer. |
| Enbiggen, Undari Guide, Orohi Sloth, Zig-Zag Dragonfly | Tentative title spellings to confirm against official records. Dragonfly power also needs review. |
| Broadside | Only the top portion appears; rarity and all rules are unavailable. |
| Sing-song Siren | Submerge is legible; remaining rules and the bottom of the image are cut off. |
| Realm in a Bottle | Ability cut off/covered by cloud. |
| Nellie Bly | Title and power visible; most of the card stays behind two other cards. |
| Baron of Felbog | The merged crop shows more of the transformation ability. Its left side is still too blurred for a reliable complete transcription. |
| The Jade Monkey | The right end of the rules text is still blurred despite the sharper rest of the card. |
| Loot Goblin | Cost and threshold glyphs come from an earlier, still-blurred frame and need confirmation. |
| Blunderbuss Buffoons, Man Mountain Mattis | Minor clipping/overlap at an image edge. |
| Giant Pelican | Full printed type line and artist credit are still soft. Treasure Map covers a narrow strip of the right border. |
| Treasure Map | The grid markings, full printed type line and artist credit need confirmation. |
| Zarith | Tentative title. Cost and first rules line are legible. Power, rarity, thresholds, subtype and smaller print need confirmation. |
| The White Death | Trailer appearance only; a printing in this set is not independently confirmed. |

The gallery lists all cards, individual limitations and source timestamps. Unknown and tentative names need manual matching; no fuzzy identification or invented rules are used.

## Reviewing card details

The gallery shows read-only names and ability text beneath the images. Minions come first, followed by Magic and the other spells, Sites, and Avatars. It reads the provisional transcriptions and uses the bundled official record for The White Death.

Hover from left to right to see each contributing crop in time order. The finished WebP is shown again when the pointer leaves. The source crops use only perspective correction and rounded corners. A tile loads its source images on interaction. With the image focused, the arrow keys select a frame.

Click or tap the image or title to open the enlarged image and editor. **View final** opens the finished crop directly, and the image selector switches among the finished crop and its source frames. The editor includes name, ability text, cost, power, life, all four elemental thresholds, printed type line, type, rarity, subtypes, flavour and artist. Power accepts a single number or a pair such as `3/2` for attack and defence. All eight Treasure illustrations edit the same card. Close with the button, Escape, or a click or scroll over the backdrop. The details panel can scroll while editing.

Edits are drafts saved in the browser. Reloading the gallery restores them. **Download edits** exports `baldassares-travels-edits.json` with only the changed fields, keyed by each card's original name. A blank field in the export means the reviewer cleared it. The gallery does not upload drafts to a server.

When the reviewer says they are finished, compare that file to the images and apply the accepted fields to the catalogue. Review any title changes before renaming assets and add saved-deck aliases as needed. Preserve official rules for existing printings. Set `reviewOpen` to `false` in `src/previews/baldassaresReview.tsx` after applying the edits. A closed gallery displays catalogue values with static fields and ignores the earlier drafts. Build and deploy the gallery with the updated catalogue.

## Official release replacement

`withProvisionalCards` supplements live responses, fresh/stale browser caches and the bundled fallback. An official record with a matching trimmed, case-insensitive name wins **in full**, including changed rules/statistics and printings. The existing-card trailer appearance adds only a set association and reuses its official guardian; it never overrides rules. Once an official printing for that set exists, the association disappears. Set matching tolerates punctuation and spaces. Repeated application is idempotent.

Only official upstream records enter the browser cache and the two official JSON snapshots. No additional polling, live per-card calls or artwork fetching was introduced. The shared Sorcery request limiter and daily caches are unchanged.

For the March release, follow [catalogue updates](card-catalog-updates.md) and the [request policy](sorcery-request-policy.md):

1. Reuse one throttled official response to update both snapshots and the catalogue revision.
2. Manually identify the three placeholders and review tentative spellings, including Zarith. Add explicit aliases/migrations in `catalogueMigrations.ts` **before** retiring those names, so saved decks, collections and canvas cards keep working. A differently spelled official name cannot safely match itself.
3. Retire replaced entries/appearance records from the runtime supplement. Preserve this source archive for provenance.
4. Import official artwork into the same canonical filenames and rebuild thumbnails, both atlases and image versions. Metadata refresh alone does not replace images.
5. Run the catalogue, import/merge and image-coverage checks, then build and deploy staging.

No future scheduled job was created. Replacement follows the ordinary catalogue refresh and the deliberate image import workflow.
