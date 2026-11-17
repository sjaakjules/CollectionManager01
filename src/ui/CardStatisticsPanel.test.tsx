// @vitest-environment jsdom
import { act, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext, appReducer, initialAppState } from '@/app/AppState';
import { cardStatisticsFixture } from '@/data/__fixtures__/cardStatistics';
import { DEFAULT_CARD_STATISTICS_SETTINGS } from '@/data/cardStatisticHighlights';
import { required } from '@/utils/required';
import { useCardStatistics } from './useCardStatistics';
import { CardStatisticsPanel } from './CardStatisticsPanel';
import { CardStatisticsHover } from './CardStatisticsHover';

vi.mock('./useCardStatistics', () => ({ useCardStatistics: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
const cards = [{ name: 'Toolbox' }, { name: 'Missing' }];
function Harness() {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  return <AppContext.Provider value={{ state, dispatch }}><CardStatisticsPanel cards={cards} filteredCards={cards} /></AppContext.Provider>;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(useCardStatistics).mockReturnValue({ asset: cardStatisticsFixture(), loading: false });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.resetAllMocks();
});
async function render() { await act(async () => root.render(<Harness />)); }
function input(label: string) {
  return required(container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
    ?? [...container.querySelectorAll('label')].find(node => node.textContent?.trim() === label)?.querySelector('input'));
}
async function click(label: string) { await act(async () => input(label).click()); }
async function select(label: string, value: string) {
  const element = required(container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)
    ?? [...container.querySelectorAll('label')].find(node => node.firstChild?.textContent?.trim() === label)?.querySelector('select'));
  await act(async () => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function number(label: string, value: string) {
  const element = input(label);
  const setter = required(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set);
  await act(async () => {
    element.focus();
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => element.blur());
}
const ruleRow = (label: string) => required(input(`Highlight ${label}`).closest('tr'));
const matches = (label: string) => ruleRow(label).querySelector('.card-stats-rule-count')?.textContent;

describe('published statistics controls', () => {
  it('shows source coverage without the previous browser import workflow', async () => {
    await render();
    expect(container.textContent).toContain('2026-10-31');
    expect(container.textContent).toContain('1 unmatched source names');
    expect(container.textContent).toContain('Unknown Card');
    expect(container.querySelector('input[type=file]')).toBeNull();
    expect(container.textContent).not.toContain('Import JSON');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(8);
  });
  it('adjusts several independent rules and shades while counting each matched card once', async () => {
    await render();
    await click('Highlight cards');
    await click('Highlight In-deck win rate');
    await select('Drawn difference comparison', 'atMost');
    await number('Drawn difference cutoff (pp)', '-10');
    expect(matches('In-deck win rate')).toBe('1');
    expect(matches('Drawn difference')).toBe('1');
    expect(container.querySelector('.card-stats-match-count')?.textContent).toContain('1 of 2 catalogue cards highlighted');
    expect(ruleRow('Drawn difference').querySelector('.card-stats-scale-values')?.textContent).toBe('-18.0 pp-10.0 pp');
    await number('Drawn difference scale end (pp)', '-25');
    expect(ruleRow('Drawn difference').querySelector('.card-stats-scale-values')?.textContent).toBe('-25.0 pp-10.0 pp');
    const bar = required(ruleRow('Drawn difference').querySelector<HTMLElement>('.card-stats-scale-bar'));
    expect(bar.style.background).toContain('33.33%');
    await select('Shading', 'smooth');
    expect(bar.style.background).toContain('linear-gradient');
    expect(bar.style.background).not.toContain('33.33%');
    await number('In-deck win rate minimum player-games', '201');
    expect(matches('In-deck win rate')).toBe('0');
    expect(matches('Drawn difference')).toBe('1');
    await click('Highlight Drawn difference');
    expect(container.querySelector('.card-stats-match-count')?.textContent).toContain('0 of 2');
    await click('Highlight Played win rate');
    await select('Played win rate comparison', 'atMost');
    await number('Played win rate cutoff (%)', '0');
    await number('Played win rate minimum player-games', '100');
    expect(container.querySelector('.card-stats-match-count')?.textContent).toContain('1 of 2');
  });
  it('limits on-card values to three and lets the visitor change which values appear', async () => {
    await render();
    expect(container.querySelector('.card-stats-metrics')).toBeNull();
    await click('Show statistics on cards');
    expect(input('Played win rate').disabled).toBe(true);
    await click('Deck share');
    expect(input('Played win rate').disabled).toBe(false);
    await click('Played win rate');
    expect(input('Played win rate').checked).toBe(true);
    expect(input('Deck share').disabled).toBe(true);
    await click('Show statistics beside the hover preview');
    expect(input('Show statistics beside the hover preview').checked).toBe(false);
  });
  it('disables unavailable data without prompting for login or file uploads', async () => {
    vi.mocked(useCardStatistics).mockReturnValue({ asset: null, loading: false });
    await render();
    expect(container.textContent).toContain('aren’t available');
    expect([...container.querySelectorAll('fieldset')].every(node => node.disabled)).toBe(true);
  });
  it('shows exact hover samples, unavailable values and signed differences', async () => {
    const asset = cardStatisticsFixture();
    const defaults = DEFAULT_CARD_STATISTICS_SETTINGS.highlightRules;
    const rules = { ...defaults, played: { ...defaults.played, minimumGames: 150 } };
    await act(async () => root.render(<CardStatisticsHover name="Toolbox" stats={asset.cards.Toolbox}
      releasedThrough={asset.releasedThrough} rules={rules} outlines={[{ metric: 'inDeck', colour: 0xffb05a }]} />));
    expect(container.textContent).toContain('0.0%');
    expect(container.textContent).toContain('-10.0 pp');
    expect(container.textContent).toContain('Not reported');
    expect(container.textContent).toContain('n 100 · small sample');
    expect(container.querySelectorAll('.low-sample')).toHaveLength(1);
    expect(container.querySelector('[aria-label="Highlighted"]')?.parentElement?.textContent).toBe('In-deck win rate');
    expect(container.textContent).not.toContain('NaN');
  });
});
