# LOD And Atlas Optimization

## Goals

The card texture pipeline separates three decisions:

- Per-card LOD size controls visual quality and total decoded pixels.
- Atlas page size controls the maximum GPU upload and decoded-memory spike.
- Runtime load timing controls which pages are requested first.

The target behavior is thumbnail-first startup for the whole catalog, then
visible and near-visible medium detail as the user zooms and pans. Desktop and
tablet-rich devices may promote close or hovered cards to individual full
images. Phone-sized constrained devices stay on thumbnail plus medium atlas
pages and do not request individual full card files.

## Current Asset Tiers

Full detail stays as individual files in `public/assets/Cards`. The source
catalog currently includes mixed source sizes:

- 668 cards at `744x1039`
- 429 cards at `380x531`
- 7 cards around `700px` high

Generated LOD tiers:

| Tier | Per-card target | Atlas cap | Output | Purpose |
| --- | ---: | ---: | --- | --- |
| Thumbnail | `92x128` | `1024x1024` | `public/assets/CardsThumbAtlas` | First reveal and zoomed-out browsing |
| Medium | `275x384` | `1112x1160` | `public/assets/CardsMediumAtlas` | Normal zoom before full detail is useful |
| Full | source file | none | `public/assets/Cards` | Desktop/tablet-rich hover and large on-screen cards |

The medium page cap is sized for the current `2px` atlas padding: four
`275px` cards across and three `384px` rows down. Many card textures are Pixi
frames into one shared atlas page source; the runtime does not crop each card
into its own canvas or image.

The standalone thumbnail fallback in `public/assets/CardsThumb` is generated at
`128px` max height. There is no standalone `CardsMedium` directory by default,
so medium file fallback is only used when `VITE_CARD_MEDIUM_PATH` is explicitly
configured.

## Generated Artifact Baseline

After the current rebuild:

| Output | Pages/files | Wire size | Decoded RGBA total | Largest page |
| --- | ---: | ---: | ---: | ---: |
| `CardsThumb` | 1,104 files | 4.4 MB on disk | per-file fallback | n/a |
| `CardsThumbAtlas` | 16 pages | 2.90 MiB | 52.1 MiB | `944x912` |
| `CardsMediumAtlas` | 92 pages | 19.88 MiB | 452.7 MiB | `1112x1160` |

Each full medium atlas page decodes to about `4.92 MiB` of RGBA pixels. The
wire size is only about 20 MiB, but the decoded total is roughly 450 MiB before
runtime copies, so phone loading must stay relevance-driven.

## Runtime Policy

Startup:

- `LODManager.getStartupLOD()` always returns `thumbnail`.
- Initial reveal loads thumbnail atlas pages one at a time on constrained
  devices and admits at most one decoded page per animation frame.
- Low-detail constrained devices, such as Save-Data or low-memory browsers,
  clamp effective LOD to thumbnail.
- Modern phone-sized constrained devices start at thumbnail, then use the
  medium atlas for relevant cards once cards are large enough. Full requests,
  including hover/tap priority requests, resolve to medium.

Zoom and pan:

- LOD selection uses estimated on-screen card height, not raw zoom alone.
- Current automatic LOD thresholds are:

| Device profile | Thumbnail | Medium atlas | Full individual files | Canvas cap |
| --- | --- | --- | --- | ---: |
| Desktop/tablet-rich | `<= 96px` card height | `> 96px` and `< 275px` | `>= 275px`, or hover/HTML preview | `2x` |
| Modern phone | `<= 110px` card height | `> 110px` | Disabled; full requests clamp to medium and HTML preview is disabled | `3x` |
| Save-Data/low-memory | Always thumbnail | Disabled | Disabled | `1.5x` |

- Full-catalog full-detail preload is disabled.
- The background loading indicator says `Loading Detail` because the active
  tier may be medium atlas pages on phones rather than full individual files.
- Full textures are pruned with an LRU policy on desktop/tablet-rich devices.
  Modern phones clamp full requests to medium and actively evict any full
  texture cache entries if they appear.

Phone medium queue:

- Medium pages are queued by atlas page, not by individual card.
- Normal phone cache budget: target `12` pages, hard max `18` pages.
- High-memory constrained phone budget: target `16` pages, hard max `24` pages.
- Save-Data/low-memory budget: target `0` pages, hard max `0` pages.
- Medium page requests load one page at a time and admit one decoded page every
  two animation frames.
