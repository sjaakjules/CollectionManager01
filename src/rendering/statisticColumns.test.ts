import { describe, expect, it } from 'vitest';
import { paginateStatisticColumns } from './statisticColumns';

const columns = ['Minions 34', 'Magic 19', 'Spirits', 'Airborne'].map(id => ({ id,
  rows: [id, '12/6/8/8', '32%/54%', '61%/82%'].map(text => ({ text })) }));
const measure = (text: string) => text.length * 6;

describe('compact statistic columns', () => {
  it('keeps four-line columns beside one another when they fit', () => {
    const pages = paginateStatisticColumns(columns, 400, measure);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.columns.map(column => column.index)).toEqual([0, 1, 2, 3]);
  });
  it('pages all columns without losing a metric or extending beyond the heading strip', () => {
    const pages = paginateStatisticColumns(columns, 160, measure);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap(page => page.columns.map(column => column.index))).toEqual([0, 1, 2, 3]);
    for (const page of pages) for (const column of page.columns) expect(column.x + column.width).toBeLessThanOrEqual(132);
  });
  it('keeps a long column accessible in a narrow single-stack section', () => {
    const pages = paginateStatisticColumns(columns, 50, measure);
    expect(pages).toHaveLength(4);
    expect(pages[0]?.columns[0]?.width).toBe(22);
    expect(paginateStatisticColumns([], 80, measure)).toEqual([]);
  });

  it('does not reserve a hidden pager or squeeze in a legend on a single-column page', () => {
    const one = [{ id: 'long', group: 'composition' as const, rows: [{ text: 'A longer metric heading' }] }];
    const pages = paginateStatisticColumns(one, 130, measure);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.columns[0]).toEqual({ index: 0, x: 0, width: 130 });
    expect(pages[0]?.legends).toEqual([]);
  });

  it('uses one right-hand edge for each shared row legend and separates the two groups', () => {
    const grouped = columns.map((column, index) => ({ ...column, group: index < 2 ? 'composition' as const : 'synergy' as const }));
    const pages = paginateStatisticColumns(grouped, 700, measure);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.legends.map(legend => legend.group)).toEqual(['composition', 'synergy']);
    expect(pages[0]?.separators).toHaveLength(1);
    expect(pages[0]?.columns.map(column => column.index)).toEqual([0, 1, 2, 3]);
  });

  it('keeps the row meaning on every page without repeating it for every category', () => {
    const grouped = columns.map(column => ({ ...column, group: 'composition' as const }));
    const pages = paginateStatisticColumns(grouped, 180, measure);
    expect(pages.flatMap(page => page.columns.map(column => column.index))).toEqual([0, 1, 2, 3]);
    for (const page of pages) {
      expect(page.legends).toHaveLength(1);
      expect(page.columns.every(column => column.x + column.width <= 152)).toBe(true);
    }
  });
});
