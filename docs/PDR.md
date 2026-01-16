# Project Design Requirements (PDR)
## Sorcery Collection Manager

---

## 1. Project Summary

**Project Name:** Sorcery Collection Manager  
**Platform:** Web Application (desktop-first)  
**Domain:** Trading Card Game (TCG) Deck Builder  

Sorcery Collection Manager is a web-based visual deck-building tool for the Sorcery TCG. It presents to the user the entire card collection on an interactive, zoomable grid and allows decks to be built through direct manipulation of card images. The experience is designed to feel tactile and spatial, like working on a tabletop, while providing digital affordances such as filtering, validation, and persistence.

---

## 2. Core Goals

1. Enable fast, intuitive deck construction using direct card interaction.
2. Display large card collections with smooth pan and zoom.
3. Enforce deck-building rules in real time with clear visual feedback.
4. Persist user decks via simple authentication.

---

## 3. Target Users

- Sorcery TCG players
- Deck builders who value visual and spatial browsing
- Desktop users with mouse and keyboard input

---

## 4. Technology & Architecture (High-Level)

### 4.1 Frontend

**Recommended Stack**
- **React** — UI state, panels, auth state
- **PixiJS (WebGL)** — card rendering, pan/zoom, interaction
- **pixi-viewport** — camera-style navigation

**Rationale**
- WebGL rendering is required for thousands of images being zoomed and scaled.
- PixiJS is optimised for 2D sprite-heavy scenes and LOD texture handling.
- React cleanly manages application state without burdening rendering performance.

---

### 4.2 Backend, Data Storage and Authentication

**Typical usage**
- Card images are hosted remotely and fetched via standard HTTP/CDN
- On first load, a **guest.json** is created in browser storage (IndexedDB / LocalStorage)
- Structure:
    {
        "name": "Guest",
        "id": "<guest-uuid>",
        "decks": [
            { "name": "Example Deck", "cards": [{ "name": "Cave Trolls", "quantity": 4 }] }
        ],
        "collection": [
            { "name": "Cave Trolls", "quantity": 10 }
        ]
    }
- User optionally provides username + password to log in and fetch user.json in guest.json format with changes saved automatically.

**Backend API Responsibilities**
- Authenticate username/password
- Return JWT token for session
- Serve username.json on request:
  - Structure identical to guest.json
  - Contains decks and collection
- Accept updates to username.json when decks or collection are modified

**Frontend Responsibilities**
- Store session token securely (memory or local storage)
- Include token in Authorization header for API requests
- Merge downloaded username.json with any local guest.json if needed
- Allow seamless saving of decks/collection to server

**Security Notes**
- All backend communication occurs over HTTPS
- Authentication is token-based (JWT)
- No passwords are stored in the frontend
- By default users are guest-only until creating / logging into an account

### 4.3 Fetched data

- Card data from sorcery API: https://api.sorcerytcg.com/api/cards as JSON:
    {
        name, guardian (card characteristics), elements, subtypes, sets{name, releaseAt, metadata (card characteristics), variants}
    }
- Deck data from ​user supplied URL with format: https://curiosa.io/decks/{deck_id}
  - Deck name and author from html scraping, eg soup.title split with |
  - ​TRPC endpoint: https://curiosa.io/api/trpc/ 
  - ​filenames: deck.getDecklistById, deck.getAvatarById, deck.getSideboardById, deck.getMaybeboardById
  - ​query: {"json": {"id": deck_id}} for each filename
  - ​saved offline in browser guest.json or user.json with data: {name, author, mainboard, avatar, sideboard, maybeboard}
- Collection loaded from text file 
  - user upload with structure same as curiosa.io download: 1 item per line in the format "quantity name" e.g. "4 Cave Trolls"
  - saved in guest.json or user.json
- Collection loaded from curiosa.io login:
  - Requires user to login to generate session token, used in TRPC endpoint
  - TRPC endpoint: https://curiosa.io/api/trpc/collection.search
  - Sample input: {"0":{"json":{"query":"","sort":"latest","set":"*","filters":[],"limit":50,"cursor":0,"direction":"forward"}}}
  - Rate limit from response
  - saved offline in browser guest.json or user.json with data processed from returned json

---

## 5. Card Rendering & Grid System

### 5.1 Card Types & Sizes

| Card Type | Orientation | Grid Cells | Display Size | Source Image |
|---------|-------------|------------|--------------|--------------|
| Spell | Portrait | 2×3 cells | 110 × 165 px | 744 × 1039 px |
| Site | Landscape | 3×2 cells | 165 × 110 px | 1039 × 744 px |

---

### 5.2 Grid Rules

- Base grid unit: **55px** (visible as faint background grid)
- Cards occupy **6 grid cells**: 2×3 for portrait (110×165px), 3×2 for landscape (165×110px)
- Cards are drawn centered within their grid cell area
- Cards snap to nearest grid cell position on release
- Grid logic is mathematical (not DOM-based)