- When the viewport changes, queued medium pages that are no longer relevant
  are canceled before they start.
- While panning quickly, the app keeps thumbnails visible, pauses new medium
  requests, and resumes medium loading after about `160ms` of slow/idle
  movement.

Phone medium priority order:

1. Pages used by cards intersecting the current viewport.
2. Pages used by cards within `0.75` viewport around the visible area.
3. Pages in the current pan direction.
4. Everything else is not loaded on phones.

Atlas and full-image loading:

- The thumbnail manifest is fetched on first thumbnail lookup, then only needed
  atlas pages are requested. A full initial reveal can eventually touch all
  thumbnail pages because every card starts at thumbnail quality.
- Medium atlas loading starts only after initial reveal, and only when relevant
  cards are in the medium band. Spatially adjacent cards usually share that
  page or a nearby page because atlas generation follows canvas order.
- Full detail is not atlased. On desktop/tablet-rich devices, full requests
  load individual `public/assets/Cards/<slug>.webp` files for visible,
  near-visible, hovered, or selected cards that cross the full threshold.
- The React hover-preview `<img>` is desktop/tablet-rich only. It uses
  `decoding="async"` and `loading="lazy"`, but that browser hint does not
  replace the app-managed Pixi atlas queue.

## GPU And Browser Safety

Pixi/WebGL resources must be explicitly released; JavaScript garbage
collection is not enough.

- Atlas page eviction removes all card-frame cache entries that reference the
  page, removes the page from Pixi/asset caches when present, and destroys the
  page texture source.
- `LODManager.clearCache()` cancels queued page loads, destroys standalone
  texture sources, destroys atlas page sources, and resets manifest/runtime
  state.
- `PixiStage.destroy()` clears LOD caches and destroys the Pixi app with
  texture, texture-source, child, and WebGL context cleanup.
- The Pixi canvas listens for `webglcontextlost` and
  `webglcontextrestored`. Context loss is treated as memory pressure:
  queued atlas work is canceled, caches are cleared, and visible textures are
  reloaded carefully on restore.

CSS compositor caution:

- Cards are Pixi sprites inside one canvas, not DOM card elements.
- Do not add global `will-change: transform`, `transform: translateZ(0)`,
  blur filters, backdrop filters, or per-card DOM opacity animations.
- Existing fixed overlays and shadows should stay limited to UI panels and
  previews, not multiplied across every card.

## Atlas Locality

Atlas generation is deterministic and canvas-local:

- `scripts/generate-card-thumb-atlases.mjs` reads `docs/Sorcery_CardInfo.json`.
- The script mirrors the grouped collection order used by `Grid.ts`: avatars,
  then threshold groups, then type groups, then cost/name order.
- Pages are filled sequentially from that order, so cards near each other in
  the collection layout tend to share the same or adjacent atlas pages.
- Every manifest must map all 1,104 source cards exactly once.

## Rebuild Workflow

Run after source card images or card metadata change:

```bash
pnpm cards:thumbs:force
pnpm cards:atlas:all
```

Useful dry-runs:

```bash
pnpm cards:atlas --dry-run
pnpm cards:atlas:medium --dry-run
```

Expected dry-run shape:

- Thumbnail atlas: 16 pages, 1,104 images, max page under `1024x1024`.
- Medium atlas: 92 pages, 1,104 images, max page `1112x1160`.

## Retuning Notes

Keep page size and card size as separate knobs:

- If mobile upload spikes are still high, lower atlas page caps first, then
  reduce the constrained medium atlas cache budget.
- If phone medium looks soft at close zoom, increase medium card height from
  `384` toward `448` or `512`, but re-test GPU memory carefully before
  enabling any selective full-detail phone preview.
- If zoomed-out startup is still too heavy, lower thumbnail quality or card
  height before changing runtime behavior.
- Do not reintroduce random atlas assignment; it defeats locality and can make
  nearby cards require unrelated page downloads.

Not needed in the current Pixi pipeline:

- Per-card cropped canvas or image caches.
- Global CSS layer-promotion hacks for cards.
- Full-card image loading on phones.
- A tiny medium cache for Save-Data or low-memory phones.
- Browser-native lazy loading for Pixi atlases.

Validation after retuning:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Also inspect generated manifests for:

- `cards` count equals source card count.
- No atlas page exceeds its configured width or height.
- No card references a missing page.
- No stale atlas files remain after regeneration.
