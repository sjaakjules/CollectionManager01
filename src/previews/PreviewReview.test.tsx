// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewReview } from './PreviewReview';

let element: HTMLDivElement;
let root: Root;
const getInput = (field: string) => {
  const input = element.querySelector(`dialog[open] [name="${field}"]`);
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
    throw new Error(`Missing ${field} field in card details`);
  }
  return input;
};

async function click(selector: string) {
  const target = element.querySelector(selector);
  if (!(target instanceof HTMLButtonElement)) throw new Error(`Missing button ${selector}`);
  await act(async () => target.click());
}

const open = (card: string) => click(`[data-card="${card}"] .review-title button`);
const close = () => click('.review-dialog-close');

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
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
  }
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
    { name: 'The White Death', guardian: { type: 'Minion', cost: 2, attack: 2, rulesText: 'Ranged 3, Stealth' },
      sets: [{ name: 'Frost Mage Vs. Lavamancer', variants: [] }] },
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
  it('offers selectable transcriptions beside the footage and exempts official duel deck artwork', async () => {
    await act(async () => root.render(<PreviewReview editable />));
    expect(element.querySelector('[data-card="The White Death"] .review-preview-watermark')).toBeNull();
    expect(element.querySelector('[data-card="Sing-song Siren"] .review-preview-watermark')?.textContent).toBe('Preview');

    await open('Sing-song Siren');
    await click('dialog [aria-label="Next frame"]');
    const frame = element.querySelector<HTMLImageElement>('dialog img')?.src;
    await click('dialog button[aria-pressed="false"]');
    expect(element.querySelector('dialog .review-text-source')?.textContent).toMatch(/Trailer transcription.*Needs confirmation.*ability text/u);
    expect(element.querySelector('dialog .review-readable-rules')?.textContent).toBe('Submerge');
    expect(element.querySelector('dialog textarea')).toBeNull();
    expect(element.querySelector<HTMLImageElement>('dialog img')?.src).toBe(frame);
    await click('dialog button[aria-pressed="false"]');
    expect(getInput('rulesText').value).toBe('Submerge');

    await close();
    await open('The White Death');
    await click('dialog button[aria-pressed="false"]');
    expect(element.querySelector('dialog .review-preview-watermark')).toBeNull();
    expect(element.querySelector('dialog .review-text-source')?.textContent).toContain('Official catalogue text');
    expect(element.querySelector('dialog .review-readable-rules')?.textContent).toBe('Ranged 3, Stealth');
  });

  it('steps through consecutive source frames in the enlarged editor', async () => {
    await act(async () => root.render(<PreviewReview editable />));
    await open('Unidentified Avatar (BT trailer)');
    const slider = element.querySelector<HTMLInputElement>('dialog input[type="range"]');
    expect(Number(slider?.max)).toBeGreaterThanOrEqual(60);
    expect(element.querySelector<HTMLImageElement>('dialog img')?.src).toContain('/Cards/unidentified_avatar_bt_trailer.webp');
    await click('dialog [aria-label="Next frame"]');
    expect(slider?.value).toBe('1');
    expect(element.querySelector<HTMLImageElement>('dialog img')?.src).toContain('/unidentified_avatar_bt_trailer/891.webp');
    await click('dialog [aria-label="Next frame"]');
    expect(slider?.value).toBe('2');
    expect(element.querySelector<HTMLImageElement>('dialog img')?.src).toContain('/unidentified_avatar_bt_trailer/892.webp');
    await click('dialog [aria-label="Previous frame"]');
    await click('dialog [aria-label="Previous frame"]');
    expect(slider?.value).toBe('0');
    expect(element.querySelector<HTMLImageElement>('dialog img')?.src).toContain('/Cards/unidentified_avatar_bt_trailer.webp');
    expect(getInput('name').value).toBe('Unidentified Avatar (BT trailer)');
  });

  it('groups the read-only gallery and opens the full printed details', async () => {
    await act(async () => root.render(<PreviewReview editable />));
    expect(element.querySelectorAll('figure')).toHaveLength(54);
    expect(element.querySelector('main input, main textarea')).toBeNull();
    expect(Array.from(element.querySelectorAll('main h2'), (heading) => heading.textContent))
      .toEqual(['Minions', 'Magic and other spells', 'Sites', 'Avatars']);
    expect(element.querySelector('[aria-label="Minions"] [data-card="The White Death"]')).toBeTruthy();
    expect(element.querySelector('[aria-label="Minions"] [data-card="Giant Pelican"]')).toBeTruthy();
    expect(element.querySelector('[aria-label="Magic and other spells"] [data-card="Treasure Map"]')).toBeTruthy();
    await open('Don Quixote');
    expect(getInput('power').value).toBe('3/2');
    await close();
    await open('Gashadokuro');
    expect(getInput('power').value).toBe('0');
    await close();
    await open('The White Death');
    expect(getInput('cost').value).toBe('2');
    await close();
    await open('Chosen One');
    expect(getInput('earth').value).toBe('2');
    expect(getInput('type').value).toBe('Magic');
    expect(getInput('typeText').value).toBe('A higher power intervenes by Unique Magic');
  });

  it('syncs Treasure illustrations and restores saved fields in the card details', async () => {
    const oldDraft = 'sorcerystacks:baldassare-preview-review:v1:Chosen%20One:name';
    localStorage.setItem(oldDraft, 'Existing draft');
    await act(async () => root.render(<PreviewReview editable />));
    await open('Chosen One');
    expect(getInput('name').value).toBe('Existing draft');
    await type(getInput('name'), 'Chosen One Reviewed');
    await type(getInput('earth'), '3');
    await type(getInput('typeText'), 'Reviewed type line');
    await close();
    expect(element.querySelector('[data-card="Chosen One"] h3')?.textContent).toBe('Chosen One Reviewed');
    await open('Treasure');
    await type(getInput('rulesText'), 'Reviewed first line.\nReviewed second line.');
    await close();
    const treasures = element.querySelectorAll('[data-card="Treasure"] .review-effect');
    expect(treasures).toHaveLength(8);
    expect(Array.from(treasures, (caption) => caption.textContent)).toEqual(Array(8).fill('Reviewed first line.\nReviewed second line.'));
    expect(element.querySelector('[role="status"]')?.textContent).toBe('2 edited cards saved');

    await act(async () => root.unmount());
    root = createRoot(element);
    await act(async () => root.render(<PreviewReview editable />));
    await open('Treasure');
    expect(getInput('rulesText').value).toContain('Reviewed second line.');
    await close();
    await open('Chosen One');
    expect(getInput('name').value).toBe('Chosen One Reviewed');
    expect(getInput('earth').value).toBe('3');
    expect(getInput('typeText').value).toBe('Reviewed type line');
    await type(getInput('name'), 'Chosen One');
    await type(getInput('earth'), '2');
    await type(getInput('typeText'), 'A higher power intervenes by Unique Magic');
    await close();
    expect(element.querySelector('[role="status"]')?.textContent).toBe('1 edited card saved');
  });

  it('presents catalogue details without edit controls or old drafts when closed', async () => {
    localStorage.setItem('sorcerystacks:baldassare-preview-review:v1:Chosen%20One:name', 'Draft-only title');
    await act(async () => root.render(<PreviewReview editable={false} />));
    expect(element.querySelectorAll('figure')).toHaveLength(54);
    expect(element.querySelector('input, textarea, .review-toolbar')).toBeNull();
    expect(element.querySelectorAll('button.review-art')).toHaveLength(54);
    expect(element.querySelector('[data-card="Chosen One"] h3')?.textContent).toBe('Chosen One');
    await open('Chosen One');
    expect(element.querySelector('dialog[open] .review-fields')?.textContent).toContain('Unique Magic');
    expect(element.querySelector('dialog input, dialog textarea')).toBeNull();
    expect(element.textContent).not.toContain('Draft-only title');
  });
});
