import type { Card, Deck, DeckBoards, Thresholds } from './dataModels';
import { getRarityLimit } from '@/rules/deckRules';
import { isBlockedTokenCardName } from './tokenCards';
import { getDeckStyleProfilesForDeck, type DeckStyleAssociationData, type DeckStyleDeckProfile } from './deckStyleAssociations';

export function getDeckMetrics(deck: Deck, cards: Card[]) {
  const byName = new Map(cards.map((card) => [card.name, card]));
  const types = new Map<string, number>();
  const curve = new Map<number, number>();
  const thresholds: Thresholds = { air: 0, earth: 0, fire: 0, water: 0 };
  const unknown: string[] = [];
  let spells = 0;
  let sites = 0;
  let manaTotal = 0;
  let costedSpells = 0;
  for (const { name, quantity } of deck.boards.mainboard) {
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const card = byName.get(name);
    if (!card) { unknown.push(name); continue; }
    const stats = card.guardian;
    if (stats.type === 'Site') { sites += quantity; continue; }
    if (stats.type === 'Avatar') continue;
    spells += quantity;
    types.set(stats.type || 'Unknown type', (types.get(stats.type || 'Unknown type') ?? 0) + quantity);
    if (stats.cost !== null && Number.isFinite(stats.cost) && stats.cost >= 0) {
      manaTotal += stats.cost * quantity;
      costedSpells += quantity;
      curve.set(stats.cost, (curve.get(stats.cost) ?? 0) + quantity);
    }
    for (const element of ['air', 'earth', 'fire', 'water'] as const) {
      thresholds[element] += Math.max(0, stats.thresholds[element] || 0) * quantity;
    }
  }
  const count = (board: keyof DeckBoards) => deck.boards[board].reduce((total, card) => total + card.quantity, 0);
  return {
    spells, sites, collection: count('collection'), maybe: count('maybeboard'), unknown,
    averageCost: costedSpells ? manaTotal / costedSpells : null,
    uncostedSpells: spells - costedSpells,
    types: [...types].sort(([a], [b]) => a.localeCompare(b)),
    curve: [...curve].sort(([a], [b]) => a - b), thresholds,
  };
}

type Vector = Map<string, number>;
export interface AddedDeckStyleAnalysis {
  profiles: DeckStyleDeckProfile[];
  closestSimilarity: number;
  neighborCount: number;
}

/** Matches the archive's TF-IDF nearest-deck approach: rarity saturation,
 * avatar 1.4, spells 1, sites .3, Collection .45; eight neighbours, similarity³.
 * Scores are estimates from current card contents, never a stale remote deck ID.
 * Build once per catalogue; no network requests and no work on animation frames. */
export function createDeckStyleAnalyzer(data: DeckStyleAssociationData, cards: Card[]) {
  const byName = new Map(cards.map((card) => [card.name, card]));
  const vectorFor = (boards: DeckBoards): Vector => {
    const vector: Vector = new Map();
    for (const board of ['avatar', 'mainboard', 'collection'] as const) {
      const totals = new Map<string, number>();
      for (const { name, quantity } of boards[board]) {
        if (quantity > 0 && Number.isFinite(quantity)) totals.set(name, (totals.get(name) ?? 0) + quantity);
      }
      for (const [name, quantity] of totals) {
        const card = byName.get(name);
        if (!card || isBlockedTokenCardName(name)) continue;
        const section = board === 'avatar' ? 'avatar' : board === 'collection' ? 'collection'
          : card.guardian.type === 'Site' ? 'atlas' : 'spellbook';
        const weight = { avatar: 1.4, collection: 0.45, atlas: 0.3, spellbook: 1 }[section];
        const limit = board === 'avatar' ? 1 : getRarityLimit(card.guardian.rarity) ?? quantity;
        vector.set(`${section}:${name}`, Math.min(1, quantity / limit) * weight);
      }
    }
    return vector;
  };
  const sources = Object.values(data.decks).map((deck) => ({
    id: deck.id, vector: vectorFor(deck.boards), profiles: getDeckStyleProfilesForDeck(data, deck.id),
  }));
  const frequencies = new Map<string, number>();
  for (const { vector } of sources) for (const key of vector.keys()) frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
  const idf = (key: string) => Math.log((sources.length + 1) / ((frequencies.get(key) ?? 0) + 1)) + 1;
  const norm = (vector: Vector) => Math.sqrt([...vector].reduce((sum, [key, value]) => sum + (value * idf(key)) ** 2, 0));
  const reference = sources.filter((source) => source.profiles.length > 0)
    .map((source) => ({ ...source, norm: norm(source.vector) }));

  return (deck: Deck): AddedDeckStyleAnalysis => {
    const vector = vectorFor(deck.boards);
    const magnitude = norm(vector);
    const candidates = reference.map((source) => {
      let dot = 0;
      let mainOverlap = false;
      for (const [key, value] of vector) {
        const other = source.vector.get(key) ?? 0;
        if (other > 0 && (key.startsWith('spellbook:') || key.startsWith('atlas:'))) mainOverlap = true;
        dot += value * other * idf(key) ** 2;
      }
      const similarity = mainOverlap && magnitude > 0 && source.norm > 0
        ? Math.min(1, dot / (magnitude * source.norm)) : 0;
      return { ...source, similarity };
    }).filter((source) => source.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id));
    const closestSimilarity = candidates[0]?.similarity ?? 0;
    const neighbors = candidates.filter((source) => source.similarity >= closestSimilarity * 0.45).slice(0, 8);
    const totalWeight = neighbors.reduce((sum, source) => sum + source.similarity ** 3, 0);
    const profiles: DeckStyleDeckProfile[] = data.styles.map((style) => {
      const scoreFor = (subId?: string) => totalWeight ? neighbors.reduce((sum, source) => {
        const profile = source.profiles.find((entry) => entry.id === style.id);
        const entry = subId ? profile?.subStyles.find((sub) => sub.id === subId) : profile;
        return sum + (entry?.score || (entry?.primary ? 1 : 0)) * source.similarity ** 3;
      }, 0) / totalWeight : 0;
      const subStyles = style.subStyles.map((sub) => ({ id: sub.id, name: sub.name, score: scoreFor(sub.id), primary: false }))
        .filter((sub) => sub.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
      return { id: style.id, name: style.name, score: scoreFor(), primary: false, subStyles };
    }).filter((style) => style.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    if (profiles[0]) {
      profiles[0].primary = true;
      if (profiles[0].subStyles[0]) profiles[0].subStyles[0].primary = true;
    }
    return { profiles, closestSimilarity, neighborCount: neighbors.length };
  };
}