**Card Stacking:**
- Multiple cards at the same grid position are offset by **10 grid units (550px)**
- Spells offset downward (names visible on top)
- Sites offset upward (names visible on bottom)
- Stack reorders when a card is clicked (brings clicked card to front)
- Top cards in stack have higher z-index (clickable first)
- Offset reduces automatically when cards are removed from stack

**Layout Groups:**
- Main group by thresholds: air, earth, fire, water, multiple, none
- Sub-group by type: Minion, Magic, Aura, Artifact, Site
- Sorted by cost within each group
- **No gaps between cards within a group** (cards placed directly adjacent)
- Gap of **4 grid units** between element groups horizontally
- Gap of **1 grid unit** between card type subgroups vertically
- Each group of cards is 12 spell cards wide or 8 site cards wide
- Avatar cards are in their own group, laid out horizontally (12 per row)
- Avatars sorted by: set (Alpha, Beta, Arthurian Legends, Dragonlord, Gothic, Promotional), then precon first, then by rarity

---

### 5.3 Navigation

- Free pan across the grid
- Smooth zoom in/out
- Grid alignment preserved at all zoom levels

---

### 5.4 Image Performance Strategy

Each card supports multiple resolutions:
- Thumbnail (zoomed out)
- Medium resolution
- Full resolution (native size)

**LOD Switching**
- Zoom level determines which texture is rendered
- Hover always uses highest available resolution

Optimisations:
- Texture caching
- Mipmaps enabled
- Offscreen card culling

---

## 6. Card Interaction

### 6.1 Hover Preview

- Hovering a card displays a higher-resolution preview
- Preview rendered above the grid without blocking interaction

---

### 6.2 Selection & Dragging

**Selection:**
- Single click on unselected card: Selects it (clears other selections)
- Single click on selected card: Deselects it
- Shift+click: Toggles card in multi-selection (additive)
- Left-drag on empty space OR unselected card: Creates selection box
- Ctrl+drag: Creates selection box (alternative method)

**Dragging:**
- Left-drag on **already selected** card: Moves all selected cards
- Right-drag anywhere: Always pans viewport
- On release, cards snap to the nearest grid cell position
- Orientation is preserved (site cards rotated +90° clockwise)

---

## 7. Deck Management

### 7.1 Side Panel

- Collapsible side panel containing:
  - Deck list
  - Create / rename / delete deck controls
- Only one deck may be active and modified at a time
- active deck has boards: mainboard, sideboard, avatar, maybeboard
- Load Collection via text upload (later with curiosa login)
- Multiple decks can be loaded when a collection is present to ensure user can make all loaded decks from the cards in their collection. 

---

### 7.2 Deck Editing Gestures

| Interaction | Effect |
|-----------|--------|
| Double left-click | Add card to active deck |
| Double right-click | Remove card from active deck |

- Card counts in deck cannot go below zero

---

### 7.3 Deck Overlays

- When a deck is active:
  - Cards in the deck display a numeric overlay of the quantity
  - Overlay updates live as quantity change
- When a collection is present:
  - Quantity colour is white if more cards are in the collection, black if none remain and red if there are more cards in the deck than the collection.
  - If multiple decks are loaded their joined quantity influence numeric colour.
  - limits combine cards in mainboard and sideboard, maybeboard not included in limits 

---

## 8. Deck Rules & Validation

- Deck-building rules are tracked in real time (1 avatar, 60 spells, 30 sites, 10 sideboard of all types)
- deck card limits are tracked per card rarity (​Ordinary 4x, Exceptional 3x, Elite 2x, Unique 1x)
- Collection limits are tacked when present with loaded decks

**Feedback**
- Violations trigger:
  - Visual highlight on offending cards
  - Non-blocking notification explaining the issue

---

## 9. Filtering & Highlighting

- Filter cards by metadata (type, faction, cost, etc.)
- Filters may:
  - Hide non-matching cards (re-layout on grid)
  - Dim non-matching cards
- Filter matches can be outlined with configurable colors

---

## 10. MVP Scope (Minimum Viable Product)

### Included in MVP

- Web-based application
- Card grid with pan and zoom
- Grid snapping and orientation handling
- Hover high-resolution preview
- Single active deck, with active board selection
- Deck count overlays
- Double-click add/remove card gestures
- Basic duplicate limit validation
- Simple username/password login
- Persistent decks per user

---

### Explicitly Excluded from MVP

- Filtering (beyond laying out cards in groups)
- Load collection from text file
- Load deck from curiosa.io (no curiosa login)
- Mobile optimisation
- Animation polish beyond functional needs

---

## 11. Non-Functional Requirements

- Target 60fps on modern desktop hardware
- Must support large card libraries (+1000 cards)
- Clear separation between UI logic and rendering
- Architecture must support future expansion

---

## 12. Success Criteria

- Users can build a legal deck without external references
- Zooming and panning remain smooth under load
- Deck state is always visually clear
- Card browsing feels spatial and intuitive

---

## 13. Out of Scope (Long-Term)

- Trading or marketplace features
- Match simulation
- Real-time collaboration
- Offline-first support

---