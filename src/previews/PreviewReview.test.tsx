// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewReview } from './PreviewReview';

let element: HTMLDivElement;
let root: Root;
const getInput = (card: string, field: string) => {
  const input = element.querySelector(`[data-card="${card}"] [name="${field}"]`);
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
    throw new Error(`Missing ${field} field for ${card}`);
  }
  return input;
};

async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) throw new Error('Missing input value setter');
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
    { name: 'The White Death', guardian: { type: 'Minion', cost: 2, attack: 2, rulesText: 'Ranged 3, Stealth' }, sets: [] },
  ]))));
  localStorage.clear();
  element = document.createElement('div');
  document.body.append(element);
  root = createRoot(element);
});

afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('preview gallery review', () => {
  it('fills the original metadata, syncs Treasure variants, and saves drafts across a reload', async () => {
    await act(async () => root.render(<PreviewReview editable />));
    expect(element.querySelectorAll('figure')).toHaveLength(51);
    expect(getInput('Don Quixote', 'power').value).toBe('3/2');
    expect(getInput('Gashadokuro', 'power').value).toBe('0');
    expect(getInput('The White Death', 'cost').value).toBe('2');

    await type(getInput('Chosen One', 'name'), 'Chosen One Reviewed');
    await type(getInput('Treasure', 'rulesText'), 'Reviewed first line.\nReviewed second line.');
    const treasures = element.querySelectorAll<HTMLTextAreaElement>('[data-card="Treasure"] [name="rulesText"]');
    expect(treasures).toHaveLength(8);
    expect(Array.from(treasures, (input) => input.value)).toEqual(Array(8).fill('Reviewed first line.\nReviewed second line.'));
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(element.querySelector('[role="status"]')?.textContent).toBe('2 edited cards saved');

    await act(async () => root.unmount());
    root = createRoot(element);
    await act(async () => root.render(<PreviewReview editable />));
    expect(getInput('Chosen One', 'name').value).toBe('Chosen One Reviewed');
    expect(getInput('Treasure', 'rulesText').value).toContain('Reviewed second line.');
    await type(getInput('Chosen One', 'name'), 'Chosen One');
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(element.querySelector('[role="status"]')?.textContent).toBe('1 edited card saved');
  });

  it('presents catalogue details without edit controls or old drafts when closed', async () => {
    localStorage.setItem('sorcerystacks:baldassare-preview-review:v1:Chosen%20One:name', 'Draft-only title');
    await act(async () => root.render(<PreviewReview editable={false} />));
    expect(element.querySelectorAll('figure')).toHaveLength(51);
    expect(element.querySelector('input, textarea, button')).toBeNull();
    expect(element.querySelector('[data-card="Chosen One"] h2')?.textContent).toBe('Chosen One');
    expect(element.textContent).not.toContain('Draft-only title');
  });
});
