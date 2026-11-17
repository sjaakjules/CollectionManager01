import type { DeckStatisticColumn } from '@/canvas/deckSectionStatistics';

export const STATISTIC_COLUMN_GAP = 16;
export const STATISTIC_PAGE_CONTROL_WIDTH = 28;

export interface StatisticColumnPage {
  columns: Array<{ index: number; x: number; width: number }>;
  legends: Array<{ group: 'composition' | 'synergy'; x: number; width: number }>;
  separators: number[];
}

export const STATISTIC_ROW_LABELS = {
  composition: ['Elements', 'Rarity', 'Mana'],
  synergy: ['Count', 'Share', 'Draw'],
} as const;

/** Keep complete four-line columns together; narrow sections page horizontally. */
export function paginateStatisticColumns(columns: readonly DeckStatisticColumn[], width: number,
  measure: (text: string, heading: boolean) => number): StatisticColumnPage[] {
  if (!columns.length || width <= 0) return [];
  const widths = columns.map(column => Math.ceil(Math.max(0,
    ...column.rows.map((row, index) => measure(row.text, index === 0 || row.bold === true)))));
  const legendWidths = {
    composition: Math.ceil(Math.max(...STATISTIC_ROW_LABELS.composition.map(label => measure(label, false)))),
    synergy: Math.ceil(Math.max(...STATISTIC_ROW_LABELS.synergy.map(label => measure(label, false)))),
  };
  let total = widths.reduce((sum, value) => sum + value, 0) + Math.max(0, widths.length - 1) * STATISTIC_COLUMN_GAP;
  let lastGroup: DeckStatisticColumn['group'];
  for (const column of columns) {
    if (column.group && column.group !== lastGroup) total += legendWidths[column.group] + STATISTIC_COLUMN_GAP;
    lastGroup = column.group;
  }
  const available = Math.max(1, width - (columns.length > 1 && total > width ? STATISTIC_PAGE_CONTROL_WIDTH : 0));
  const pages: StatisticColumnPage[] = [];
  let page: StatisticColumnPage = { columns: [], legends: [], separators: [] };
  let x = 0;
  lastGroup = undefined;
  widths.forEach((natural, index) => {
    const group = columns[index]?.group;
    const newGroup = () => group !== undefined && group !== lastGroup;
    const legendSpace = () => newGroup() && group ? legendWidths[group] + STATISTIC_COLUMN_GAP : 0;
    if (page.columns.length && x + legendSpace() + natural > available) {
      pages.push(page);
      page = { columns: [], legends: [], separators: [] };
      x = 0;
      lastGroup = undefined;
    }
    if (newGroup() && group) {
      if (page.columns.length) page.separators.push(x - STATISTIC_COLUMN_GAP / 2);
      // On very narrow pages keep the figures readable. Every cell still has
      // its explanatory tooltip; a squashed or zero-width legend adds no help.
      const legendWidth = legendWidths[group];
      if (available - x - legendWidth - STATISTIC_COLUMN_GAP >= Math.min(natural, 72)) {
        page.legends.push({ group, x, width: legendWidth });
        x += legendWidth + STATISTIC_COLUMN_GAP;
      }
    }
    const columnWidth = Math.max(1, Math.min(natural, available - x));
    page.columns.push({ index, x, width: columnWidth });
    x += columnWidth + STATISTIC_COLUMN_GAP;
    lastGroup = group;
  });
  if (page.columns.length) pages.push(page);
  return pages;
}
