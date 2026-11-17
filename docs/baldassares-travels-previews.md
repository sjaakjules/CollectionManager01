# Baldassare's Travels trailer previews

Reviewed **17 November 2026** from SorceryTCG's [official trailer](https://www.youtube.com/watch?v=NPd_t2Un-4g), uploaded 15 November. The closing title at **01:23.5** announces **31 March 2027**. The [official product page](https://sorcerytcg.com/product/baldassares-travels) confirms the set name. This is a preview subset, not a complete set list or a guarantee that every card shown is a new printing.

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

Each source patch is perspective corrected and bicubically resampled. Reviewed final images use gentle sharpening or the motion restoration described below, rounded transparent corners and quality-96 WebP encoding. Portraits are **744 × 1039**, sites **1039 × 744**.

A second pass tracked nearby frames for 22 blurry or partly covered cards and improved 15. Ten used a sharper frame, with light sharpening where it helped the text. Baron of Felbog used three aligned frames. Blunderbuss Buffoons, Loot Goblin, The Jade Monkey and the unidentified Fae used two each. The manifest retains the source and blend region for each contributing frame. Grey areas mark portions outside the frame, and overlaps stay visible wherever every useful view is covered. These first trials did not recover reliable lettering on the unidentified avatar. All improvements use pixels from the trailer.

Early additional trials aligned up to 37 frames per region across eight remaining soft or obstructed images. Their averages and motion deblurring did not improve the reviewed crops. The denser sequences and region-specific inverse below subsequently improved the visible details on 17 cards. Covered or off-screen areas still need a clearer view of the same card.

