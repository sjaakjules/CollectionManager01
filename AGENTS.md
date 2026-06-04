# Project: Sorcery Collection Manager

## Quick Context
- Platform: Web (desktop-first)
- Language: TypeScript
- Framework: React
- Rendering: PixiJS (WebGL)
- State: Local-first, optional backend sync
- Package Manager: pnpm (preferred)

This project is a visual deck-building tool for the Sorcery TCG.  
It prioritizes spatial interaction, performance, and privacy-friendly design.

---

## Core Architecture

- **React** manages UI, panels, state, and session flow
- **PixiJS** renders all cards, grid, pan/zoom, and interactions
- React must NEVER directly manipulate PixiJS objects
- Rendering logic and UI logic are strictly separated

---

## Data Model (Critical)

There is a single shared JSON schema used everywhere:

- `guest.json` (local browser storage)
- `username.json` (fetched when logged in)

Both must remain identical in structure.

```ts
UserData {
  name: string
  id: string
  decks: Deck[]
  collection: CollectionItem[]
}
```

Do not introduce divergent schemas.

---

## Storage & Auth Model

Guest Mode (default)
- No login
- Data stored in browser (IndexedDB / LocalStorage)
- Create guest.json on first load

Login Mode (optional)
- Username + password
- Backend returns JWT
- Frontend fetches username.json
- Backend stores JSON blobs only (no images, no metadata)

The app must remain fully usable without login.

---

## Rendering Rules

- All cards are PixiJS sprites
- Base grid unit: 400px
- Cards snap to grid mathematically
- Card orientations:
  - Spell: portrait (744×1039)
  - Site: landscape (1039×744)
- Zoom level controls image LOD
- Hover always shows highest resolution

---

## Interaction Conventions

- Single click: select card
- Click + drag: move card (snap on release)
- Double left-click: add card to active deck
- Double right-click: remove card from active deck
- Deck count overlays update live

---

## Import / Export

- Export decks as .txt
- Format: quantity name
- One card per line
- Compatible with curiosa.io
- Import via pasted text
- Parse line-by-line
- Unknown cards must be highlighted, not silently dropped

---

## Conventions

- Use functional React components with hooks
- Prefer named exports
- One responsibility per file
- Keep backend “dumb” and frontend “smart”
- Treat JSON schema as a contract

---

## Performance Guidelines

- Avoid unnecessary React re-renders
- PixiJS should handle all high-frequency updates
- Use debounced saves for storage writes
- Cull offscreen cards

---

## Common Commands

- pnpm dev – Start development server
- pnpm build – Production build
- pnpm lint – Run linter
- pnpm test – Run tests (if present)

---

## Don’ts

- Do NOT block features behind login
- Do NOT store passwords in frontend
- Do NOT manipulate PixiJS from React components
- Do NOT duplicate card metadata in multiple places
- Do NOT use any in TypeScript
- Do NOT commit .env files

---

## Guiding Principle

The application must remain fully functional in guest mode and without login.
Login only enhances persistence, never capability.

