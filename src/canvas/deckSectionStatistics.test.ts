import { describe, expect, it } from 'vitest';
import catalogue from '../../public/assets/sorcery_cards.json';
import { normalizeCardCatalog } from '@/data/cardCatalog';
import { required } from '@/utils/required';
import type { CanvasArea, CanvasCardInstance } from './canvasAreas';
import { DeckSectionStatisticsCache, formatDeckManaCell, type DeckSectionSummary } from './deckSectionStatistics';

const metadata = normalizeCardCatalog(catalogue).cards;

function copy(cardName: string, board?: CanvasCardInstance['board'], id = cardName): CanvasCardInstance {
  return { id, cardName, board, x: 0, y: 0 };
}

function deck(...cards: (string | CanvasCardInstance)[]): CanvasArea {
  return {
    id: 'deck', name: 'Deck', type: 'deck', pinned: true, bounds: { x: 0, y: 0, width: 800, height: 800 },
    cards: cards.map((card, index) => typeof card === 'string' ? copy(card, undefined, `copy-${index}`) : card),
  };
}

function column(summary: DeckSectionSummary, id: string) {
  return required(summary.columns.find(column => column.id === id)).rows;
}

function texts(summary: DeckSectionSummary, id: string): string[] {
  return column(summary, id).map(row => row.text);
}

