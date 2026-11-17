import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sanitizeDevUserData } from './lib/dev-user-data.ts';
import { CANVAS_GRID_VERSION } from '../src/data/canvasGridVersion.ts';
import { DRAWN_GRID } from '../src/rendering/Grid.ts';
import { guestWorkspaceFixture } from '../src/data/__fixtures__/guestWorkspace.ts';

const phpAvailable = spawnSync('php', ['--version']).status === 0;
const source = fileURLToPath(new URL('../server/php/api/shared/user-data.php', import.meta.url));
function sanitize(payload) {
  const result = spawnSync('php', ['-r', `require ${JSON.stringify(source)};
    $payload = json_decode(stream_get_contents(STDIN), true);
    echo json_encode(sorcery_sanitize_user_data($payload, 'account-id', 'Account'));`],
  { encoding: 'utf8', input: JSON.stringify(payload) });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

describe.skipIf(!phpAvailable)('account JSON contract', () => {
  it('transfers a complete guest workspace through the same PHP and development account schema', () => {
    const guest = guestWorkspaceFixture();
    const expected = { ...guest, id: 'account-id', name: 'Account' };
    expect(sanitize(guest)).toEqual(expected);
    expect(sanitizeDevUserData(guest, 'account-id', 'Account')).toEqual(expected);
    expect(sanitize(sanitize(guest))).toEqual(expected);
    expect(guest.name).toBe('Guest');
  });
  const savedGrids = [[2, 75], [3, 65], [CANVAS_GRID_VERSION, DRAWN_GRID.width]];
  it.each(savedGrids)('round-trips grid version %s and coordinates through both account stores', (gridVersion, cell) => {
    const payload = { gridVersion,
      canvasAreas: [{ id: 'deck', name: 'Deck', type: 'deck', bounds: { x: -2 * cell, y: 0, width: 10 * cell, height: 12 * cell },
        cards: [{ id: 'site', cardName: 'Site', x: 3.5 * cell - 70, y: 3 * cell - 50, board: 'mainboard' }],
      }],
      canvasLabels: [{ id: 'label', text: 'Atlas', x: -cell, y: 2 * cell, areaId: 'deck', board: 'mainboard' }],
    };
    const php = sanitize(payload);
    expect(php).toMatchObject(payload);
    expect(sanitize(php)).toEqual(php);
    expect(JSON.parse(JSON.stringify(sanitizeDevUserData(payload, 'account-id', 'Account')))).toEqual(php);
  });
  it.each([undefined, null, '2', 0, -2, 2.5])('leaves invalid or legacy grid markers absent (%s)', gridVersion => {
    const payload = { gridVersion };
    expect(sanitize(payload)).not.toHaveProperty('gridVersion');
    expect(sanitizeDevUserData(payload, 'account-id', 'Account')).not.toHaveProperty('gridVersion');
  });

  it('preserves named section tabs and label ownership in both account stores', () => {
    const site = { id: 'site', cardName: 'Site', x: 12.5, y: 220, board: 'mainboard', labelId: 'l' };
    const layout = { id: 'openers', name: 'Openers', cardLabels: { site: 'l' },
      positions: { source: 'desktop', desktop: { cards: { site: { x: 12.5, y: 220 } }, labels: { l: { x: 15, y: 180 } } } } };
    const payload = {
      canvasAreas: [{ id: 'd', name: 'Deck', type: 'deck', cards: [site],
        sectionLayouts: { atlas: { activeId: 'openers', tabs: [layout] } } }],
      canvasLabels: [{ id: 'l', text: 'Opening sites', x: 15, y: 180, areaId: 'd', board: 'mainboard',
        deckSectionLayout: { section: 'atlas', id: 'openers' } }],
    };
    const php = sanitize(payload);
    expect(php).toMatchObject(payload);
    expect(JSON.parse(JSON.stringify(sanitizeDevUserData(payload, 'account-id', 'Account')))).toEqual(php);
  });
  it('keeps shared and separate phone/desktop position layouts in the same PHP and dev contract', () => {
    const frame = {x: -400, y: -600, width: 800, height: 900};
    const layout = {bounds: frame, regions: {collection: frame}, cards: {a: {x: 10, y: 20}}, labels: {l: {x: 5, y: 6}}};
    const payload = {canvasAreas: [{id: 'd', name: 'Deck', type: 'deck', cards: [], deckRegionBounds: {collection: frame},
      layoutProfiles: {source: 'desktop', desktop: layout, phone: {...layout, bounds: {...frame, width: 600}}}}]};
    const php = sanitize(payload);
    expect(php.canvasAreas).toEqual(payload.canvasAreas);
    expect(sanitizeDevUserData(payload, 'account-id', 'Account').canvasAreas).toEqual(php.canvasAreas);
  });
  it('round-trips deletion markers alongside decks and canvas areas', () => {
    const payload = {
      decks: [{ id: 'kept', boards: {} }],
      removedDecks: { removed: '2026-09-30T10:00:00.000Z' },
      canvasAreas: [{ id: 'area', name: 'Kept', type: 'deck', deckId: 'kept', cards: [] }],
    };
    const saved = sanitize(payload);
    if (payload.interactionEffects) expect(saved.interactionEffects).toEqual(payload.interactionEffects);
    expect(saved).toMatchObject(payload);
    expect(sanitize(saved)).toEqual(saved);
  });
  it('keeps older account data compatible and rejects malformed deletion markers', () => {
    expect(sanitize({}).removedDecks).toEqual({});
    expect(sanitize({ removedDecks: { good: '2026-09-30T10:00:00.000Z', bad: 'invalid', blank: null } }).removedDecks)
      .toEqual({ good: '2026-09-30T10:00:00.000Z' });
  });
  it('preserves numeric string deck IDs in deletion markers like guest and development saves', () => {
    const payload = { removedDecks: { '12345': '2026-09-30T10:00:00.000Z' } };
    const saved = sanitize(payload);
    expect(saved.removedDecks).toEqual(payload.removedDecks);
    expect(saved.removedDecks).toEqual(sanitizeDevUserData(payload, 'account-id', 'Account').removedDecks);
  });
  it('preserves label ownership and catalogue controls while upgrading legacy Collection names', () => {
    const payload = {
      decks: [{ id: 'deck', boards: { mainboard: [], avatar: [], maybeboard: [], sideboard: [{ name: 'Site', quantity: 1 }] } }],
      canvasAreas: [{ id: 'area', name: 'Deck', type: 'deck', cards: [
        { id: 'card', cardName: 'Site', x: 5, y: 10, board: 'sideboard', labelId: 'label', isNew: true },
      ] }],
      canvasLabels: [{ id: 'label', text: 'Utility', x: 0, y: 0, areaId: 'area', board: 'sideboard', parentLabelId: 'parent' }],
      interactionEffects: { intensity: 'subtle', lettering: 'english' },
      catalogueLayout: { steps: [{ key: 'element', mode: 'group' }] },
    };
    const saved = sanitize(payload);
    if (payload.interactionEffects) expect(saved.interactionEffects).toEqual(payload.interactionEffects);
    expect(saved.decks[0].boards.collection).toEqual([{ name: 'Site', quantity: 1 }]);
    expect(saved.decks[0].boards).not.toHaveProperty('sideboard');
    expect(saved.canvasAreas[0].cards[0]).toMatchObject({ board: 'collection', labelId: 'label', isNew: true });
    expect(saved.canvasLabels[0]).toMatchObject({ areaId: 'area', board: 'collection', parentLabelId: 'parent' });
    expect(saved.catalogueLayout).toEqual({ steps: [{ key: 'element', mode: 'group' }] });
    expect(sanitize(saved)).toEqual(saved);
    expect(JSON.parse(JSON.stringify(sanitizeDevUserData(payload, 'account-id', 'Account')))).toEqual(saved);
  });
});
