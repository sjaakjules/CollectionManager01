# Sorcery Collection Manager

A visual deck-building tool for the Sorcery TCG. Built with React and PixiJS for smooth WebGL-powered card rendering.

## Features

- **Visual Deck Building**: Pan and zoom through your entire card collection on an interactive grid
- **Direct Card Manipulation**: Double-click to add/remove cards from your deck
- **Real-time Validation**: Deck rules enforced with clear visual feedback
- **Multiple Boards**: Main (Spellbook and Atlas), Collection, Maybe, and avatar support
- **Local-first**: Works fully offline with optional cloud sync
- **SorceryTCG deck imports**: Load SorceryTCG deck links; import/export standard deck text

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build
```

## SorceryTCG Request Limits

All SorceryTCG traffic must follow the [request policy](docs/sorcery-request-policy.md):
one request at a time, at least three seconds after completion, server-directed
cooldowns, and no bypasses for scripts or manual diagnostics. Download a live
response with `pnpm sorcery:request <https-url> <output-file>` and reuse that
file for subsequent checks. Tests use offline fixtures.

## Faster Card Startup (Thumbnails)

For API compatibility, preview cards, and the release review workflow, see
[Card catalogue updates](docs/card-catalog-updates.md). Run `pnpm cards:check`
to validate local card data, or pass a downloaded catalogue file to check it.

Generate a thumbnail set from `public/assets/Cards`:

```bash
pnpm cards:thumbs
```

Generate deterministic thumbnail atlases (`92x128` cards, `1024x1024` page cap):

```bash
pnpm cards:atlas
```

Generate deterministic medium atlases (`275x384` cards, `1112x1160` page cap):

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

- Max size: `128x128` (preserves aspect ratio, no upscaling)
- WebP quality: `56`
- WebP effort: `4`

Thumbnail, medium LOD, and atlas loading are enabled by default:

- `VITE_CARD_THUMBNAIL_ATLAS=1`
- `VITE_CARD_THUMBNAIL_ATLAS_MANIFEST=/assets/CardsThumbAtlas/manifest.json`
- `VITE_CARD_MEDIUM_ATLAS=1`
- `VITE_CARD_MEDIUM_ATLAS_MANIFEST=/assets/CardsMediumAtlas/manifest.json`

Optional custom paths:

```bash
VITE_CARD_THUMBNAIL_PATH=/assets/CardsThumb
VITE_CARD_MEDIUM_PATH=/assets/CardsMedium
```

Example for local dev:

```bash
pnpm dev
```

To disable thumbnail/medium LOD temporarily, set `VITE_CARD_LOD_ASSETS=0` in your shell.
To disable atlas loading but keep per-file thumbnails, set `VITE_CARD_THUMBNAIL_ATLAS=0`.
To disable medium atlas loading, set `VITE_CARD_MEDIUM_ATLAS=0`.

See [docs/lod-atlas-optimization.md](docs/lod-atlas-optimization.md) for the
LOD thresholds, atlas budgets, and validation workflow.

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
| `src/data/sorceryDeckService.ts` | SorceryTCG URL import and deck payload parsing | `src/ui/BottomPanel.tsx` |
| `src/data/sorceryRequest.ts` | Shared upstream queue, spacing and retry policy | Cards, decks, search, Node maintenance/dev clients |
| `src/data/importExport.ts` | Deck text import/export helpers | `src/ui/BottomPanel.tsx` |
| `src/data/userSync.ts` | Debounced server sync + merge strategy | `src/auth/api.ts`, `src/app/App.tsx` |

All of the modules above include top-of-file headers and exported function docs with explicit input/output notes.

## Deck Building Rules

- 1 Avatar
- 60 Spells maximum
- 30 Sites maximum
- 10 Collection cards
- Rarity limits: Ordinary (4x), Exceptional (3x), Elite (2x), Unique (1x)

## Controls

| Action | Effect |
| ------ | ------ |
| Left-drag empty canvas | Draw a selection rectangle (Shift adds) |
| Click a card stack | Select the stack; another click selects one card |
| Selected card + with an active canvas deck | Upper Collection / Main / Maybe row adds that card; outlined lower row adds All Selected; outside click or Escape closes |
| Double-click in a deck or stack | Select the whole stack |
| Drag a card | Move the selected card, stack or group; snap on release |
| Middle/right-drag or Space + left-drag | Pan, including mice without a middle button |
| Mouse wheel or vertical trackpad scroll | Zoom in/out at the cursor |
| Horizontal trackpad scroll | Pan sideways |
| Trackpad pinch | Zoom |
| Touch a card/stack centre and drag | Move it immediately once zoomed to a readable size |
| Touch card edges or empty canvas / pinch | Pan / zoom; overview thumbnails also pan |
| Hold a card | Show touch actions |
| Double left/right-click in the catalogue | Add to Main / remove from the active deck |
| Alt + double-click in a deck | Toggle inclusion in the current variant |
| Click a card's X | Remove that card immediately; Cmd/Ctrl+Z restores it |
| Drop a card on a label name | Join that label's group |
| Shake a card while dragging | Detach it from its label group |
| Drag a base region title / edge | Preview its move / resize around padded contents |

Deck Lookup opens on **Avatars**, then **Styles**, **Competitions**, **Favourites**
and **Added**. Added and the right-hand Decks panel share the same saved library:
manual imports, saved lookup decks and examples. Adding or removing a deck in
either panel updates both. Removal also clears its canvas area and persists
through reload, guest seeding and account sync; re-importing restores it.

Selecting a deck in the right-hand list loads and focuses it with one click.
**Hide** closes the inspector while keeping its canvas layout; **Hide deck**
hides it from the canvas but keeps the saved deck and its arrangement. Opening an existing deck
from Added preserves its card arrangement. **Reset layout** in the side panel
or canvas header asks for confirmation before restoring default rows and stacks.
It preserves card IDs, board membership and variants. **Remove deck** asks for
confirmation separately; export first to keep a copy.

Selecting an Added deck frames it above the bottom panel and displays its current
active variant's counts, card types, mana curve and average mana cost. Style
affinities are estimated locally from the bundled style catalogue using rarity
saturation and TF-IDF similarity to up to eight decks. Avatar, main deck and
Collection contribute; Maybe does not. Scores describe style affinity, not
win probability. Edits are analysed from current cards rather than a stored remote
ID; unknown cards are reported and excluded. Analysis makes no upstream requests.

Each deck canvas has separate **Main**, **Collection**, and **Maybe**
sections, in that order. Main contains Spellbook and Atlas. Collection uses ten
portrait columns on import or reset; all populated regions fit their current
contents. Moving cards changes the region bounds without moving other cards,
including when the region extends over the catalogue. Mixed-board selections
keep their boards and relative offsets. A selection from one board transfers
when dropped inside another board. Older sideboard saves migrate to Collection.

Drag a **Main**, **Spellbook**, **Atlas**, **Collection** or **Maybe** title to
move its region. Over a neighbour, the preview shows the insertion and shifts
affected cards with reduced opacity. Release to save; Escape or touch cancellation
restores the original arrangement. Moves preserve the card grid and stack offsets.
Drag an edge or corner to resize the border; cards stay fixed and their full
stack height, titles and padding form the minimum. Older decks receive a one-time
spacing repair. Subsequent manual card arrangements are retained.

Phone and desktop initially share the first edited arrangement. Editing the
other device type creates its own layout. Saved layouts contain positions only;
card contents, board membership and variants remain shared. Both layouts use the
same guest/account JSON contract.

Catalogue double-click additions always go to Main and glow until moved.
The **Layout** panel defines the catalogue's grouping and sorting hierarchy:
drag steps between arrows, double-click a step to switch Group/Sort, or use its
buttons. Element, Spellbook/Atlas and card-type groups remain after filtering.
Measured parent groups wrap to suit the viewport without changing their reading
order. Phone tools use five always-visible bottom tabs and a vertical layout
editor in narrow windows; desktop tabs rise when the pointer approaches.
Filters and layout changes leave decks, card orientations and labels intact.

Create labels from **Labels**, then drop cards on their names to form groups.
Drag a populated label to move its members, including nested label groups.
Deck movement carries its linked labels. Shaking a card detaches it; dropping
inside another board transfers it, and dropping on another label joins that
group. Custom labels move freely rather than snapping their titles to the grid;
linked labels, including empty ones, expand their parent with readable padding.
Double-click a label to rename it; saving an empty name removes the label
while keeping its cards. Touch users can also detach through the card menu.

Card removal uses one click on the X or one tap on the touch Remove action. Expressive manga
gestures use paper rims, ink keylines and gold accents, sized to the actual card
or stack, including landscape sites. Routine actions use marks without words;
occasional actions share a caption cooldown. Effects use held drawings and respect
reduced motion. Deletion uses a 1.4-second cloud →
contraction → pop → twinkles sequence, with “pooft” / “ボフッ” lettering playing
at half speed and lingering until 2.9 seconds. Rapid repeat deletions use a
compact puff. Removal happens immediately.

Adding a card plays an outward gold burst, a small settling wobble, and staggered
twinkles. The effect follows the current stack envelope, including portrait
spells and landscape sites as copies are added. Further additions to the same
stack refresh only the “POP!” / “ポンッ” words, shown for about 0.94 seconds;
they never replay the burst or wobble. Stack membership and positions stay
unchanged by animation, and repeat history clears when switching sessions.

Layout contains catalogue grouping and sorting controls. Research panels and
animation previews are local artifacts under `tmp/GraphicIdeas/`; they are never
published. Canvas effects are original vector drawings with no external image
requests. Older effect preferences remain readable in guest/account saves, but
the application uses one consistent expressive treatment.

Undo card removal with Cmd/Ctrl+Z outside text fields. It restores the exact
instance and its remaining label/variant memberships without reverting later
edits. The last 20 individual card removals are kept for the current session;
switching accounts clears this history.

Vertical wheel scrolling always zooms, including smooth and fractional wheel
movements. Space-drag pans freely in two dimensions. Zoom keeps the point under
the cursor fixed and progressively loads sharper images for visible and nearby
cards, including deck avatars. Cached images remain visible while detail loads.

## Open Work

Unimplemented or partially implemented changes are tracked in [`ToDos.md`](ToDos.md).

## Development

See [docs/CodePlan.md](docs/CodePlan.md) for architecture details and [docs/PDR.md](docs/PDR.md) for product requirements.

## Ventra Deployment

Production hosting uses Apache/PHP on Ventra with explicit FTPS uploads through `lftp`.
No deploy passwords are stored in repo files.
Deploys are built into `.deploy/sorcerystacks`, marked with `.deploy-ready.json`, and uploaded only after artifact and target safety checks pass.
Each artifact also includes `.deploy-assets.json`, a SHA-256 manifest used to upload only changed `assets/**` files after the first bootstrap deploy.

```bash
pnpm build:ventraip
pnpm deploy:staging
pnpm promote:production
```

Staging deploys to `https://staging.sorcerystacks.com`. Production promotion uploads the already-built artifact and requires typing `sorcerystacks.com`.

Store FTPS passwords in macOS Keychain before deploying:

```bash
bash scripts/add-ftps-keychain-password.sh staging
bash scripts/add-ftps-keychain-password.sh production
```

The helper prompts securely and saves Internet Password items for the configured deploy accounts.
In Keychain Access, review the saved items and prefer prompting or limited access controls rather than broad automatic access.
Do not run deploy scripts from unreviewed branches because they can read deploy credentials from Keychain.

## License

Private - All rights reserved
