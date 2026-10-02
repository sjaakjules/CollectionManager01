import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import engineCards from './__fixtures__/sorcery-engine-cards.json';
import { normalizeCardCatalog } from './cardCatalog';
import { buildCardFilterOptions } from './cardService';
import { applyCardFilters, createEmptyCardFilterCriteria } from './cardFilters';
import { cardNameToOrientationMap } from '@/canvas/canvasAreas';
import { calculateCardLayout } from '@/rendering/Grid';
import { getThresholdGroup } from './dataModels';

describe('card catalog boundary', () => {
  it('adapts the live engine/printings format into complete renderer metadata', () => {
    const { cards, issues } = normalizeCardCatalog(engineCards);
    expect(issues).toEqual([]);
    expect(cards.find((card) => card.name === 'Abaddon Succubus')).toMatchObject({
      guardian: { type: 'Minion', rarity: 'Elite', cost: 4, attack: 3, defence: 3, thresholds: { water: 2 } },
      elements: 'Water', subTypes: 'Demon', umbrellas: ['Evil'],
      sets: [{ name: 'Gothic', variants: [
        { artist: 'Elvira Shakirova', finish: 'Standard' },
        { artist: 'Elvira Shakirova', finish: 'Foil' },
      ] }],
    });
    const wizard = cards.find((card) => card.name === 'Apprentice Wizard');
    expect(wizard?.sets.map((set) => set.name)).toEqual(['Alpha', 'Beta', 'Promo']);
    expect(wizard?.guardian.rulesText).toContain('Draw a spell');
    expect(cardNameToOrientationMap(cards).get('Accursed Desert')?.isLandscape).toBe(true);
    const options = buildCardFilterOptions(cards);
    expect(options.subTypes).toContain('Evil');
    expect(options.artists).toContain('Elvira Shakirova');
    for (const [criteria, expectedName] of [
      [{ searchText: 'Ward' }, 'Accursed Desert'],
      [{ subType: 'Evil' }, 'Abaddon Succubus'],
    ] as const) {
      const matches = applyCardFilters(cards, { draft: createEmptyCardFilterCriteria(), clauses: [{
        enabled: true, criteria: { ...createEmptyCardFilterCriteria(), ...criteria },
      }] });
      expect(matches.map((card) => card.name)).toContain(expectedName);
    }
  });

  it('keeps the entire bundled legacy catalog compatible and normalization idempotent', () => {
    const payload: unknown = JSON.parse(readFileSync('public/assets/sorcery_cards.json', 'utf8'));
    if (!Array.isArray(payload)) throw new Error('Bundled snapshot must be an array');
    const normalized = normalizeCardCatalog(payload);
    expect(normalized.cards).toHaveLength(payload.length);
    expect(normalized.issues).toEqual([]);
    expect(normalizeCardCatalog(normalized.cards)).toEqual(normalized);
    expect(normalizeCardCatalog(normalizeCardCatalog(engineCards).cards).cards)
      .toEqual(normalizeCardCatalog(engineCards).cards);
  });

  it('retains unfamiliar types, traits, finishes and partial preview metadata without inventing stats', () => {
    const { cards } = normalizeCardCatalog([{
      name: 'Preview Trap', engine: {
        type: 'Trap', cost: '3', defense: '2', air: '1', water: -2,
        rules: 'Ward', subtypes: ['Snare'], keywords: ['Ward'], umbrellas: ['Evil'],
        back: { type: 'Minion', attack: 2 },
      },
      printings: [null, { set: { name: 'Upcoming' }, meta: { finish: 'Rainbow' } }],
    }, { name: 'Future Form', guardian: { type: 'Unannounced Form', rarity: 'Future Rarity' } }]);
    expect(cards[0]).toMatchObject({
      guardian: { type: 'Trap', rarity: null, cost: 3, attack: null, defence: 2, thresholds: { air: 1, water: 0 } },
      sets: [{ variants: [{ finish: 'Rainbow', artist: '' }] }],
      back: { type: 'Minion', attack: 2 },
    });
    expect(buildCardFilterOptions(cards).types).toEqual(['Trap', 'Unannounced Form']);
    const input = cards.map((card) => ({
      name: card.name, type: card.guardian.type, cost: card.guardian.cost,
      isLandscape: false, thresholdGroup: getThresholdGroup(card.guardian.thresholds),
    }));
    expect(calculateCardLayout({ cards: input }).cards.map((card) => card.name).sort())
      .toEqual(cards.map((card) => card.name).sort());
  });

  it('recovers missing guardian stats from the most recent usable set and reports it', () => {
    const { cards, issues } = normalizeCardCatalog([{
      name: 'Preview', sets: [
        { name: 'Early', releasedAt: '2020-01-01', metadata: { type: 'Magic', cost: 1 } },
        { name: 'Later', releasedAt: '2026-01-01', metadata: { type: 'Trap', cost: 2 } },
      ],
    }]);
    expect(cards[0]?.guardian).toMatchObject({ type: 'Trap', cost: 2 });
    expect(issues).toEqual([expect.objectContaining({ cardName: 'Preview', skipped: false })]);
  });

  it('quarantines malformed and duplicate records without losing valid cards', () => {
    const { cards, issues } = normalizeCardCatalog([
      ...engineCards, null, { name: 'Not previewed yet' }, { name: ' ' }, engineCards[0],
    ]);
    expect(cards).toHaveLength(engineCards.length);
    expect(issues).toHaveLength(4);
    expect(issues.every((issue) => issue.skipped)).toBe(true);
    expect(issues.map((issue) => issue.cardName)).toContain('Not previewed yet');
  });

  it('sanitizes malformed optional nested data', () => {
    const { cards } = normalizeCardCatalog([{
      name: 'Partial', guardian: { type: 'Trap', thresholds: null, cost: Infinity, attack: {} },
      elements: {}, subTypes: [null, 'Snare'],
      sets: [null, { name: 'Preview', variants: [null, { artist: null, finish: 8 }] }],
    }]);
    expect(cards[0]?.guardian).toMatchObject({
      cost: null, attack: null, rulesText: '', thresholds: { air: 0, earth: 0, fire: 0, water: 0 },
    });
    expect(() => buildCardFilterOptions(cards)).not.toThrow();
  });

  it.each([null, {}, [], [null], [{ name: 'Broken' }]])('rejects unusable catalogs for fallback: %j', (value) => {
    expect(() => normalizeCardCatalog(value)).toThrow(/catalog/);
  });
});
