# ToDos

Tracks changes that are still unimplemented or only partially implemented.

## Critical Correctness

- [x] Ensure backend/dev auth handlers accept the final stack/deck workspace payload shape used by the client (`netlify/functions/user-auth.ts`, `vite.config.ts`).
- [ ] Fix `Camera` listener teardown bug caused by `bind` mismatch (`src/rendering/Camera.ts:92` and `src/rendering/Camera.ts:205`).
- [ ] Clear current lint blockers: remove forbidden non-null assertions (`src/data/dataModels.ts:293`, `src/data/importExport.ts:168`, `src/data/importExport.ts:177`, `src/data/importExport.ts:178`, `src/data/importExport.ts:194`, `src/data/importExport.ts:268`) and switch `avatarCount` to `const` (`src/rules/deckRules.ts:59`).
- [x] After stack/deck canvas migration lands, rerun lint and resolve remaining `react-hooks/exhaustive-deps` warnings in the refactored `App` flow.

## Stack/Deck Canvas Migration

This section tracks cleanup for the stack/deck canvas model.

### 1. Scope and Data Model

- [x] Lock product direction: remove generic standalone areas; keep stacks and decks as the product concepts.
- [x] Define target model for persisted workspace data as `canvasAreas`; in-house testing can use destructive reset (no backward compatibility required).
- [x] Remove legacy persisted workspace data paths instead of adding a migration.
- [x] Keep backend/dev persistence aligned with the migrated model (`netlify/functions/user-auth.ts`, `vite.config.ts` auth dev API).

### 2. UI Surface Changes

- [x] Keep left Stacks sidebar UX as-is (`src/ui/StacksPanel.tsx`) for create/open/filter/remove flows.
- [x] Remove standalone area management UI from user-facing flows (related tabs/actions in `src/ui/BottomPanel.tsx`).
- [x] Keep Decks management as its own flow (load/focus/delete deck workspaces) but separate from removed generic area actions.

### 3. Canvas Placement Rules (Requested Behavior)

- [x] Change new stack workspace spawn behavior: create in the middle of the current screen/camera view instead of a dedicated quadrant area.
- [x] Keep stack canvas interaction behavior unchanged after spawn change (drag/drop, stack panel linking, header click behavior).
- [x] Move deck workspace placement to the area left of the main card layout (replace current deck quadrant placement logic).
- [ ] Ensure deck placement remains stable after collection re-layout/filtering and does not overlap core collection viewport.

### 4. Rendering + State Refactor

- [x] Refactor quadrant-driven placement utilities in `src/canvas/canvasAreas.ts` to support center-spawn stacks and left-of-collection deck placement.
- [x] Remove named/generic area creation paths from `App` + reducer wiring once migration is complete (`src/app/App.tsx`, `src/app/AppState.ts`).
- [ ] Update `PixiStage` stack/deck interaction assumptions that rely on old quadrant/category behavior.
- [ ] Reconcile remaining private renderer terminology so stack/deck intent is clear after migration.

### 5. Cleanup and Verification

- [x] Delete or archive superseded components/code paths after migration (obsolete hub wiring and helpers).
- [ ] Add regression checks for: creating stack in screen center, deck placement left of collection, persisted layout reload, and drag/drop behavior parity.
- [ ] Update docs to reflect the new workspace model and controls.

## Feature Wiring Gaps

- [ ] Wire deck text import/export controls into the UI (`src/data/importExport.ts` helpers are currently unused).
- [ ] Add a "Save Selected" flow to export only currently selected cards.
- [ ] Wire deck validation into active editing UI (rules modules currently not consumed: `src/rules/deckRules.ts`, `src/rules/ruleMessages.ts`).
- [ ] Show rules text for the currently selected card in a dedicated panel.
- [ ] Add codex keyword links inside displayed rules text.
- [ ] Add a codex search/results panel driven by selected keywords.
- [ ] Validate `src/auth/api.ts` endpoints against deployed backend behavior and tighten error handling where needed.
- [ ] Decide whether to keep or remove `netlify/functions/archetype-scores.ts` now that archetype edits persist through user data sync.

## Unused or Stale Code

- [x] Removed `src/ui/SidePanel.tsx` and all dead wiring from `src/app/App.tsx`/`src/app/AppState.ts`.
- [x] Removed placeholder `src/ui/FiltersPanel.tsx` and extracted BottomPanel filtering into reusable UI/modules (`src/ui/CardFilterDrawer.tsx`, `src/ui/cardFilterUi.ts`).
- [x] Removed `src/ui/Overlays.tsx` (unreferenced overlay helper module).
- [x] Removed dead `sidePanelOpen` reducer state/action paths (`src/app/AppState.ts`).
- [x] Removed unused re-export in `src/ui/BottomPanel.tsx` (`loadArchetypeScores`).
- [x] Removed unused card service helpers and replaced with shared filter-option builder (`src/data/cardService.ts`).

## Performance

- [ ] Replace per-card `JSON.stringify(card)` search matching with a precomputed searchable index (`src/data/cardFilters.ts:312`).
- [ ] Address large production bundle warning (main chunk ~655 kB minified) with code-splitting/manual chunks and lazy-loaded heavy paths.
- [ ] Reduce repeated card metadata scans in hot rendering paths by caching name->card lookups (e.g., `PixiStage` helper lookups).

## Type Safety and Tests

- [ ] Expand TypeScript coverage to include backend functions and scripts (current `tsconfig.json` include only covers `src` and `vite.config.ts`).
- [ ] Add filter-focused tests for clause normalization and matching behavior in `src/data/cardFilters.ts`.
- [ ] Add parsing tests for deck import edge cases in `src/data/importExport.ts`.

## Security Hardening

- [ ] Replace direct SHA-256 password hashing with a slow password KDF (scrypt/argon2/PBKDF2) in `netlify/functions/user-auth.ts` and the mirrored dev auth flow in `vite.config.ts`.

## Documentation

- [ ] Align README feature claims with actual wiring (deck validation and text import/export are not fully connected in UI).
- [ ] Continue the module-header and function input/output documentation style across remaining large files (`src/rendering/PixiStage.ts`, `src/ui/BottomPanel.tsx`, and related modules).

Last updated: 2026-02-26
