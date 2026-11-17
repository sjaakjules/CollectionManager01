import { getThresholdGroup, isAvatarType, isSiteType, type Card, type Thresholds } from '@/data/dataModels';
import type { CanvasArea } from './canvasAreas';
import { normalizeDeckBoard } from './deckBoardLayout';
import { getDeckSynergies, isDeckSynergySource, type DeckSynergy } from './deckSynergies';

interface DeckManaCounts {
  zero: number;
  one: number;
  two: number;
  three: number;
  four: number;
  five: number;
  sixPlus: number;
  variable: number;
}

export interface DeckStatisticCell {
  text: string;
  tooltip?: string;
  warning?: boolean;
  bold?: boolean;
  elementCounts?: readonly { element: keyof Thresholds; count: number }[];
  manaCounts?: Readonly<DeckManaCounts>;
}

export interface DeckStatisticColumn {
  id: string;
  group?: 'composition' | 'synergy';
  rows: readonly DeckStatisticCell[];
}

export interface DeckSectionSummary {
  count: number;
  columns: readonly DeckStatisticColumn[];
}

export interface DeckSectionStatistics {
  main: DeckSectionSummary;
  spellbook: DeckSectionSummary;
  atlas: DeckSectionSummary;
  unknownCount: number;
}

const ELEMENTS = [
  { id: 'earth', name: 'Earth' },
  { id: 'air', name: 'Air' },
  { id: 'water', name: 'Water' },
  { id: 'fire', name: 'Fire' },
] as const satisfies readonly { id: keyof Thresholds; name: string }[];

const RARITIES = ['Ordinary', 'Exceptional', 'Elite', 'Unique'] as const;
const TYPES = [
  { name: 'Minion', id: 'minions', label: 'Minions' },
  { name: 'Magic', id: 'magic', label: 'Magic' },
  { name: 'Artifact', id: 'artefacts', label: 'Artefacts' },
  { name: 'Aura', id: 'auras', label: 'Auras' },
] as const;
const MANA_BUCKETS = ['zero', 'one', 'two', 'three', 'four', 'five'] as const;

function percent(numerator: number, denominator: number): string {
  return `${denominator ? Math.round(100 * numerator / denominator) : 0}%`;
}

function countLabel(count: number, category: string): string {
  return `${count} ${count === 1 ? category.replace(/s$/, '') : category}`;
}

function countBy(cards: readonly Card[], matches: (card: Card) => boolean): number {
  return cards.filter(matches).length;
}

function countTooltip(counts: readonly number[], labels: readonly string[]): string {
  return labels.map((label, index) => `${counts[index]} ${label}`).join(' / ');
}

function rarityCell(cards: readonly Card[]): DeckStatisticCell {
  const counts = RARITIES.map(rarity => countBy(cards, card => card.guardian.rarity === rarity));
  return {
    text: RARITIES.map((rarity, index) => `${counts[index]} ${rarity.charAt(0).toLowerCase()}`).join(' / '),
    tooltip: countTooltip(counts, RARITIES),
  };
}

function elementCell(cards: readonly Card[]): DeckStatisticCell {
  const elementCounts = ELEMENTS.map(({ id: element }) => ({
    element, count: countBy(cards, card => card.guardian.thresholds[element] > 0),
  }));
  return {
    text: elementCounts.map(({ element, count }) => `${count} ${element.charAt(0).toUpperCase()}`).join(' / '),
    tooltip: countTooltip(elementCounts.map(({ count }) => count), ELEMENTS.map(({ name }) => name)),
    elementCounts,
  };
}

function manaCounts(cards: readonly Card[]): DeckManaCounts {
  const counts: DeckManaCounts = { zero: 0, one: 0, two: 0, three: 0, four: 0, five: 0, sixPlus: 0, variable: 0 };
  for (const { guardian: { cost } } of cards) {
    if (cost === null || !Number.isInteger(cost) || cost < 0) counts.variable++;
    else if (cost >= 6) counts.sixPlus++;
    else counts[MANA_BUCKETS[cost] ?? 'variable']++;
  }
  return counts;
}

function manaCell(counts: Readonly<DeckManaCounts>, compact = false): DeckStatisticCell {
  const values = [counts.one, counts.two, counts.three, counts.four];
  const labels = ['1', '2', '3', '4'];
  if (counts.zero) {
    values.unshift(counts.zero);
    labels.unshift('0');
  }
  if (compact) {
    values.push(counts.five + counts.sixPlus);
    labels.push('+5');
  } else {
    values.push(counts.five, counts.sixPlus);
    labels.push('5', '+6');
  }
  return {
    text: values.join(' / '),
    tooltip: `Cards that cost ${labels.join(' / ')} mana`,
    manaCounts: counts,
  };
}

/** Fit a mana row against the measured width of the annotated rows above it. */
export function formatDeckManaCell(cell: DeckStatisticCell, width: number, measure: (text: string) => number): DeckStatisticCell {
  if (!cell.manaCounts || measure(cell.text) <= width) return cell;
  return { ...cell, ...manaCell(cell.manaCounts, true) };
}

