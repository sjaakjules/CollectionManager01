# Code Plan
## Sorcery Collection Manager

---

## 1. Purpose of This Document

This document describes the **code-level structure and development plan** for the Sorcery Collection Manager project.
It translates the PDR into concrete implementation guidance, including:

- Repository layout
- File responsibilities
- Naming conventions
- Startup and data flow
- Authentication and data sync logic
- Implementation phases
- Developer notes and constraints

This document is intended to:
- Keep architectural decisions consistent over time
- Make refactoring safer
- Reduce "re-deriving intent" during development

---

## 2. High-Level Architecture Overview

The application is a **browser-first web app** with:

- A **WebGL rendering layer** (PixiJS) for cards and interaction
- A **React UI layer** for panels, state, and controls
- **Local-first data storage** (`guest.json`)
- **Optional backend sync** via `username.json`
- **Static asset hosting** for card images (CDN or static server)

React UI
- App State (Decks, Collection, Filters, Session)
- Panels, filters, login, notifications
- Controls

PixiJS WebGL Canvas
- Card sprites
- Grid snapping
- Pan / zoom
- Hover previews
- LOD image switching

---

## 3. Repository Layout

```
sorcery-collection-manager/
│
├─ public/
│  └─ index.html
│
├─ src/
│  ├─ app/
│  │  ├─ App.tsx               # Root React component
│  │  ├─ AppState.ts           # Global app state definition
│  │  └─ Startup.ts            # Startup flow orchestration
│  │
│  ├─ auth/
│  │  ├─ authService.ts        # Login, logout, token handling
│  │  ├─ session.ts            # Guest vs logged-in session logic
│  │  └─ api.ts                # Backend API wrapper
│  │
│  ├─ data/
│  │  ├─ dataModels.ts         # Deck, Collection, Card interfaces
│  │  ├─ cardService.ts        # Card data fetching from API
│  │  ├─ userStorage.ts        # guest.json / username.json read/write
│  │  ├─ userSync.ts           # username.json sync logic
│  │  └─ importExport.ts       # Curiosa text import/export
│  │
│  ├─ rendering/
│  │  ├─ PixiStage.ts          # PixiJS application setup
│  │  ├─ PixiCanvas.tsx        # React wrapper for PixiJS canvas
│  │  ├─ Camera.ts             # Pan/zoom (pixi-viewport)
│  │  ├─ CardSprite.ts         # Individual card rendering logic
│  │  ├─ Grid.ts               # Grid math & snapping
│  │  └─ LODManager.ts         # Image resolution switching
│  │
│  ├─ ui/
│  │  ├─ SidePanel.tsx         # Deck list & controls
│  │  ├─ FiltersPanel.tsx      # Filtering UI (post-MVP)
│  │  ├─ LoginModal.tsx        # Optional login UI
│  │  ├─ Notifications.tsx     # Rule warnings & messages
│  │  └─ Overlays.tsx          # Card count overlay utilities
│  │
│  ├─ rules/
│  │  ├─ deckRules.ts          # Deck-building validation
│  │  └─ ruleMessages.ts       # User-facing rule text
│  │
│  ├─ utils/
│  │  ├─ uuid.ts               # UUID generation
│  │  ├─ math.ts               # Grid & layout helpers
│  │  └─ debounce.ts
│  │
│  ├─ styles/
│  │  └─ ui.css
│  │
│  └─ main.tsx                 # React entry point
│
├─ docs/
│  ├─ PDR.md
│  └─ CodePlan.md
│
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ eslint.config.js
├─ .gitignore
├─ CLAUDE.md
└─ README.md
```

---

## 4. Naming Conventions

### Files
- **React components:** `PascalCase.tsx`
- **Services / logic:** `camelCase.ts`
- **Pure data / models:** `camelCase.ts`
- **Single-responsibility files** only

### Variables & Types
- Interfaces: `PascalCase` (no `I` prefix)
- Enums: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Type aliases: `PascalCase`

---

## 5. Core Data Models

Defined in `data/dataModels.ts`

### Card Data (from Sorcery API)

```ts
interface Card {
  name: string
  guardian: CardStats
  elements: string
  subTypes: string
  sets: CardSet[]
}

interface CardStats {
  rarity: 'Ordinary' | 'Exceptional' | 'Elite' | 'Unique'
  type: 'Minion' | 'Magic' | 'Aura' | 'Artifact' | 'Site' | 'Avatar'
  rulesText: string
  cost: number
  attack: number | null
  defence: number | null
  life: number | null
  thresholds: { air: number; earth: number; fire: number; water: number }
}

interface CardSet {
  name: string
  releasedAt: string
  metadata: CardStats
  variants: CardVariant[]
}

interface CardVariant {
  slug: string
  finish: 'Standard' | 'Foil'
  product: string
  artist: string
  flavorText: string
  typeText: string
}
```

### Deck Data

```ts
interface Deck {
  id: string
  name: string
  author?: string
  boards: DeckBoards
  createdAt: string
  updatedAt: string
}

interface DeckBoards {
  mainboard: DeckCard[]
  sideboard: DeckCard[]
  avatar: DeckCard[]
  maybeboard: DeckCard[]
}

interface DeckCard {
  name: string
  quantity: number
}
```

### Collection & User Data

```ts
interface CollectionItem {
  name: string
  quantity: number
}

interface UserData {
  name: string
  id: string
  decks: Deck[]
  collection: CollectionItem[]
}
```

