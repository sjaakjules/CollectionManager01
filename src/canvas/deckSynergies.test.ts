import { describe, expect, it } from 'vitest';
import catalogue from '../../public/assets/sorcery_cards.json';
import { normalizeCardCatalog } from '@/data/cardCatalog';
import { withProvisionalCards } from '@/data/provisionalCards';
import { required } from '@/utils/required';
import { getDeckSynergies } from './deckSynergies';

const cards = new Map(withProvisionalCards(normalizeCardCatalog(catalogue).cards).map(card => [card.name, card]));

function synergies(spells: string[], sites: string[] = [], avatars: string[] = []) {
  const lookup = (names: string[]) => names.map(name => required(cards.get(name)));
  return getDeckSynergies(lookup(spells), lookup(sites), lookup(avatars));
}

describe('deck synergy sources', () => {
  it('finds tribal interactions from real Spellbook and Atlas sources and deduplicates source cards', () => {
    const { spellbook } = synergies([
      'The Wild Hunt', 'Aria Wraith', 'Aria Wraith', 'Helpful Hob', 'Beast of Burden', 'Hellhounds', 'Death Knight',
      'Kiss of Death', 'Kiss of Death', 'Evil Presence', 'Common Sense',
    ], ['Brocéliande', 'Varmint Warrens', 'Pond']);
    const get = (id: string) => required(spellbook.find(synergy => synergy.id === id));
    expect(get('beasts')).toMatchObject({ count: 1, sources: ['Brocéliande', 'Pond', 'Varmint Warrens'] });
    expect(get('faeries')).toMatchObject({ count: 2, sources: ['Brocéliande', 'The Wild Hunt'] });
    expect(get('spirits')).toMatchObject({ count: 3, sources: ['Evil Presence', 'Kiss of Death', 'The Wild Hunt'] });
    expect(get('undead')).toMatchObject({ count: 1, sources: ['Kiss of Death'] });
  });

  it('requires a different target to activate the source and counts all trait copies once active', () => {
    const alone = synergies(['The Wild Hunt', 'Common Sense', 'Arcane Barrage']).spellbook;
    expect(alone).toEqual([]);
    const paired = synergies(['The Wild Hunt', 'The Wild Hunt', 'Common Sense', 'Common Sense', 'Zap!']).spellbook;
    expect(paired).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'spirits', count: 2, sources: ['The Wild Hunt'] }),
      expect.objectContaining({ id: 'faeries', count: 2, sources: ['The Wild Hunt'] }),
    ]));
    expect(paired.some(match => match.id === 'ordinary-spells')).toBe(false);
    expect(synergies(['The Wild Hunt', 'Aria Wraith', 'Zap!']).spellbook).toEqual([
      expect.objectContaining({ id: 'spirits', count: 2, sources: ['The Wild Hunt'] }),
    ]);
  });

  it('includes explicit shared benefits and ignores opponent checks, abilities imposed on others, and hose effects', () => {
    const { spellbook, atlas } = synergies([
      'Seelie Court', 'Unseelie Court', 'Helpful Hob', 'Cold Iron Rod', 'Sky Baron', 'Arjaro Exorcist',
      'Hounds of Ondaros', 'King Krakalak', 'Jack the Ripper', 'Death Knight', 'Panorama Manticore',
      'All Mortals Gone', 'Satanic Panic', 'Sjaelström', 'Scarecrow', 'Wall of Air', 'Extinguish', 'Watchtower',
    ], ['Updraft Ridge', 'Hunter\'s Lodge', 'Pebbled Paths', 'Court of Equity', 'Mobbed Court', 'Mock Court']);
    expect(spellbook.map(({ id, count, sources }) => [id, count, sources])).toEqual([
      ['airborne', 3, ['Updraft Ridge']],
      ['faeries', 3, ['Seelie Court']],
    ]);
    expect(atlas).toEqual([]);
  });

  it('counts printed Ranged, Airborne and Charge without treating keyword mentions as abilities', () => {
    const { spellbook } = synergies([
      'Belmotte Longbowmen', 'Spire Lich', 'Swiven Scout', 'Sky Baron', 'Aria Wraith',
      'The Wild Hunt', 'War Horse', 'Gyre Hippogriffs', 'Helpful Hob', 'Zap!',
    ], ['Updraft Ridge', 'Vantage Hills', 'Pebbled Paths']);
    const get = (id: string) => required(spellbook.find(synergy => synergy.id === id));
    expect(get('ranged')).toMatchObject({ count: 2, sources: ['Vantage Hills'] });
    expect(get('airborne')).toMatchObject({ count: 3, sources: ['Updraft Ridge'] });
    expect(get('charge')).toMatchObject({ count: 2, sources: [] });
    expect(synergies(['War Horse', 'Gyre Hippogriffs', 'Helpful Hob', 'Charge']).spellbook.find(match => match.id === 'charge')?.count).toBe(2);
    expect(synergies(['War Horse', 'Gyre Hippogriffs', 'Charge']).spellbook.some(match => match.id === 'charge')).toBe(false);
  });

  it('applies rarity, mana, subtype and avatar prerequisites to the correct card copies', () => {
    const { spellbook } = synergies([
      'Call to War', 'Black Knight', 'Death Knight', 'Highland Princess', 'Cold Iron Rod', 'Highland Falconer',
      'Apostles of Thamariel', 'Jussi Puffins', 'Arctic Fox', 'Belmotte Longbowmen', 'Archangel Gabriel', 'Zap!',
    ], ['Camelot', 'Town'], ['Templar']);
    const get = (id: string) => required(spellbook.find(synergy => synergy.id === id));
    expect(get('exceptional-mortals')).toMatchObject({ count: 1, sources: ['Call to War'] });
    expect(get('low-cost-artefacts')).toMatchObject({ count: 1, minionCount: 0 });
    expect(get('beasts-airborne')).toMatchObject({ count: 1, sources: ['Highland Falconer'] });
    expect(get('angels')).toMatchObject({ count: 1, sources: ['Apostles of Thamariel'] });
    expect(get('knights')).toMatchObject({ count: 2, sources: ['Templar'] });
    expect(get('unique-minions')).toMatchObject({ count: 3, sources: ['Camelot'] });
  });

  it('measures actual Atlas dependencies and excludes harmful Court costs as synergy sources', () => {
    const { atlas } = synergies(['Spire Lich', 'Fenvale Muse', 'Khamaseen Mummy'], [
      'Court of Equity', 'Mobbed Court', 'Mock Court', 'Overflowing Court', 'Dark Tower', 'Summer River', 'Remote Desert',
      'The Apex of Babel', 'The Base of Babel', 'Leyline Henge', 'Leyline Henge',
    ]);
    expect(atlas).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'courts', count: 4, sources: ['Overflowing Court'] }),
      expect.objectContaining({ id: 'rivers', count: 1, sources: ['Fenvale Muse'] }),
      expect.objectContaining({ id: 'deserts', count: 1, sources: ['Khamaseen Mummy'] }),
      expect.objectContaining({ id: 'towers', count: 1, sources: ['Spire Lich'] }),
      expect.objectContaining({ id: 'babel', count: 1, sources: ['The Base of Babel'] }),
      expect.objectContaining({ id: 'leyline-henges', count: 2, sources: ['Leyline Henge'] }),
    ]));
    expect(synergies([], ['Overflowing Court']).atlas).toEqual([]);
  });

  it('uses legible preview rules to pair supported sources with released and preview targets', () => {
    const { spellbook, atlas } = synergies([
      'Chosen One', "Captain's Macaw", 'Ogre Chef', 'King Croc', 'Giant Pelican', 'Tandoraz',
      'Belmotte Longbowmen', 'Helpful Hob', 'Pirate Ship', "Baldassare's Armada",
    ], ['Aqueduct', 'Deep Sea', 'Mountain Peaks']);
    const get = (id: string) => required(spellbook.find(synergy => synergy.id === id));
    expect(get('ordinary-mortals')).toMatchObject({ count: 2, sources: ['Chosen One'] });
    expect(get('genesis')).toMatchObject({ count: 2, sources: ["Captain's Macaw"] });
    expect(get('beasts')).toMatchObject({ count: 4, sources: ['Ogre Chef'] });
    expect(get('waterbound')).toMatchObject({ count: 2, sources: ['Giant Pelican'] });
    expect(atlas).toEqual([expect.objectContaining({ id: 'water-sites', count: 2, sources: ['King Croc'] })]);
  });

  it('does not turn preview damage, opponent choices or abilities granted to others into synergies', () => {
    const { spellbook, atlas } = synergies([
      'Don Quixote', 'Whisperwhomp', 'Mountain Giant', 'Sea Serpent', "Baldassare's Armada", 'Grand Heist', 'Broadside',
    ], ['Windmill', 'Mountain Peaks']);
    expect(spellbook).toEqual([expect.objectContaining({ id: 'charge', count: 1, sources: [] })]);
    expect(atlas).toEqual([]);
  });
});