function mainColumns(spells: readonly Card[], sites: readonly Card[], collectionCount: number, unknownCount: number): DeckStatisticColumn[] {
  const tooFewSpells = spells.length < 60;
  const tooFewSites = sites.length < 30;
  const tooManyCollection = collectionCount > 10;
  const rows: DeckStatisticCell[] = [
    { text: countLabel(spells.length, 'Spells'), tooltip: 'Spellbook · Minimum 60 spells', warning: tooFewSpells, bold: true },
    { text: countLabel(sites.length, 'Sites'), tooltip: 'Atlas · Minimum 30 sites', warning: tooFewSites, bold: true },
    { text: `${collectionCount} Collection`, tooltip: 'Collection · Maximum 10 cards', warning: tooManyCollection, bold: true },
  ];
  const violations = [
    tooFewSpells ? 'At least 60 spells' : '',
    tooFewSites ? 'At least 30 sites' : '',
    tooManyCollection ? 'At most 10 Collection cards' : '',
  ].filter(Boolean);
  if (violations.length) rows.push({
    text: 'Invalid deck',
    tooltip: violations.join(' · '),
    warning: true,
  });

  const elements = ELEMENTS.map(({ id, name }) => ({
    id, name,
    spells: countBy(spells, card => card.guardian.thresholds[id] > 0),
    sites: countBy(sites, card => card.guardian.thresholds[id] > 0),
    output: sites.reduce((sum, { guardian }) => sum + guardian.thresholds[id], 0),
  }));
  const thresholdedSpells = countBy(spells, card => ELEMENTS.some(({ id }) => card.guardian.thresholds[id] > 0));
  const totalOutput = sites.reduce((sum, { guardian }) =>
    sum + Math.max(1, ELEMENTS.reduce((symbols, { id }) => symbols + guardian.thresholds[id], 0)), 0);
  const columns: DeckStatisticColumn[] = [
    { id: 'counts', rows },
    ...elements.filter(element => element.spells > 0).map(element => ({
      id: element.id,
      rows: [
        { text: element.name },
        {
          text: `${percent(element.spells, spells.length)} Spells / ${percent(element.spells, thresholdedSpells)} Cost`,
          tooltip: `${element.spells} of ${spells.length} spells require ${element.name} · Cost excludes colourless spells`,
        },
        {
          text: `${percent(element.sites, sites.length)} Sites / ${percent(element.output, totalOutput)} Output`,
          tooltip: element.sites
            ? `${element.sites} of ${sites.length} sites produce ${element.name} · Output counts each symbol; blank sites count as one`
            : `No ${element.name} sites`,
          warning: !element.sites,
        },
      ],
    })),
  ];
  if (unknownCount) columns.push({
    id: 'unclassified',
    rows: [{
      text: `${unknownCount} Unclassified`,
      tooltip: 'Cards with unknown types',
      warning: true,
    }],
  });
  return columns;
}

function spellTypeColumn(id: string, title: string, cards: readonly Card[], headingTooltip?: string): DeckStatisticColumn {
  return {
    id,
    group: 'composition',
    rows: [
      { text: title, tooltip: headingTooltip },
      elementCell(cards),
      rarityCell(cards),
      manaCell(manaCounts(cards)),
    ],
  };
}

function spellTypeColumns(spells: readonly Card[]): DeckStatisticColumn[] {
  if (!spells.length) return [];
  const groups = TYPES.map(type => ({ ...type, cards: spells.filter(card => card.guardian.type === type.name) }))
    .filter(type => type.cards.length);
  if (groups.length === 1 && groups[0]?.cards.length === spells.length) {
    return [spellTypeColumn('spells', countLabel(spells.length, 'Spells'), spells, countLabel(spells.length, groups[0].label))];
  }
  if (groups.length === 0) return [spellTypeColumn('spells', countLabel(spells.length, 'Spells'), spells)];
  return groups.map(type => spellTypeColumn(type.id, countLabel(type.cards.length, type.label), type.cards));
}

function atlasColumns(sites: readonly Card[]): DeckStatisticColumn[] {
  if (!sites.length) return [];
  const noPrinted = countBy(sites, card => getThresholdGroup(card.guardian.thresholds) === 'none');
  const multiple = countBy(sites, card => getThresholdGroup(card.guardian.thresholds) === 'multiple');
  const columns: DeckStatisticColumn[] = [{
    id: 'sites', group: 'composition',
    rows: [{ text: countLabel(sites.length, 'Sites') }, elementCell(sites), rarityCell(sites)],
  }];
  const sourceRows = [
    { count: noPrinted, text: `${noPrinted} No threshold`, tooltip: `${noPrinted} sites with no printed threshold` },
    { count: multiple, text: `${multiple} Multi-element`, tooltip: `${multiple} sites with more than one element` },
  ].filter(({ count }) => count > 0 && count < sites.length).map(({ text, tooltip }) => ({ text, tooltip }));
  if (sourceRows.length) columns.push({ id: 'sources', rows: [{ text: 'Sources' }, ...sourceRows] });
  return columns;
}

