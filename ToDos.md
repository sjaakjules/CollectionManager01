# ToDos

Tracks changes that are still unimplemented or only partially implemented.

## UI Wiring Gaps

- [ ] Wire deck text import/export controls into the UI (`src/data/importExport.ts` helpers are currently unused).
- [ ] Add a "Save Selected" flow to export only currently selected cards.
- [ ] Decide whether to integrate or remove `src/ui/SidePanel.tsx` (currently not mounted in `src/app/App.tsx`).

## Filtering

- [ ] Replace the placeholder `src/ui/FiltersPanel.tsx` with production filtering UI, or remove it if `BottomPanel` remains the canonical filter surface.
- [ ] Add filter-focused tests for clause normalization and matching behavior in `src/data/cardFilters.ts`.

## Card Detail + Codex

- [ ] Show rules text for the currently selected card in a dedicated panel.
- [ ] Add codex keyword links inside displayed rules text.
- [ ] Add a codex search/results panel driven by selected keywords.

## Backend Integration Follow-up

- [ ] Validate `src/auth/api.ts` endpoints against the deployed backend contract and tighten client error handling where needed.

## Documentation Follow-up

- [ ] Continue the new module-header and function input/output documentation style across remaining `src/rendering/*` and `src/ui/*` modules.

Last updated: 2026-02-24
