// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardStatisticsPanel } from './CardStatisticsPanel';
import { analyticsResponseFixture } from '@/data/__fixtures__/playSorceryAnalytics';
import { parseAnalyticsSnapshot } from '@/data/playSorceryAnalytics';
import { loadAnalyticsSnapshot, saveAnalyticsSnapshot } from '@/data/playSorceryAnalyticsStorage';

vi.mock('@/data/playSorceryAnalyticsStorage', () => ({ loadAnalyticsSnapshot: vi.fn(), saveAnalyticsSnapshot: vi.fn() }));
vi.mock('@/data/importExport', () => ({ downloadTextFile: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
const cards = [{ name: 'Toolbox' }];

function required<T>(value: T | undefined | null): T {
  if (value == null) throw new Error('Missing test element or fixture');
  return value;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No live requests in analytics tests')));
  vi.mocked(loadAnalyticsSnapshot).mockResolvedValue(null);
  vi.mocked(saveAnalyticsSnapshot).mockResolvedValue();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.resetAllMocks();
});
async function render() {
  await act(async () => root.render(<CardStatisticsPanel cards={cards} filteredCards={cards} />));
}
async function upload(text: string) {
  const input = required(container.querySelector<HTMLInputElement>('input[type="file"]'));
  const file = new File([text], 'cards.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => text });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}

describe('Card statistics import and inspection', () => {
  it('imports locally, retains unmatched rows, exposes all cohorts and never fetches', async () => {
    await render();
    await upload(JSON.stringify(analyticsResponseFixture()));
    expect(saveAnalyticsSnapshot).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('500');
    expect(container.textContent).toContain('1 unmatched card names');
    const toolbox = required([...container.querySelectorAll('tbody button')].find((button) => button.textContent === 'Toolbox'));
    await act(async () => (toolbox as HTMLButtonElement).click());
    const detail = required(container.querySelector('[aria-label="Statistics for Toolbox"]'));
    expect(detail.textContent).toContain('0.0%');
    expect(detail.textContent).toContain('Not reported');
    expect(detail.textContent).toContain('+10.0 percentage points');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the saved snapshot on invalid imports and failed storage writes', async () => {
    vi.mocked(loadAnalyticsSnapshot).mockResolvedValue(parseAnalyticsSnapshot(analyticsResponseFixture()));
    await render();
    await upload('<html>Login</html>');
    expect(saveAnalyticsSnapshot).not.toHaveBeenCalled();
    expect(container.querySelector('tbody')?.textContent).toContain('Toolbox');
    vi.mocked(saveAnalyticsSnapshot).mockRejectedValue(new Error('quota exceeded'));
    const replacement = analyticsResponseFixture(); required(replacement.cards[0]).cardName = 'Replacement';
    await upload(JSON.stringify(replacement));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('previous snapshot has been kept');
    expect(container.querySelector('tbody')?.textContent).toContain('Toolbox');
    expect(container.querySelector('tbody')?.textContent).not.toContain('Replacement');
  });

  it('loads saved data, filters unmatched names and applies the selected sample minimum', async () => {
    vi.mocked(loadAnalyticsSnapshot).mockResolvedValue(parseAnalyticsSnapshot(analyticsResponseFixture()));
    await render();
    const selects = container.querySelectorAll('select');
    const scope = required(selects[2]);
    const metric = required(selects[0]);
    const minimum = required(selects[1]);
    await act(async () => { scope.value = 'unmatched'; scope.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.querySelector('tbody')?.textContent).toContain('Unknown Card');
    expect(container.querySelector('tbody')?.textContent).not.toContain('Toolbox');
    await act(async () => { metric.value = 'openingHand'; metric.dispatchEvent(new Event('change', { bubbles: true })); minimum.value = '100'; minimum.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.textContent).toContain('No cards match these filters.');
    expect(fetch).not.toHaveBeenCalled();
  });
});
