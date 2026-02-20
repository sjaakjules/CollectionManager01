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

| Action | Effect |
|--------|--------|
| Pan | Click and drag |
| Zoom | Scroll wheel |
| Add card to deck | Double left-click |
| Remove card from deck | Double right-click |

## Roadmap

### Account & Persistence
- [ ] Account signup and login (no personal info required)
- [ ] Auto-save edits when logged in — each edit saves state automatically

### Deck & Collection Tools
- [ ] "Save Selected" button — download a text file with `quantity name` per line (e.g. `4 Crawler`)
- [ ] Filter cards — show a subset of the collection by:
  - Set, type, sub-type, threshold (inclusive or exclusive), cost, attack, defence, rarity, artist
  - Text search across card JSON data

### Canvas & Interaction
- [ ] "Add Category" functionality for custom highlight groups
- [ ] Text / labeling — users can place, move, and edit labels on the canvas

### Card Info & Rules
- [ ] Show rule text for selected card in side panel
- [ ] Codex keyword links — words in rule text that appear in the codex are clickable
- [ ] Codex search panel below rule text — updates when a codex keyword is selected, mimics curiosa.io codex behavior

## Development

See [docs/CodePlan.md](docs/CodePlan.md) for architecture details and [docs/PDR.md](docs/PDR.md) for product requirements.

## License

Private - All rights reserved
