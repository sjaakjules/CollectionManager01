import type { CanvasLabel, Card } from '@/data/dataModels';
import type { CanvasArea } from './canvasAreas';
import { DECK_BOARD_ORDER, normalizeDeckBoard, type DeckZoneBoard } from './deckBoardLayout';
import { getLabelFamily } from './labelRegions';

export interface LabelStatistics {
  count: number;
  meanMana: number | null;
  spellChance: number | null;
  spellChanceSix: number | null;
  siteChance: number | null;
  siteChanceSix: number | null;
  text: string;
  /** Optional composition metrics in display order. */
  extras: string[];
  tooltip: string;
}

interface CardClassification {
  type: string;
  subtypes: ReadonlySet<string>;
  pool: 'spell' | 'site' | null;
  mana: number | null;
}

const categoryPlurals = new Map([
  ['dwarf', 'Dwarves'], ['magic', 'Magic cards'],
  ['merfolk', 'Merfolk'], ['sphinx', 'Sphinxes'], ['undead', 'Undead'],
]);

/** Fit complete metrics into the two lines reserved under a canvas label. */
export function formatLabelStatistics(stats: LabelStatistics, width: number, measure: (text: string) => number): string {
  const [summary = '', draws = ''] = stats.text.split('\n');
  const fits = (line: string) => measure(line) <= width;
  const lines = [
    fits(summary) ? summary : summary.replace('avg mana ', 'avg '),
    fits(draws) ? draws : draws.replace(/%(?=\/)/g, ''),
  ];

  if (lines.every(fits)) {
    for (const extra of stats.extras) {
      for (const [index, line] of lines.entries()) {
        const next = line ? `${line} · ${extra}` : extra;
        if (!fits(next)) continue;
        lines[index] = next;
        break;
      }
    }
  }
  return lines.filter(Boolean).join('\n');
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

function classifyCard(card: Card): CardClassification | undefined {
  const type = card.guardian?.type?.trim().toLowerCase();
  if (!type) return undefined;
  const pool = type === 'avatar' ? null : type === 'site' ? 'site' : 'spell';
  const cost = card.guardian.cost;
  const mana = pool === 'spell' && typeof cost === 'number' && Number.isFinite(cost) ? cost : null;
  const subtypes = new Set(card.subTypes?.split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  return { type, subtypes, pool, mana };
}

function compositionExtras(members: CardClassification[], boardCards: CardClassification[], board: DeckZoneBoard) {
  const first = members[0];
  if (!first || !members.every(member => member.type === first.type)) return { extras: [], detail: '' };

  const plural = (category: string) => categoryPlurals.get(category) ?? `${category.charAt(0).toUpperCase()}${category.slice(1)}s`;
  const sameTypeTotal = boardCards.filter(card => card.type === first.type).length;
  const subtypes = first.type === 'minion' ? [...first.subtypes].filter(subtype => members.every(member => member.subtypes.has(subtype))) : [];
  const categories = subtypes.length ? subtypes : [first.type];
  const extras = categories.map(category =>
    `${plural(category)} ${members.length}/${sameTypeTotal} (${Math.round(members.length * 100 / sameTypeTotal)}%)`);
  const boardName = board === 'mainboard' ? 'Main' : board === 'collection' ? 'Collection' : 'Maybe';
  return { extras, detail: `Shares compare this group with all ${plural(first.type).toLowerCase()} in ${boardName}.` };
}

function formatDrawChance(three: number | null, six: number | null): string {
  return three === null || six === null ? '' : `${Math.round(three * 100)}%/${Math.round(six * 100)}%`;
}

/** Positions do not affect statistics. Dragging and rendering reuse this result. */
export class LabelStatisticsCache {
  private signature = '';
  private metadata: Card[] | undefined;
  private byName = new Map<string, CardClassification | undefined>();
  private result = new Map<string, LabelStatistics>();

  get(labels: CanvasLabel[], areas: CanvasArea[], metadata: Card[]): Map<string, LabelStatistics> {
    const signature = JSON.stringify([
      labels.map(label => [label.id, label.areaId, label.parentLabelId, label.board]),
      areas.map(area => [area.id, area.type, area.activeDeckVariantId, area.deckVariants,
        area.cards.map(card => [card.id, card.cardName, card.board, card.labelId])]),
    ]);
    if (signature === this.signature && metadata === this.metadata) return this.result;
    this.signature = signature;
    if (metadata !== this.metadata) {
      this.metadata = metadata;
      this.byName = new Map(metadata.map(card => [card.name, classifyCard(card)]));
    }
    this.result = new Map();
    for (const area of areas) {
      const areaLabels = labels.filter(label => label.areaId === area.id);
      if (!areaLabels.length) continue;
      const isDeck = area.type === 'deck';
      const variant = area.deckVariants?.find(entry => entry.id === area.activeDeckVariantId) ?? area.deckVariants?.[0];
      const mainVariantIds = isDeck && variant ? new Set(variant.activeCardIds) : null;
      for (const board of isDeck ? DECK_BOARD_ORDER : ['mainboard'] as const) {
        const boardLabels = areaLabels.filter(label => !isDeck || normalizeDeckBoard(label.board) === board);
        if (!boardLabels.length) continue;
        const boardCards = area.cards.filter(card => !isDeck || (card.board !== 'avatar' && normalizeDeckBoard(card.board) === board));
        const activeIds = board === 'mainboard' ? mainVariantIds : null;
        const activeCards = boardCards.filter(card => !activeIds || activeIds.has(card.id));
        const classified = activeCards.map(card => this.byName.get(card.cardName)).filter(card => card !== undefined);
        const complete = classified.length === activeCards.length;
        const odds = isDeck && board === 'mainboard' && complete;
        const spells = odds ? classified.filter(card => card.pool === 'spell').length : 0;
        const sites = odds ? classified.filter(card => card.pool === 'site').length : 0;

        for (const label of boardLabels) {
          const family = getLabelFamily(boardLabels, label.id);
          const allMembers = boardCards.filter(card => card.labelId && family.has(card.labelId));
          if (!allMembers.length) continue;
          const members = allMembers.filter(card => !activeIds || activeIds.has(card.id));
          const knownMembers = members.map(card => this.byName.get(card.cardName)).filter(card => card !== undefined);
          const costs = knownMembers.map(card => card.mana).filter(cost => cost !== null);
          const meanMana = costs.length ? costs.reduce((sum, cost) => sum + cost, 0) / costs.length : null;
          const spellMatches = knownMembers.filter(card => card.pool === 'spell').length;
          const siteMatches = knownMembers.filter(card => card.pool === 'site').length;
          const spellChance = odds && spellMatches ? chanceOfDrawingLabel(spellMatches, spells) : null;
          const spellChanceSix = odds && spellMatches ? chanceOfDrawingLabel(spellMatches, spells, 6) : null;
          const siteChance = odds && siteMatches ? chanceOfDrawingLabel(siteMatches, sites) : null;
          const siteChanceSix = odds && siteMatches ? chanceOfDrawingLabel(siteMatches, sites, 6) : null;
          const spellDraws = formatDrawChance(spellChance, spellChanceSix);
          const siteDraws = formatDrawChance(siteChance, siteChanceSix);
          const drawText = spellDraws && siteDraws ? `spells ${spellDraws} · sites ${siteDraws}` : spellDraws || siteDraws;
          const text = `${members.length} ${members.length === 1 ? 'card' : 'cards'}${meanMana === null ? '' : ` · avg mana ${meanMana.toFixed(1)}`}` +
            (drawText ? `\n≥1 in 3/6: ${drawText}` : '');
          const { extras, detail } = isDeck && complete ? compositionExtras(knownMembers, classified, board) : { extras: [], detail: '' };
          const drawPool = spellDraws && siteDraws ? 'Spells use the Spellbook and sites use the Atlas.'
            : spellDraws ? 'Draws use the Spellbook.' : 'Draws use the Atlas.';
          const tooltip = [
            meanMana === null ? '' : 'Average mana uses spells with a known mana cost.',
            drawText ? `Chance of drawing at least one group card in 3 or 6 draws without replacement. ${drawPool}` : '',
            detail,
          ].filter(Boolean).join('\n');
          this.result.set(label.id, { count: members.length, meanMana, spellChance, spellChanceSix, siteChance, siteChanceSix, text, extras, tooltip });
        }
      }
    }
    return this.result;
  }
}