### Deck Limits

```ts
const DECK_LIMITS = {
  AVATAR_COUNT: 1,
  SPELL_COUNT: 60,
  SITE_COUNT: 30,
  SIDEBOARD_COUNT: 10,
  RARITY_LIMITS: {
    Ordinary: 4,
    Exceptional: 3,
    Elite: 2,
    Unique: 1,
  },
}
```

**Important rule:**
guest.json and username.json MUST always conform to the same schema.

---

## 6. Startup Flow

Handled in `app/Startup.ts`

Steps: Load → Session Check → Data Load → App State → Render

1. App loads
2. Check for existing session token
   - If logged in:
     - Fetch username.json
   - Else:
     - Load or create guest.json
3. Load card data from API (with caching)
4. Initialise app state
5. Initialise PixiJS stage
6. Render cards and UI

---

## 7. Authentication & Backend Communication

**Frontend Responsibilities**
- Collect username/password
- Send credentials via HTTPS
- Store JWT in memory or localStorage
- Fetch username.json
- Save updates back to backend

**Backend Expectations (Minimal)**
- POST /login
- GET /user/:userId/data
- PUT /user/:userId/data

Backend only stores JSON blobs. No card images or metadata.

---

## 8. Rendering System Responsibilities

**PixiJS Layer**
- Card sprites (110×165px portrait, 165×110px landscape)
- Cards occupy 6 grid cells (2×3 portrait, 3×2 landscape)
- Faint background grid (55×55px cells)
- Grid snapping (cards centered within their cell area)
- Card stacking (offset 10 grid units = 550px when overlapping)
  - Spells offset downward (names on top)
  - Sites offset upward (names on bottom)
  - Click brings card to front of stack
- Pan/zoom (pixi-viewport)
- LOD switching based on zoom level
- Selection box on left-drag (empty space or unselected card)
- Quantity overlays on cards

**React Layer**
- Side panels
- Filters
- Login UI
- Notifications
- App state orchestration

**Rule:**
React NEVER directly manipulates PixiJS objects. State flows one-way from React to PixiJS.

**Grid System:**
- Grid unit: 55px (visible as faint background lines)
- Cards occupy 6 grid cells: 2×3 for portrait (110×165px), 3×2 for landscape (165×110px)
- Cards are drawn centered within their grid cell area
- Cards snap to nearest grid cell position on release
- No gaps between cards within groups
- 4 grid units gap between element groups, 1 grid unit gap between type subgroups

**Card Interaction Model:**
- Single click on unselected card: Selects it (clears other selections)
- Single click on selected card: Deselects it
- Shift+click: Toggles card in multi-selection
- Left-drag on empty space or unselected card: Creates selection box
- Ctrl+drag: Creates selection box (alternative method)
- Double left-click: Adds card to active deck
- Double right-click: Removes card from active deck
- Left-drag on already selected card: Moves all selected cards
- Right-drag anywhere: Always pans viewport
- Site cards: Rotated +90° clockwise for proper landscape display

**Card Stacking:**
- Multiple cards at same grid position are offset by 10 grid units (550px)
- Spells offset downward (names visible on top)
- Sites offset upward (names visible on bottom)
- Click on stacked card brings it to front
- Top cards have higher z-index (clickable first)
- Offset reduces automatically when cards removed from stack

**Avatar Layout:**
- Avatars displayed horizontally (12 per row)
- Sorted by set: Alpha → Beta → Arthurian Legends → Dragonlord → Gothic
- Within each set: Precon avatars (rarity: None) first, then by rarity

---

## 9. Deck Editing Flow

1. User double-clicks card
2. CardSprite sends event to callback
3. App state updates deck count via reducer
4. Rule validation runs
5. Overlays update (PixiJS reads new state)
6. Persist to storage (debounced)

---

## 10. Import / Export (Curiosa Compatibility)

**Export**
- Generate .txt
- Format: `quantity name`
- One card per line
- Board headers: `// Mainboard`, `// Sideboard`, etc.

**Import**
- Parse pasted text
- Match card names against database
- Create new deck
- Validate quantities

**Errors:**
- Highlight unknown cards (never silently drop)
- Allow user correction

---

## 11. Implementation Phases

**Phase 1 — Core Rendering**
- PixiJS setup
- Grid & snapping
- Card sprites
- Pan/zoom
- Camera system

**Phase 2 — Local Decks**
- guest.json storage
- Deck editing (add/remove cards)
- Board selection
- Quantity overlays
- Export/import

**Phase 3 — UI & Rules**
- Side panel
- Deck validation
- Rule notifications
- Deck statistics

**Phase 4 — Login & Sync**
- Auth flow
- username.json
- Merge logic
- Server sync

**Phase 5 — Polish**
- Performance tuning
- Error handling
- UX improvements
- Filters (post-MVP)

---

## 12. Developer Notes

- Treat JSON schema as a contract
- Keep backend dumb and frontend smart
- Prefer deterministic logic over animation polish
- Always preserve user data on failure
- Never block usage behind login
- Use debounced saves for storage writes
- Cull offscreen cards for performance

---

## 13. Non-Goals

- Realtime collaboration
- Mobile-first UI
- Match simulation
- Trading or marketplace features

---

## 14. Guiding Principle

The application must remain fully usable without a backend.
Login only enhances persistence, never functionality.

---
