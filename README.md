# Sorcery Collection Manager

A visual deck-building tool for the Sorcery TCG. Built with React and PixiJS for smooth WebGL-powered card rendering.

## Features

- **Visual Deck Building**: Pan and zoom through your entire card collection on an interactive grid
- **Direct Card Manipulation**: Double-click to add/remove cards from your deck
- **Real-time Validation**: Deck rules enforced with clear visual feedback
- **Multiple Boards**: Mainboard, sideboard, avatar, and maybeboard support
- **Local-first**: Works fully offline with optional cloud sync
- **Curiosa.io Compatible**: Import/export decks in standard text format

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build
```

## Faster Card Startup (Thumbnails)

Generate a thumbnail set from `public/assets/Cards`:

```bash
pnpm cards:thumbs
```

Generate randomized thumbnail atlases (6-10 pages by default):

```bash
pnpm cards:atlas
```

Generate randomized medium atlases (380x531 cards, 16-24 pages by default):

```bash
pnpm cards:atlas:medium
```

Or generate both in one command:

```bash
pnpm cards:thumbs+atlas
```

Generate both atlas sets (thumb + medium):

```bash
pnpm cards:atlas:all
```

Re-run atlas commands whenever source card images change so atlas pages stay in sync.

Default thumbnail settings are tuned for startup speed:

- Max size: `256x256` (preserves aspect ratio, no upscaling)
- WebP quality: `58`
- WebP effort: `4`

Thumbnail LOD is enabled by default for:

- Local debug (`.env.development`)
- Production build/publish (`.env.production`)

Atlas loading is enabled by default:

- `VITE_CARD_THUMBNAIL_ATLAS=1`
- `VITE_CARD_THUMBNAIL_ATLAS_MANIFEST=/assets/CardsThumbAtlas/manifest.json`
- `VITE_CARD_MEDIUM_ATLAS=1`
- `VITE_CARD_MEDIUM_ATLAS_MANIFEST=/assets/CardsMediumAtlas/manifest.json`
- `VITE_CARD_MIN_LOD=medium` (startup/default loads use medium; thumbnail is skipped)

Optional custom paths:

```bash
VITE_CARD_THUMBNAIL_PATH=/assets/CardsThumb
VITE_CARD_MEDIUM_PATH=/assets/CardsMedium
```

Example for local dev:

```bash
pnpm dev
```

To disable thumbnail LOD temporarily, set `VITE_CARD_LOD_ASSETS=0` in your shell or Netlify env.
To disable atlas loading but keep per-file thumbnails, set `VITE_CARD_THUMBNAIL_ATLAS=0`.
To disable medium atlas loading, set `VITE_CARD_MEDIUM_ATLAS=0`.
To restore thumbnail-first startup, remove `VITE_CARD_MIN_LOD` or set `VITE_CARD_MIN_LOD=thumbnail`.

## Tech Stack

- **React 18** - UI state and panels
- **PixiJS 8** - WebGL card rendering
- **pixi-viewport** - Pan/zoom camera
- **TypeScript** - Type safety
- **Vite** - Fast development and building
- **idb-keyval** - IndexedDB storage

## Project Structure

```
src/
├── app/          # App shell, state management, startup
├── auth/         # Authentication and session management
├── data/         # Data models, storage, API services
├── rendering/    # PixiJS canvas, sprites, camera
├── rules/        # Deck validation logic
├── ui/           # React UI components
├── utils/        # Utility functions
└── styles/       # CSS styles
```

## Core Scripts

Key runtime modules and how they connect:

| File | What it does | Related modules |
| --- | --- | --- |
| `src/main.tsx` | Bootstraps React into `#root` | `src/app/App.tsx` |
| `src/app/App.tsx` | App shell, startup flow, canvas + persistence wiring | `src/app/Startup.ts`, `src/app/AppState.ts`, `src/rendering/PixiCanvas.tsx` |
| `src/app/AppState.ts` | Global reducer, context, selectors | `src/data/dataModels.ts`, `src/data/cardFilters.ts`, `src/canvas/canvasAreas.ts` |
| `src/app/Startup.ts` | Session/card/user bootstrapping | `src/auth/session.ts`, `src/data/cardService.ts`, `src/data/userStorage.ts` |
| `src/rendering/PixiCanvas.tsx` | React <-> Pixi bridge and loading overlays | `src/rendering/PixiStage.ts`, `src/data/cardFilters.ts` |
| `src/canvas/canvasAreas.ts` | Stack/deck canvas model + placement/layout helpers | `src/rendering/Grid.ts`, `src/app/App.tsx` |
| `src/data/cardFilters.ts` | Filter state + card matching engine | `src/ui/BottomPanel.tsx`, `src/rendering/PixiCanvas.tsx` |
| `src/data/curiosaService.ts` | Curiosa URL import and deck payload parsing | `src/ui/BottomPanel.tsx` |
| `src/data/importExport.ts` | Deck text import/export helpers | `src/ui/BottomPanel.tsx` |
| `src/data/userSync.ts` | Debounced server sync + merge strategy | `src/auth/api.ts`, `src/app/App.tsx` |

All of the modules above include top-of-file headers and exported function docs with explicit input/output notes.

## Deck Building Rules

- 1 Avatar
- 60 Spells maximum
- 30 Sites maximum
- 10 Sideboard cards
- Rarity limits: Ordinary (4x), Exceptional (3x), Elite (2x), Unique (1x)

## Controls

| Action                | Effect             |
| --------------------- | ------------------ |
| Pan                   | Click and drag     |
| Zoom                  | Scroll wheel       |
| Add card to deck      | Double left-click  |
| Remove card from deck | Double right-click |

## Open Work

Unimplemented or partially implemented changes are tracked in [`ToDos.md`](ToDos.md).

## Development

See [docs/CodePlan.md](docs/CodePlan.md) for architecture details and [docs/PDR.md](docs/PDR.md) for product requirements.

## License

Private - All rights reserved