function drawChance(matches: number, count: number, draws: number): string {
  let miss = 1;
  for (let drawn = 0; drawn < Math.min(draws, count); drawn++) {
    miss *= Math.max(0, count - matches - drawn) / (count - drawn);
  }
  return percent(1 - miss, 1);
}

function synergyColumn(synergy: DeckSynergy, pool: number, section: 'Spellbook' | 'Atlas', minions = 0): DeckStatisticColumn {
  const { id, label, sources, count, minionCount } = synergy;
  const useMinionRatio = minions > 0 && count === minionCount;
  return {
    id: `synergy-${id}`,
    group: 'synergy',
    rows: [
      { text: label, tooltip: sources.length ? sources.join(' · ') : 'Minions with Charge' },
      useMinionRatio
        ? { text: `${count} / ${minions}`, tooltip: `${count} of ${minions} minions` }
        : { text: `${count} / ${pool}`, tooltip: `${count} of ${pool} ${section === 'Spellbook' ? 'spells' : 'sites'}` },
      {
        text: useMinionRatio ? `${percent(count, minions)} / ${percent(count, pool)}` : percent(count, pool),
        tooltip: useMinionRatio ? 'Percentage of minions / all spells' : `Percentage of all ${section === 'Spellbook' ? 'spells' : 'sites'}`,
      },
      {
        text: `${drawChance(count, pool, 3)} / ${drawChance(count, pool, 6)}`,
        tooltip: `Chance of at least one in 3 / 6 ${section} draws`,
      },
    ],
  };
}

function summarize(spells: Card[], sites: Card[], avatars: Card[], collectionCount: number, unknownCount: number): DeckSectionStatistics {
  const minions = countBy(spells, card => card.guardian.type === 'Minion');
  const synergy = getDeckSynergies(spells, sites, avatars);
  return {
    unknownCount,
    main: {
      count: spells.length + sites.length,
      columns: mainColumns(spells, sites, collectionCount, unknownCount),
    },
    spellbook: {
      count: spells.length,
      columns: [...spellTypeColumns(spells), ...synergy.spellbook.map(match => synergyColumn(match, spells.length, 'Spellbook', minions))],
    },
    atlas: {
      count: sites.length,
      columns: [...atlasColumns(sites), ...synergy.atlas.map(match => synergyColumn(match, sites.length, 'Atlas'))],
    },
  };
}

/** Reuse results across moves, labels and layout tabs. */
export class DeckSectionStatisticsCache {
  private metadata: readonly Card[] | undefined;
  private byName = new Map<string, Card>();
  private results = new Map<string, { signature: string; statistics: DeckSectionStatistics }>();

  retainAreaIds(ids: ReadonlySet<string>): void {
    for (const id of this.results.keys()) {
      if (!ids.has(id)) this.results.delete(id);
    }
  }

  get(area: CanvasArea, metadata: readonly Card[]): DeckSectionStatistics {
    if (metadata !== this.metadata) {
      this.metadata = metadata;
      this.byName = new Map(metadata.map(card => [card.name, card]));
      this.results.clear();
    }

    const variant = area.deckVariants?.find(entry => entry.id === area.activeDeckVariantId) ?? area.deckVariants?.[0];
    const activeIds = variant ? new Set(variant.activeCardIds) : null;
    const names: string[] = [];
    const avatarNames = new Set<string>();
    let collectionCount = 0;
    if (area.type === 'deck') {
      const includeAvatar = (card: Card | undefined) => {
        if (card && isAvatarType(card.guardian.type) && isDeckSynergySource(card.name)) avatarNames.add(card.name);
      };
      if (area.avatarCardName) includeAvatar(this.byName.get(area.avatarCardName));
      for (const instance of area.cards) {
        if (instance.board === 'avatar') {
          if (!area.avatarCardName) includeAvatar(this.byName.get(instance.cardName));
          continue;
        }
        const board = normalizeDeckBoard(instance.board);
        if (board === 'collection') collectionCount++;
        if (board !== 'mainboard' || (activeIds && !activeIds.has(instance.id))) continue;
        const card = this.byName.get(instance.cardName);
        if (!card || !isAvatarType(card.guardian.type)) names.push(instance.cardName);
        else if (!area.avatarCardName) includeAvatar(card);
      }
    }
    const sortedAvatars = [...avatarNames].sort();
    const signature = JSON.stringify([names.sort(), sortedAvatars, collectionCount]);
    const previous = this.results.get(area.id);
    if (previous?.signature === signature) return previous.statistics;

    const spells: Card[] = [];
    const sites: Card[] = [];
    let unknownCount = 0;
    for (const name of names) {
      const card = this.byName.get(name);
      if (!card?.guardian.type) unknownCount++;
      else if (isSiteType(card.guardian.type)) sites.push(card);
      else spells.push(card);
    }
    const avatars = sortedAvatars.flatMap(name => {
      const card = this.byName.get(name);
      return card ? [card] : [];
    });
    const statistics = summarize(spells, sites, avatars, collectionCount, unknownCount);
    this.results.set(area.id, { signature, statistics });
    return statistics;
  }
}
