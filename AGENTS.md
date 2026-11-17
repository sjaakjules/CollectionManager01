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

- Mouse/trackpad click: select the stack; a later click selects an individual card
- Double-click inside a deck/stack area: select the whole stack
- Left-drag on a card: move its selection, preserving stack/group offsets on snap
- Left-drag on empty canvas: selection rectangle; Shift adds to the selection
- Pan: middle/right-drag or Space + left-drag (no middle button required)
- Mouse wheel and vertical trackpad scroll: zoom at the cursor, including small
  and fractional deltas. Pure horizontal scroll pans sideways; pinch zooms.
  Never infer vertical panning from wheel-delta size: browsers cannot reliably
  identify physical mouse vs trackpad hardware. Retain Space-drag and touch pan.
- Touch: a readable card/stack centre drags immediately; edges and empty canvas
  pan. Overview thumbnails pan until zoomed in. Hold for actions, pinch to zoom.
- Double-click in the catalogue: add to active deck; double-right-click removes
- Alt + double-click in a deck: toggle card inclusion in the current variant
- Record `Deck.origin` for + imports (`user`), lookup saves (`lookup`) and seeds
  (`seed`) in the same guest/account schema. Do not duplicate card metadata.
- Deck count overlays update live
- Deck sections are Main, Collection (`collection`), then Maybe (`maybeboard`).
  Legacy `sideboard` names are accepted only at import/storage boundaries.
  Keep Maybe separate in layout, sorting, hit testing and variants.
  Collection uses ten portrait columns; use the shared deck-board geometry in
  `src/canvas/deckBoardLayout.ts` and preserve existing main-deck arrangements.
- Base region titles move with a temporary insertion preview; edges resize only
  to their padded content minimum. Moves use grid translations. Custom labels
  float freely and expand parent regions. Cancelled previews must never save.
  Phone/desktop layouts share the first edited arrangement until the other type
  edits, then keep separate position snapshots in the shared guest/account schema.
  Never duplicate card metadata, memberships or variants in those snapshots.
- Use `getDeckLibraryEntries` for both the side Decks panel and Deck Lookup's
  Added tab. Include all saved origins; never apply separate list filters.
  Reset layout requires confirmation on mouse, keyboard and touch paths, and
  retains IDs, boards and variants. Removal clears matching canvas areas and
  records `UserData.removedDecks` in the shared guest/account schema so seed
  hydration and login merges cannot restore an older deleted deck.
- Added-deck metrics and style estimates use current canvas/variant contents.
  Keep analysis local and memoized; no live requests or work on animation frames.

---

## Import / Export

- Export decks as .txt
- Format: quantity name
- One card per line
- Compatible with SorceryTCG deck text
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
- Preserve the established LOD thresholds, canvas resolution and device budgets
  when changing controls; see [the LOD guide](docs/lod-atlas-optimization.md).
  Test actual wheel events through to zoom/detail loading, including smooth
  wheels. Keep cached images visible while sharper detail loads; late downloads
  must not replace sharper textures. Include deck avatars and nearby deck cards
  in on-demand loading without loading detail for distant decks.

---

## SorceryTCG Requests (Mandatory)

Be kind to SorceryTCG's servers. This applies to the app, proxies, scripts,
agents, manual debugging, card metadata, decks, search pages, retries and any
future artwork downloads, including direct SorceryTCG links.

- Read [the request policy](docs/sorcery-request-policy.md) before making live calls.
- Allow only **one upstream request at a time**, with **at least 3 seconds after
  the previous request finishes**, including its body or failure. No bursts.
- Use `src/data/sorceryRequest.ts` in the app and the shared
  `nodeSorceryClient` in `scripts/lib/sorcery-client.ts` for maintenance/dev work.
  Do not create independent live clients or faster timing overrides.
- For manual inspection/downloads, use `pnpm sorcery:request <https-url> <file>`.
  Do not use raw `curl`, direct `fetch`, browser automation loops, parallel
  agents/processes, or alternate hosts/proxies to bypass the limiter.
- Respect **both** `Retry-After` (seconds or date) and `x-ratelimit-*`; use the
  longest required wait. With 2 or fewer requests remaining, wait for reset or
  enough 3-second intervals to replenish to 5. Never lower these safeguards.
- Retry at most once, only for HTTP 429/503 with a valid `Retry-After`. Without
  that header, stop that request and pause the shared budget for at least 60s.
  Proxies must not add retries. Do not follow redirects outside the limiter.
- Reuse cached/saved responses, request all deck boards together, deduplicate
  IDs, and skip unchanged decklists. Do not rerun a crawl just to verify a fix.
- Verify timing, failures and cancellation with mocked/offline tests. Live
  checks should be minimal and sequential, with other upstream jobs stopped.
- Both PHP routes share one throttle across visitors. Dev tools/CLI commands
  share a host lock and persisted budget; do not delete limiter state or steal
  a live lock. Separate machines/servers do not share a global allowance.
- Any future visitor-triggered catalogue refresh must use this throttle, a
  shared daily cache and a single refresh lock; an upstream outage must retain
  the last good catalogue. Do not launch a refresh for every visitor.

---

## Common Commands

- pnpm dev – Start development server
- pnpm build – Production build
- pnpm lint – Run linter
- pnpm test – Run tests (if present)

Verify site changes locally, then build and deploy the verified release to
`https://staging.sorcerystacks.com` for the user's validation. Use the staging
deployment commands documented in [the script guide](docs/scripts.md).
Staging is a combined release of this shared checkout, including its uncommitted
features. Never deploy an isolated committed worktree over it while omitting
shared changes. The build/deploy source guard must pass; do not bypass it.
Preserve newer card images and preview-gallery changes alongside canvas changes.

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
