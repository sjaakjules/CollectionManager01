# ToDo List

## Sorcery Collection Manager

Based on implementation phases from CodePlan.md. Tasks organized by phase with completion status.

---

## Phase 1 — Core Rendering

| Task | Status | Notes |
|------|--------|-------|
| PixiJS setup | Done | `PixiStage.ts` complete |
| Grid & snapping | Done | `Grid.ts` with 55px base unit, 6-cell cards |
| Card sprites | Done | `CardSprite.ts` with portrait/landscape support |
| Pan/zoom | Done | `Camera.ts` using pixi-viewport |
| Camera system | Done | Fit-to-content, zoom constraints |
| LOD switching | Done | `LODManager.ts` with zoom-based resolution |

**Phase 1 Remaining:**
- [x] Hover preview shows highest resolution (verified working)
- [x] Test performance with large card sets (1104 cards - working with viewport culling)
- [x] Fix site card rotation (now +90° clockwise)
- [x] Fix card dragging (requires selection before drag)
- [x] Avatar layout horizontal, sorted by set/rarity
- [x] New grid system: 55×55px grid, cards occupy 6 cells (2×3 or 3×2)
- [x] Card sizes: 110×165px portrait, 165×110px landscape
- [x] Faint background grid visible during navigation
- [x] Card stacking with 10 grid unit offset (550px)
- [x] Sites offset upward (names on bottom), spells offset downward
- [x] Click on stacked card brings to front
- [x] Selection: click to select, shift+click multi-select
- [x] Selection box: left-drag on empty/unselected, or ctrl+drag
- [x] Drag behavior: only already-selected cards can be dragged
- [x] Right-drag always pans viewport

---

## Phase 2 — Local Decks

| Task | Status | Notes |
|------|--------|-------|
| guest.json storage | Done | `userStorage.ts` with IndexedDB + localStorage fallback |
| Deck editing (add/remove) | Done | Double-click interactions |
| Board selection | Done | Mainboard/sideboard/avatar/maybeboard |
| Quantity overlays | Done | Color-coded based on collection |
| Export to .txt | Done | `importExport.ts` with Curiosa format |
| Import from .txt | Done | Parse with unknown card highlighting |

**Phase 2 Remaining:**
- [ ] Add export button to UI (SidePanel or toolbar)
- [ ] Add import button/modal to UI
- [ ] Implement collection management UI (add/remove owned cards)
- [ ] Persist active deck selection across sessions

---

## Phase 3 — UI & Rules

| Task | Status | Notes |
|------|--------|-------|
| Side panel | Done | Collapsible with deck list |
| Deck validation | Done | `deckRules.ts` with all Sorcery rules |
| Rule notifications | Done | Validation errors shown in UI |
| Deck statistics | Done | Card counts per board |
| Create/rename/delete decks | Done | Full CRUD in SidePanel |

**Phase 3 Remaining:**
- [ ] Improve deck statistics display (mana curve, type breakdown)
- [ ] Add keyboard shortcuts for common actions
- [ ] Implement undo/redo for deck edits
- [ ] Add deck copy/duplicate feature

---

## Phase 4 — Login & Sync

| Task | Status | Notes |
|------|--------|-------|
| Auth service | Partial | `authService.ts` scaffolded |
| Session management | Done | `session.ts` with localStorage |
| API wrapper | Partial | `api.ts` needs backend endpoints |
| Sync logic | Done | `userSync.ts` with debounced saves |
| Merge logic | Done | Server-precedence merge strategy |

**Phase 4 Remaining:**
- [ ] Complete LoginModal UI (password field, error states)
- [ ] Implement logout flow with data flush
- [ ] Test sync with real backend
- [ ] Handle offline mode gracefully
- [ ] Add sync status indicator to UI
- [ ] Implement guest-to-user migration flow

---

## Phase 5 — Polish

| Task | Status | Notes |
|------|--------|-------|
| Performance tuning | Not Started | |
| Error handling | Partial | Basic try/catch in place |
| UX improvements | Not Started | |
| Filters (post-MVP) | Scaffolded | `FiltersPanel.tsx` placeholder |

**Phase 5 Remaining:**
- [ ] Implement offscreen card culling for performance
- [ ] Add loading states for async operations
- [ ] Improve error messages and recovery options
- [ ] Add confirmation dialogs for destructive actions
- [ ] Implement card search/filter functionality
- [ ] Add card detail view on hover/click
- [ ] Optimize initial load time
- [ ] Add keyboard navigation
- [ ] Implement responsive layout adjustments
- [ ] Add dark/light theme support

---

## Backlog (Post-MVP)

These items are explicitly excluded from MVP per PDR section 10:

- [ ] Full filtering system (type, element, rarity, cost)
- [ ] Collection tracking with import from external sources
- [ ] Deck sharing via URL
- [ ] Curiosa.io API integration
- [ ] Card image caching strategy
- [ ] Multiple deck comparison view
- [ ] Deck archetype detection
- [ ] Play statistics tracking

---

## Technical Debt

- [ ] Replace `require()` with proper ESM imports in `authService.ts:62`
- [ ] Add comprehensive TypeScript strict mode compliance
- [ ] Add unit tests for deck validation rules
- [ ] Add integration tests for storage operations
- [ ] Document API contract for backend implementation

---

## Known Issues

1. **FiltersPanel not connected** - Filter state not wired to card rendering
2. **LoginModal incomplete** - Missing password input and validation
3. **No backend** - All backend endpoints return mock/error responses

---

*Last updated: 2026-01-16*

---

## Recent Changes (2026-01-16)

**Grid System Overhaul (v2):**
- Grid unit: 55px (visible as faint background)
- Cards occupy 6 grid cells: 2×3 portrait (110×165px), 3×2 landscape (165×110px)
- Cards centered within their grid cell area
- No gaps between cards within groups
- 4 grid unit gap between element groups, 1 grid unit gap between type subgroups

**Card Stacking:**
- Stack offset: 10 grid units (550px) for name visibility
- Spells offset downward (names on top)
- Sites offset upward (names on bottom)
- Click on stacked card brings it to front
- Offset reduces when cards removed from stack
- Top cards have higher z-index for proper click handling

**Interaction Improvements:**
- Click on unselected card: selects it (clears others)
- Click on selected card: deselects it
- Shift+click: toggle multi-selection
- Left-drag on empty space or unselected card: creates selection box
- Ctrl+drag: selection box (alternative method)
- Left-drag on already-selected card: moves all selected cards
- Right-drag: always pans viewport