The avatar moves about 56–61 pixels per frame in the standard-size crop. Matched 4K VP9 and AV1 frames show the same diagonal smear, which points to motion blur already present in the source the two encodes share. The first estimated inverse left the text unreadable. The latest joint inverse recovers a title that appears to read **Seeker**, power **1**, and much of the Treasure Map ability. Faint duplicate edges remain, so these readings still need review before changing catalogue metadata. [Latest avatar comparison](../offlineData/card-previews/baldassares-travels/avatar-recovery-comparison.jpg), [earlier trial](../offlineData/card-previews/baldassares-travels/avatar-motion-comparison.jpg), [camera-motion model](https://www.di.ens.fr/willow/research/deblurring/), [frequency-weighted combination](https://www.cv-foundation.org/openaccess/content_cvpr_2015/html/Delbracio_Burst_Deblurring_Removing_2015_CVPR_paper.html).

### Consecutive frames and motion restoration

The 17 November pass exports **2,145 source crops for the 18 requested cards**, with every consecutive frame in each tracked interval, about **33.37 ms apart**. These include partial views near the ends of the shots. Frames that are obstructed or too poorly aligned are retained for comparison and excluded from the affected reconstruction regions.

| Card | Consecutive frames | Frame indices, inclusive |
| --- | ---: | --- |
| Blunderbuss Buffoons | 152 | 460–611 |
| Flying Machine | 107 | 1501–1607 |
| Nellie Bly | 91 | 1777–1867 |
| Orohi Sloth (requested as Oroki Sloth) | 119 | 1018–1136 |
| Ogre Chef | 30 | 1462–1491 |
| Sing-song Siren | 91 | 795–885 |
| Spawn of Zahhak | 190 | 1018–1207 |
| Zarith | 195 | 2426–2620 |
| Unidentified Fae (BT trailer) | 105 | 1934–2038 |
| Zig-Zag Dragonfly | 96 | 878–973 |
| Broadside | 90 | 479–568 |
| Set Sail | 220 | 803–1022 |
| Powder Keg | 157 | 1018–1174 |
| Realm in a Bottle | 76 | 805–880 |
| The Jade Monkey | 232 | 719–950 |
| Last Bastion of Albespine | 95 | 1399–1493 |
| Unidentified Site (BT trailer) | 39 | 885–923 |
| Unidentified Avatar (BT trailer) | 60 | 891–950 |

Tracking uses optical flow and robust planar transforms. Restoration registers overlapping 300-pixel regions and selects up to 20 sharp, compatible observations for each region. A joint regularized inverse models each observation's blur direction and speed from adjacent tracked positions. The reviewed result uses an estimated exposure of half a frame, about 1/60 second. This is a fitted assumption, not camera metadata. Tests at shorter and longer exposures were less clear. Luminance restoration, overlap feathering, frequency regularization and a bounded correction limit ringing. No generated lettering or artwork is used.

Seventeen finished crops were replaced after visual comparison. The Jade Monkey uses restoration only on the blurred right side of its text. Zarith keeps its existing final crop because the packaging print did not improve. Nellie Bly, the Fae, Broadside, Sing-song Siren and Realm in a Bottle still have covered or off-screen areas. [Before/after detail comparisons](../offlineData/card-previews/baldassares-travels/motion-restoration-comparison.jpg).

The [sequence manifest](../offlineData/card-previews/baldassares-travels/sequence-manifest.json) records every frame index, timestamp and perspective transform's corner coordinates, plus the local video's checksum. [Restoration review](../offlineData/card-previews/baldassares-travels/restoration-review.json) records the selected observations and registration for each region, settings and decisions. Reviewed PNG results in `restorations/` have checksums in the extraction manifest, allowing exact final WebP regeneration. `comparison-sequences.json` supplies the versioned gallery URLs.

Around 01:25–01:26, the side of the box shows **Giant Pelican**, **Treasure Map** and a third card that reads **Zarith** tentatively. The three crops are straightened and their shadows lifted. Their card text remains provisional where the packaging print is soft or covered.

The clearer footage confirms **Grand Heist** (previously transcribed as Guard Post) and **Flying Machine** (previously Flying Machines). Saved decks, collections, canvas cards and imports resolve the old spellings to the corrected names. The closer views also confirm the Sloth's two Earth symbols and 5 power and identify Spawn of Zahhak's subtype as Monster.

The local full trailer is stored at `offlineData/card-previews/baldassares-travels/local-media/baldassares-travels-trailer-4k.webm` as 3840 × 2160 VP9 video at 29.97 fps with Opus audio, combined without re-encoding. The large video stays local and outside deployed assets. The archived PNG patches are sufficient to reproduce the images without downloading the video again.

```sh
python3 scripts/extract-card-previews.py offlineData/card-previews/baldassares-travels/manifest.json .
python3 scripts/extract-card-previews.py offlineData/card-previews/baldassares-travels/manifest.json . --source-frames-only
python3 scripts/extract-card-preview-sequences.py offlineData/card-previews/baldassares-travels/sequence-manifest.json .
pnpm cards:thumbs+atlas
```

The sequence command requires the saved local video and verifies its checksum. The other commands use the archived patches and reviewed restoration PNGs. The extraction commands deliberately target only paths in the reviewed manifests. In particular, they cannot replace The White Death's official image with its trailer crop.

## Fields needing review

All records are provisional, even when the text is legible. `uncertainFields` and `notes` identify specific gaps. Unknown numerical statistics and rarity are null, unreadable rules are empty or limited to the readable keyword, and unreadable artist credits are blank. The existing numeric threshold schema uses zero for an unreadable count, accompanied by an explicit threshold uncertainty; that zero does **not** confirm absence of an element. Small tentative counts are flagged. Deck legality estimates therefore remain provisional.

| Card | Outstanding detail |
| --- | --- |
| Unidentified Avatar (BT trailer) | Latest restoration appears to read Seeker, power 1, and reveals much of the Treasure Map ability. Review the residual blur before applying a full transcription and name migration. |
| Unidentified Site (BT trailer) | Dark site with a red doorway at 00:29.9. Ward and the following ability are substantially clearer in the latest restoration. Title and rarity need confirmation. |
| Unidentified Fae (BT trailer) | Red Fae at 01:04. Treasure overlaps the title and power. The second frame makes its rules and artist credit clearer. |
| Enbiggen, Undari Guide, Orohi Sloth, Zig-Zag Dragonfly | Tentative title spellings to confirm against official records. The restored Sloth image appears to read Oroki Sloth; review before migrating the name. Dragonfly power is clearer and needs review. |
| Broadside | Only the top portion appears; rarity and all rules are unavailable. |
| Sing-song Siren | Submerge is legible; remaining rules and the bottom of the image are cut off. |
| Realm in a Bottle | Ability cut off/covered by cloud. |
| Nellie Bly | Title and power visible; most of the card stays behind two other cards. |
| Baron of Felbog | The merged crop shows more of the transformation ability. Its left side is still too blurred for a reliable complete transcription. |
| The Jade Monkey | The right end of the rules text is improved by a local inverse. Confirm the recovered lettering against the source frames. |
| Loot Goblin | Cost and threshold glyphs come from an earlier, still-blurred frame and need confirmation. |
| Blunderbuss Buffoons, Man Mountain Mattis | Minor clipping/overlap at an image edge. |
| Giant Pelican | Full printed type line and artist credit are still soft. Treasure Map covers a narrow strip of the right border. |
| Treasure Map | The grid markings, full printed type line and artist credit need confirmation. |
| Zarith | Tentative title. Cost and first rules line are legible. Power, rarity, thresholds, subtype and smaller print need confirmation. |
| The White Death | Trailer appearance only; a printing in this set is not independently confirmed. |

The gallery lists all cards, individual limitations and source timestamps. Unknown and tentative names need manual matching; no fuzzy identification or invented rules are used.

## Reviewing card details

The gallery shows read-only names and ability text beneath the images. Minions come first, followed by Magic and the other spells, Sites, and Avatars. It reads the provisional transcriptions and uses the bundled official record for The White Death.

Hover from left to right to see the available source crops in time order. The finished WebP is shown again when the pointer leaves. Source crops use perspective correction and rounded corners, plus a shadow lift for Zarith's box panel. A tile loads only the selected frame and its immediate neighbours on interaction, keeping the previous loaded frame visible while the next loads. It never preloads the entire sequence. With the image focused, the arrow keys select a frame.

Click or tap the image or title to open the enlarged image and editor. **View final** opens the finished crop directly. The image selector, frame slider and previous/next buttons switch among the finished crop and individual source frames. The slider's first position is the finished image. The editor includes name, ability text, cost, power, life, all four elemental thresholds, printed type line, type, rarity, subtypes, flavour and artist. Power accepts a single number or a pair such as `3/2` for attack and defence. All eight Treasure illustrations edit the same card. Close with the button, Escape, or a click or scroll over the backdrop. The details panel can scroll while editing.

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
