import { describe, expect, it } from 'vitest';
import type { CanvasLabel } from '@/data/dataModels';
import type { CanvasArea } from './canvasAreas';
import { applyDeckLayoutProfile, normalizeDeckLayoutProfiles, saveDeckLayoutProfile } from './deckLayoutProfiles';
import { appReducer, initialAppState } from '@/app/AppState';
import { createGuestUserData } from '@/data/dataModels';

function fixture(): {area: CanvasArea; labels: CanvasLabel[]} {
  return {area: {id: 'deck', name: 'Shared contents', type: 'deck', pinned: true,
    bounds: {x: 0, y: 0, width: 800, height: 1000},
    cards: [{id: 'a', cardName: 'Spark', x: 100, y: 200, board: 'mainboard'}],
    deckRegionBounds: {mainboard: {x: 80, y: 140, width: 500, height: 300}},
    deckVariants: [{id: 'v', name: 'Main', activeCardIds: ['a']}]},
    labels: [{id: 'l', text: 'Plan', areaId: 'deck', x: 100, y: 150}]};
}

describe('shared then separate deck layouts', () => {
  it('follows the first editor until the other device type edits, then keeps both arrangements', () => {
    const {area, labels} = fixture();
    saveDeckLayoutProfile(area, labels, 'desktop');
    applyDeckLayoutProfile(area, labels, 'phone');
    expect(area.cards[0]?.x).toBe(100);
    const card = area.cards[0], label = labels[0];
    if (!card || !label) throw new Error('Missing fixture');
    card.x = 430; label.x = 440;
    saveDeckLayoutProfile(area, labels, 'phone');
    applyDeckLayoutProfile(area, labels, 'desktop');
    expect(card.x).toBe(100);
    expect(label.x).toBe(100);
    card.y = 365;
    saveDeckLayoutProfile(area, labels, 'desktop');
    applyDeckLayoutProfile(area, labels, 'phone');
    expect(card.x).toBe(430);
    expect(card.y).toBe(200);
    expect(label.x).toBe(440);
    expect(area.deckVariants).toEqual([{id: 'v', name: 'Main', activeCardIds: ['a']}]);
    expect(area.cards[0]?.board).toBe('mainboard');
  });

  it('keeps additions and deletions shared instead of restoring old contents', () => {
    const {area, labels} = fixture();
    saveDeckLayoutProfile(area, labels, 'phone');
    area.cards = [{id: 'new', cardName: 'Site', x: 600, y: 400, board: 'collection'}];
    applyDeckLayoutProfile(area, labels, 'desktop');
    expect(area.cards).toEqual([{id: 'new', cardName: 'Site', x: 600, y: 400, board: 'collection'}]);
  });

  it.each(['guest', 'account'])('retains both layouts through %s storage normalization', id => {
    const {area, labels} = fixture();
    saveDeckLayoutProfile(area, labels, 'desktop');
    area.bounds.x = -500;
    saveDeckLayoutProfile(area, labels, 'phone');
    const state = appReducer(initialAppState, {type: 'SET_USER_DATA', userData: {
      ...createGuestUserData(id), canvasAreas: [area], canvasLabels: labels,
    }});
    expect(state.userData?.canvasAreas?.[0]?.layoutProfiles).toEqual(area.layoutProfiles);
    expect(state.userData?.canvasAreas?.[0]?.layoutProfiles).not.toBe(area.layoutProfiles);
  });

  it('ignores invalid profiles and non-finite positions', () => {
    expect(normalizeDeckLayoutProfiles({source: 'tablet'})).toBeUndefined();
    const {area, labels} = fixture();
    saveDeckLayoutProfile(area, labels, 'desktop');
    const valid = area.layoutProfiles?.desktop;
    expect(normalizeDeckLayoutProfiles({source: 'desktop', desktop: {...valid, cards: {bad: {x: NaN, y: 1}}}})?.desktop?.cards).toEqual({});
  });
});
