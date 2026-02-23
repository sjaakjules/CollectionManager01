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

## Roadmap

### Account & Persistence

- [ ] Account signup and login (no personal info required)
- [ ] Auto-save edits when logged in — each edit saves state automatically

### Deck & Collection Tools

- [ ] "Save Selected" button — download a text file with `quantity name` per line (e.g. `4 Crawler`)
- [ ] Filter cards — show a subset of the collection by:
  - Set, type, sub-type, threshold (inclusive or exclusive), cost, attack, defence, rarity, artist
  - Filter with Text search across card JSON data

### Canvas & Interaction

- [x] "Add Category" functionality for custom highlight groups
- [x] Text / labeling — users can place, move, and edit labels on the canvas
      • Define quadrants: Add 4 fixed world regions on the canvas: Main (top-right), Decks (bottom-right), Stacks (bottom-left), Named Zones (top-left).
      • Main quadrant = source grid: Cards can be filtered and dragged, but on release snap back to their original positions (never permanently move).
      • Implement Zones (data + render): Create a Zone model (id, name, type: custom/stack/deck, pinned, bounds, card instances) and render zones as outlined regions with a header.
      • Copy cards from main into zones: Dragging a card into any zone creates a duplicate card instance inside that zone (source stays put).
      • Create named zones: Add “+” in a right panel to create a new named zone, pinned on the canvas by default into the Named Zones quadrant at a standard size/position.
      • Zone card interactions: Allow multiple card instances per zone; instances are draggable and snap to grid.
      • Drag zone by header: Dragging a zone header moves the zone and all contained cards, snapping to grid on release.
      • Zones on top + block main hover: Zones render above main cards; while pointer is over a zone, disable main-card previews beneath. Preview should preview the card that is visibly on top.
      • Auto-expand zone bounds: When instances are placed outside current bounds, expand the zone rectangle to fit contents + padding.
      • Remove card from zone: On hovering a card instance, show a top-right delete button to remove that instance from the zone.
      • Right-side Zones Panel: Add a panel listing Decks and Named Zones with distinct styling to tell the decks from the Named zones.
      • Panel navigation: Clicking a zone in the panel moves the camera to that zone; if it’s not on-canvas, re-add it first in the correct quadrant.
      • Hide/unhide zones (not delete): “X” on a zone removes it from the canvas but keeps it in the panel (toggle pinned).
      • Stacks: load to canvas: Add a load button (public/assets/buttons/load.png) in the Stacks panel to create/pin a stack zone in the Stacks quadrant.
      • Stacks: two-way sync: Changes on canvas update the panel state and changes in panel update the canvas state.
      • Stacks: remove from canvas: Stack zones can be removed from the canvas but remain listed in the Stacks panel.
      • Decks: load from URL → deck quadrant: Loading a deck creates a deck zone pinned in the Decks quadrant.
      • Deck subzones: Deck zone contains labeled subzones: Mainboard, Sideboard, Maybeboard, plus Avatar shown in the header.
      • Decks: add deck control in panel: Move the “add deck” button to the right zone panel using public/assets/buttons/deck.png and visually distinguish deck zones from custom zones.

### Card Info & Rules

- [ ] Show rule text for selected card in side panel
- [ ] Codex keyword links — words in rule text that appear in the codex are clickable
- [ ] Codex search panel below rule text — updates when a codex keyword is selected, mimics curiosa.io codex behavior

## Development

See [docs/CodePlan.md](docs/CodePlan.md) for architecture details and [docs/PDR.md](docs/PDR.md) for product requirements.

## License

Private - All rights reserved