describe('deck section statistics', () => {
  it('compares spell demand and site output across multiple elements, counting a dual-element spell once in the cost denominator', () => {
    const area = deck('Common Sense', 'Common Sense', 'Arcane Barrage', 'Draco Corvus', 'Adtonitum',
      'Mountain Peaks', 'Aqueduct', 'Valley of Delight', 'Animist', copy('Unknown Avatar', 'avatar'),
      copy('Mountain Peaks', 'collection'), copy('Common Sense', 'maybeboard'));
    const { main, spellbook, atlas, unknownCount } = new DeckSectionStatisticsCache().get(area, metadata);

    expect([main.count, spellbook.count, atlas.count, unknownCount]).toEqual([8, 5, 3, 0]);
    expect(main.columns.map(column => column.id)).toEqual(['counts', 'earth', 'air']);
    expect(texts(main, 'counts')).toEqual(['5 Spells', '3 Sites', '1 Collection', 'Invalid deck']);
    expect(column(main, 'counts').slice(0, 3).every(row => row.bold)).toBe(true);
    expect(column(main, 'counts').map(row => row.warning)).toEqual([true, true, false, true]);
    expect(texts(main, 'earth')).toEqual(['Earth', '60% Spells / 60% Cost', '33% Sites / 20% Output']);
    expect(texts(main, 'air')).toEqual(['Air', '60% Spells / 60% Cost', '33% Sites / 40% Output']);
    expect(column(main, 'air')[1]?.tooltip).toContain('Cost excludes colourless spells');
    expect(column(main, 'air')[2]?.tooltip).toContain('Output counts each symbol; blank sites count as one');
    expect(texts(atlas, 'sites')).toEqual(['3 Sites', '1 E / 1 A / 1 W / 0 F', '0 o / 2 e / 1 e / 0 u']);
    expect(column(atlas, 'sites')[1]?.elementCounts).toEqual([
      { element: 'earth', count: 1 }, { element: 'air', count: 1 }, { element: 'water', count: 1 }, { element: 'fire', count: 0 },
    ]);
    expect(texts(atlas, 'sources')).toEqual(['Sources', '1 No threshold', '1 Multi-element']);
  });

  it('excludes colourless spells from the cost share and gives a blank site one unit of output weight', () => {
    const { main } = new DeckSectionStatisticsCache().get(deck(
      'Arcane Barrage', 'Arcane Barrage', 'Adtonitum', 'Adtonitum', 'Common Sense', 'Common Sense',
      'Cold Iron Rod', 'Cold Iron Rod', 'Mountain Peaks', 'Updraft Ridge', 'Varmint Warrens', 'Valley of Delight',
    ), metadata);
    expect(texts(main, 'air')).toEqual(['Air', '50% Spells / 67% Cost', '50% Sites / 60% Output']);
    expect(texts(main, 'earth')).toEqual(['Earth', '25% Spells / 33% Cost', '25% Sites / 20% Output']);
  });

  it('marks missing printed sources even when a site can generate the threshold through rules text', () => {
    const { main } = new DeckSectionStatisticsCache().get(deck('Common Sense', 'Valley of Delight'), metadata);
    expect(column(main, 'earth')[2]).toMatchObject({
      text: '0% Sites / 0% Output', warning: true, tooltip: 'No Earth sites',
    });
  });

  it('reports active deck size and shows only unmet size requirements', () => {
    const spells = Array.from({ length: 61 }, () => 'Zap!');
    const sites = Array.from({ length: 31 }, () => 'Mountain Peaks');
    const collection = Array.from({ length: 11 }, (_, index) => copy('Common Sense', 'collection', `collection-${index}`));
    const cache = new DeckSectionStatisticsCache();
    const area = deck(...spells, ...sites, ...collection.slice(0, 10), copy('Unknown', 'maybeboard'));

    expect(texts(cache.get(area, metadata).main, 'counts')).toEqual(['61 Spells', '31 Sites', '10 Collection']);
    area.cards.push(required(collection[10]));
    const counts = column(cache.get(area, metadata).main, 'counts');
    expect(counts.map(row => row.warning)).toEqual([false, false, true, true]);
    expect(counts[3]).toEqual({
      text: 'Invalid deck', warning: true, tooltip: 'At most 10 Collection cards',
    });
  });

  it('shows typed element, rarity, and fixed mana buckets with their orders on hover', () => {
    const { spellbook } = new DeckSectionStatisticsCache().get(
      deck('Common Sense', 'Arcane Barrage', 'Kiss of Death', 'Fireball', 'Draco Corvus', 'Helpful Hob',
        'Cold Iron Rod', 'Evil Presence'), metadata,
    );
    expect(spellbook.columns.slice(0, 4).map(column => column.rows[0]?.text)).toEqual([
      '2 Minions', '4 Magic', '1 Artefact', '1 Aura',
    ]);
    expect(spellbook.columns.slice(0, 4).map(column => column.group)).toEqual(Array(4).fill('composition'));
    expect(texts(spellbook, 'minions')).toEqual(['2 Minions', '1 E / 1 A / 1 W / 0 F', '1 o / 0 e / 0 e / 1 u', '0 / 0 / 0 / 1 / 0 / 1']);
    expect(column(spellbook, 'minions')[1]?.elementCounts).toEqual([
      { element: 'earth', count: 1 }, { element: 'air', count: 1 }, { element: 'water', count: 1 }, { element: 'fire', count: 0 },
    ]);
    expect(column(spellbook, 'minions')[1]?.tooltip).toBe('1 Earth / 1 Air / 1 Water / 0 Fire');
    expect(column(spellbook, 'minions')[2]?.tooltip).toBe('1 Ordinary / 0 Exceptional / 0 Elite / 1 Unique');
    expect(column(spellbook, 'magic')[3]?.tooltip).toBe('Cards that cost 1 / 2 / 3 / 4 / 5 / +6 mana');
  });

  it('adapts the mana histogram to the measured column width while retaining free and variable cards', () => {
    const { spellbook } = new DeckSectionStatisticsCache().get(deck(
      'Dodge Roll', 'Valor', 'Bind Evil', 'Common Sense', 'Kiss of Death', 'Fireball',
      'Ball Lightning', 'Ball Lightning', 'Call of the Sea', 'Craterize', 'Arcane Barrage',
    ), metadata);
    const mana = required(column(spellbook, 'spells')[3]);
    expect(mana.text).toBe('2 / 1 / 1 / 1 / 1 / 2 / 2');
    expect(mana.manaCounts).toEqual({ zero: 2, one: 1, two: 1, three: 1, four: 1, five: 2, sixPlus: 2, variable: 1 });
    expect(mana.tooltip).toBe('Cards that cost 0 / 1 / 2 / 3 / 4 / 5 / +6 mana');

    const measure = (text: string) => text.length;
    expect(formatDeckManaCell(mana, 25, measure)).toBe(mana);
    const compact = formatDeckManaCell(mana, 21, measure);
    expect(compact.text).toBe('2 / 1 / 1 / 1 / 1 / 4');
    expect(compact.tooltip).toBe('Cards that cost 0 / 1 / 2 / 3 / 4 / +5 mana');
    expect(compact.manaCounts).toBe(mana.manaCounts);
    expect(mana.text).toBe('2 / 1 / 1 / 1 / 1 / 2 / 2');
  });

  it('keeps composition without a redundant type column for a single type', () => {
    const { spellbook } = new DeckSectionStatisticsCache().get(deck('Common Sense', 'Kiss of Death'), metadata);
    expect(spellbook.columns[0]?.id).toBe('spells');
    expect(texts(spellbook, 'spells')).toEqual(['2 Spells', '1 E / 1 A / 0 W / 0 F', '1 o / 1 e / 0 e / 0 u', '0 / 1 / 1 / 0 / 0 / 0']);
    expect(column(spellbook, 'spells')[0]?.tooltip).toBe('2 Magic');
  });

  it('uses full Spellbook size for draw probabilities and counts each tribal copy once', () => {
    const { spellbook } = new DeckSectionStatisticsCache().get(deck(
      'The Wild Hunt', 'Aria Wraith', 'Aria Wraith', 'Helpful Hob', 'Beast of Burden',
      'Common Sense', 'Fireball', 'Zap!',
    ), metadata);
    expect(spellbook.columns.find(column => column.id === 'synergy-spirits')?.group).toBe('synergy');
    expect(texts(spellbook, 'synergy-spirits')).toEqual(['Spirits', '3 / 5', '60% / 38%', '82% / 100%']);
    expect(column(spellbook, 'synergy-spirits')[1]?.tooltip).toBe('3 of 5 minions');
    expect(column(spellbook, 'synergy-spirits')[3]?.tooltip).toBe('Chance of at least one in 3 / 6 Spellbook draws');
    expect(texts(spellbook, 'synergy-faeries')).toEqual(['Faeries', '2 / 5', '40% / 25%', '64% / 96%']);
  });

  it('updates variant counts and synergies from spell, site and shared avatar sources', () => {
    const area = deck('Helpful Hob', 'Aria Wraith', 'Brocéliande', 'Evil Presence', 'Common Sense',
      copy('The Wild Hunt', 'collection'), copy('Kiss of Death', 'maybeboard'));
    area.avatarCardName = 'Deathspeaker';
    area.deckVariants = [
      { id: 'main', name: 'Main', activeCardIds: ['copy-0', 'copy-1', 'copy-2', 'copy-3', 'copy-4'] },
      { id: 'alt', name: 'Alternate', activeCardIds: ['copy-0', 'copy-1', 'copy-4'] },
    ];
    area.activeDeckVariantId = 'alt';
    const cache = new DeckSectionStatisticsCache();

    const alternate = cache.get(area, metadata);
    expect(texts(alternate.main, 'counts').slice(0, 3)).toEqual(['3 Spells', '0 Sites', '1 Collection']);
    expect(column(alternate.spellbook, 'synergy-genesis')[0]?.tooltip).toContain('Deathspeaker');
    expect(alternate.spellbook.columns.map(column => column.id)).not.toContain('synergy-faeries');
    expect(alternate.spellbook.columns.map(column => column.id)).not.toContain('synergy-spirits');

    area.activeDeckVariantId = 'missing';
    const main = cache.get(area, metadata);
    expect(column(main.spellbook, 'synergy-spirits')[0]?.tooltip).toContain('Evil Presence');
    expect(column(main.spellbook, 'synergy-faeries')[0]?.tooltip).toContain('Brocéliande');
  });

  it('uses the avatar name on the deck, without double counting legacy copies or showing redundant Atlas sources', () => {
    const area = deck('Draco Corvus', 'Common Sense', 'Mountain Peaks');
    const cache = new DeckSectionStatisticsCache();
    const noAvatar = cache.get(area, metadata);
    expect(noAvatar.atlas.columns.map(column => column.id)).toEqual(['sites']);
    expect(noAvatar.spellbook.columns.some(column => column.id === 'synergy-unique-dragons')).toBe(false);
    area.avatarCardName = 'Dragonlord';
    const dragonlord = cache.get(area, metadata);
    expect(column(dragonlord.spellbook, 'synergy-unique-dragons')[0]?.tooltip).toContain('Dragonlord');
    area.cards.push(copy('Dragonlord', 'avatar'), copy('Templar', 'avatar'));
    expect(cache.get(area, metadata)).toBe(dragonlord);
  });

  it('handles unknown active copies and an empty deck without misleading ratios', () => {
    const cache = new DeckSectionStatisticsCache();
    const incomplete = cache.get(deck('Unknown', copy('Unknown Collection', 'collection'), copy('Unknown Avatar', 'avatar')), metadata);
    expect(incomplete.unknownCount).toBe(1);
    expect(column(incomplete.main, 'unclassified')[0]).toMatchObject({ text: '1 Unclassified', warning: true });
    expect(incomplete.spellbook).toEqual({ count: 0, columns: [] });
    expect(incomplete.atlas).toEqual({ count: 0, columns: [] });
    expect(texts(cache.get(deck(), metadata).main, 'counts')).toEqual(['0 Spells', '0 Sites', '0 Collection', 'Invalid deck']);
  });

  it('reuses analysis across irrelevant edits and recalculates on membership, Collection size, avatar or metadata changes', () => {
    const area = deck('Common Sense', 'Brocéliande', copy('Common Sense', 'collection'));
    const cache = new DeckSectionStatisticsCache();
    const before = cache.get(area, metadata);
    const moved: CanvasArea = { ...area, cards: area.cards.map(card => ({ ...card, x: 150, y: 300, labelId: 'arbitrary' })).reverse() };
    required(moved.cards[0]).cardName = 'Unknown';
    expect(cache.get(moved, metadata)).toBe(before);
    moved.cards.push(copy('Unknown', 'collection'), copy('Another Unknown', 'maybeboard'));
    const withCollection = cache.get(moved, metadata);
    expect(withCollection).not.toBe(before);
    expect(texts(withCollection.main, 'counts')).toContain('2 Collection');

    moved.cards.push(copy('Animist', 'avatar'));
    expect(cache.get(moved, metadata)).toBe(withCollection);
    moved.cards.push(copy('Deathspeaker', 'avatar'));
    const withAvatar = cache.get(moved, metadata);
    expect(withAvatar).not.toBe(withCollection);
    required(moved.cards[0]).board = 'mainboard';
    expect(cache.get(moved, metadata).unknownCount).toBe(1);
    expect(cache.get(moved, metadata.filter(card => card.name !== 'Common Sense')).spellbook.count).toBe(0);
  });

  it('evicts removed areas while preserving summaries for the remaining decks', () => {
    const cache = new DeckSectionStatisticsCache();
    const remaining = deck('Common Sense');
    const removed = { ...deck('Brocéliande'), id: 'removed' };
    const remainingSummary = cache.get(remaining, metadata);
    const removedSummary = cache.get(removed, metadata);

    cache.retainAreaIds(new Set([remaining.id]));

    expect(cache.get(remaining, metadata)).toBe(remainingSummary);
    expect(cache.get(removed, metadata)).not.toBe(removedSummary);
  });
});
