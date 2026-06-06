# LOD And Atlas Optimization

## Goals

The card texture pipeline separates three decisions:

- Per-card LOD size controls visual quality and total decoded pixels.
- Atlas page size controls the maximum GPU upload and decoded-memory spike.
- Runtime load timing controls which pages are requested first.

The target behavior is thumbnail-first startup for the whole catalog, then
visible/near-visible medium detail as the user zooms and pans, with desktop
full detail reserved for close zoom and hover.

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
| Medium | `275x384` | `1024x1024` | `public/assets/CardsMediumAtlas` | Normal zoom before full detail is useful |
| Full | source file | none | `public/assets/Cards` | Hover and large on-screen cards |

The standalone thumbnail fallback in `public/assets/CardsThumb` is generated at
`128px` max height. There is no standalone `CardsMedium` directory by default,
so medium file fallback is only used when `VITE_CARD_MEDIUM_PATH` is explicitly
configured.

## Generated Artifact Baseline

After the optimized rebuild:

| Output | Pages/files | Wire size | Decoded RGBA total | Largest page |
| --- | ---: | ---: | ---: | ---: |
| `CardsThumb` | 1,104 files | 4.4 MB on disk | per-file fallback | n/a |
| `CardsThumbAtlas` | 16 pages | 2.90 MiB | 52.1 MiB | `944x912` |
| `CardsMediumAtlas` | 184 pages | 19.91 MiB | 453.6 MiB | `835x774` |

The previous optimized medium tier used 32 pages capped at `2048x2048`, with
about 19.80 MiB wire, 452.5 MiB decoded RGBA total, and a largest page around
`1943x1932`. The `1024x1024` medium tier keeps the same `275x384` per-card
quality, but splits it across many more pages so each page upload/decoded spike
is roughly 2.47 MiB. Before optimization, the legacy medium atlases were 18
pages, 35.4 MiB wire, and about 980 MiB decoded RGBA total.

## Runtime Policy

Startup:

- `LODManager.getStartupLOD()` always returns `thumbnail`.
- Initial reveal loads all card sprites at thumbnail quality.
- Low-detail constrained devices, such as Save-Data or low-memory browsers,
  clamp effective LOD to thumbnail.
- Modern phone-sized constrained devices start at thumbnail, then use the
  medium atlas for visible and near-visible cards once cards are large enough.

Zoom and pan:

- LOD selection uses estimated on-screen card height, not raw zoom alone.
- Current automatic LOD thresholds are:

| Device profile | Thumbnail | Medium atlas | Full individual files | Canvas cap |
| --- | --- | --- | --- | ---: |
| Desktop/tablet-rich | `<= 96px` card height | `> 96px` and `< 275px` | `>= 275px`, or hover | `2x` |
| Modern phone | `<= 110px` card height | `> 110px` | Disabled; full requests clamp to medium | `3x` |
| Save-Data/low-memory | Always thumbnail | Disabled | Disabled | `1.5x` |

- Background loading is scoped to visible and near-visible cards.
- Full-catalog full-detail preload is disabled.
- Full textures are pruned with an LRU policy on desktop/tablet-rich devices.
  Modern phones clamp full requests to medium, so they should not maintain a
  full-texture working set.

Atlas and full-image loading:

- Thumbnail atlas loading starts during initial reveal. The thumbnail manifest
  is fetched on first thumbnail lookup, then only the atlas pages needed for the
  reveal order are requested. Because every card is revealed at thumbnail
  quality, a normal complete startup may eventually touch all thumbnail pages.
- Medium atlas loading starts only after initial reveal, and only when visible
  or near-visible cards are in the medium band. The medium manifest is fetched
  on first medium lookup, then the page containing the visible card is loaded.
  Spatially adjacent cards usually share that page or a nearby page.
- Full detail is not atlased. On desktop/tablet-rich devices, full requests
  load individual `public/assets/Cards/<slug>.webp` files for visible,
  near-visible, hovered, or selected cards that cross the full threshold. The
  app never loads the full catalog as a startup task.
- Modern phone full requests are clamped back to medium, so phones should not
  load individual full card files during normal canvas browsing.
- Low-detail devices, including Save-Data or low-memory browsers, stay on the
  thumbnail tier and do not request medium atlas pages or full card files.

## Atlas Locality

Atlas generation is deterministic and canvas-local:

- `scripts/generate-card-thumb-atlases.mjs` reads `docs/Sorcery_CardInfo.json`.
- The script mirrors the grouped collection order used by `Grid.ts`: avatars,
  then threshold groups, then type groups, then cost/name order.
- Pages are filled sequentially from that order, so cards near each other in the
  collection layout tend to share the same or adjacent atlas pages.
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
- Medium atlas: 184 pages, 1,104 images, max page under `1024x1024`.

## Retuning Notes

Keep page size and card size as separate knobs:

- If mobile upload spikes are still high, lower atlas page caps first.
- If phone medium looks soft at close zoom, increase medium card height from
  `384` toward `448` or `512`, or re-test selective tap preview/full detail.
- If zoomed-out startup is still too heavy, lower thumbnail quality or card
  height before changing runtime behavior.
- Do not reintroduce random atlas assignment; it defeats locality and can make
  nearby cards require unrelated page downloads.

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
