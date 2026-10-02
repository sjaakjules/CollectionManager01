import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sanitizeDevUserData } from './lib/dev-user-data.ts';

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
