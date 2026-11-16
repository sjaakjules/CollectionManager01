import type { CanvasLabel, Card } from '@/data/dataModels';
import type { CanvasArea } from './canvasAreas';
import { normalizeDeckBoard } from './deckBoardLayout';
import { getLabelFamily } from './labelRegions';

export interface LabelStatistics {
  count: number;
  meanMana: number | null;
  spellChance: number | null;
  siteChance: number | null;
  text: string;
}

/** At least one success in draws without replacement; never mixes the two decks. */
export function chanceOfDrawingLabel(matches: number, pool: number, draws = 3): number | null {
  if (pool <= 0) return null;
  let miss = 1;
  for (let i = 0; i < Math.min(draws, pool); i++) {
    miss *= Math.max(0, pool - matches - i) / (pool - i);
  }
  return 1 - miss;
}

function drawPool(card: Card | undefined): 'spell' | 'site' | null {
  const type = card?.guardian.type.toLowerCase();
  return !type || type === 'avatar' ? null : type === 'site' ? 'site' : 'spell';
}

/** Positions do not affect statistics. Dragging and rendering reuse this result. */
export class LabelStatisticsCache {
  private signature = '';
  private metadata: Card[] | undefined;
  private result = new Map<string, LabelStatistics>();

  get(labels: CanvasLabel[], areas: CanvasArea[], metadata: Card[]): Map<string, LabelStatistics> {
    const signature = JSON.stringify([
      labels.map(label => [label.id, label.areaId, label.parentLabelId, label.board]),
      areas.map(area => [area.id, area.type, area.activeDeckVariantId, area.deckVariants,
        area.cards.map(card => [card.id, card.cardName, card.board, card.labelId])]),
    ]);
    if (signature === this.signature && metadata === this.metadata) return this.result;
    this.signature = signature;
    this.metadata = metadata;
    const byName = new Map(metadata.map(card => [card.name, card]));
    this.result = new Map();
    for (const area of areas) {
      const variant = area.deckVariants?.find(entry => entry.id === area.activeDeckVariantId) ?? area.deckVariants?.[0];
      const active = area.type === 'deck' && variant ? new Set(variant.activeCardIds) : null;
      const cards = area.cards.filter(card => normalizeDeckBoard(card.board) !== 'mainboard' || !active || active.has(card.id));
      const main = cards.filter(card => normalizeDeckBoard(card.board) === 'mainboard');
      const knownPool = main.every(card => byName.has(card.cardName));
      const spells = main.filter(card => drawPool(byName.get(card.cardName)) === 'spell');
      const sites = main.filter(card => drawPool(byName.get(card.cardName)) === 'site');
      for (const label of labels.filter(label => label.areaId === area.id)) {
        const family = getLabelFamily(labels, label.id);
        const members = cards.filter(card => card.labelId && family.has(card.labelId));
        if (!area.cards.some(card => card.labelId && family.has(card.labelId))) continue;
        const costs = members.flatMap(instance => {
          const card = byName.get(instance.cardName);
          const cost = card?.guardian.cost;
          return drawPool(card) === 'spell' && typeof cost === 'number' && Number.isFinite(cost) ? [cost] : [];
        });
        const meanMana = costs.length ? costs.reduce((sum, cost) => sum + cost, 0) / costs.length : null;
        const memberIds = new Set(members.map(card => card.id));
        const odds = area.type === 'deck' && normalizeDeckBoard(label.board) === 'mainboard' && knownPool;
        const spellMatches = spells.filter(card => memberIds.has(card.id)).length;
        const siteMatches = sites.filter(card => memberIds.has(card.id)).length;
        const spellChance = odds && spellMatches ? chanceOfDrawingLabel(spellMatches, spells.length) : null;
        const siteChance = odds && siteMatches ? chanceOfDrawingLabel(siteMatches, sites.length) : null;
        const drawText = [spellChance === null ? '' : `spells ${Math.round(spellChance * 100)}%`,
          siteChance === null ? '' : `sites ${Math.round(siteChance * 100)}%`].filter(Boolean).join(' · ');
        const text = `${members.length} ${members.length === 1 ? 'card' : 'cards'}${meanMana === null ? '' : ` · avg mana ${meanMana.toFixed(1)}`}` +
          (drawText ? `\n≥1 in 3 draws: ${drawText}` : '');
        this.result.set(label.id, { count: members.length, meanMana, spellChance, siteChance, text });
      }
    }
    return this.result;
  }
}
