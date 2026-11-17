import { describe, expect, it } from 'vitest';
import { appReducer, initialAppState } from './AppState';
import { createGuestUserData } from '@/data/dataModels';
import type { CanvasArea } from '@/canvas/canvasAreas';
import { ensureDeckSectionTabs, saveDeckSectionLayouts } from '@/canvas/deckSectionLayouts';
import { saveDeckLayoutProfile } from '@/canvas/deckLayoutProfiles';
import { required } from '@/utils/required';

describe('card statistics display choices', () => {
  it.each(['Guest', 'Account'])('retains %s saved arrangements, labels, boards and variants through highlighting and reload', name => {
    const user = { ...createGuestUserData('layout-test'), name };
    const area: CanvasArea = {
      id: 'deck', name: 'Saved layouts', type: 'deck', pinned: true,
      bounds: { x: 100, y: 200, width: 1000, height: 1200 },
      cards: [
        { id: 'spell', cardName: 'Toolbox', board: 'mainboard', x: 300, y: 400, labelId: 'role' },
        { id: 'site', cardName: 'Island', board: 'mainboard', x: 300, y: 800 },
        { id: 'collection', cardName: 'Toolbox', board: 'collection', x: 600, y: 800 },
        { id: 'maybe', cardName: 'Island', board: 'maybeboard', x: 600, y: 1100 },
      ],
      deckVariants: [{ id: 'variant', name: 'Variant', activeCardIds: ['spell', 'site'] }], activeDeckVariantId: 'variant',
    };
    const spellbook = ensureDeckSectionTabs(area, 'spellbook');
    spellbook.tabs.push({ id: 'types', name: 'Types', mode: 'custom' }, { id: 'role', name: 'Role', mode: 'custom' });
    spellbook.activeId = 'role';
    const atlas = ensureDeckSectionTabs(area, 'atlas');
    atlas.tabs.push({ id: 'cards', name: 'cards', mode: 'custom' });
    atlas.activeId = 'cards';
    user.canvasLabels = [{ id: 'role', text: 'Draw', areaId: 'deck', board: 'mainboard', x: 300, y: 370,
      deckSectionLayout: { section: 'spellbook', id: 'role' } }];
    saveDeckSectionLayouts(area, user.canvasLabels, 'desktop', card => card === 'Island');
    saveDeckLayoutProfile(area, user.canvasLabels, 'desktop');
    saveDeckLayoutProfile(area, user.canvasLabels, 'phone');
    user.canvasAreas = [area];
    let state = appReducer(initialAppState, { type: 'SET_USER_DATA', userData: user });
    const saved = required(state.userData);
    state = appReducer(state, { type: 'SET_SELECTED_CARD_CATEGORY', categoryId: 'removal' });
    state = appReducer(state, { type: 'SET_CARD_STATISTICS', settings: { highlightEnabled: true, showOverlays: true } });
    state = appReducer(state, { type: 'SET_CARD_STATISTIC_RULE', metric: 'drawnDifference', change: { comparison: 'atMost', threshold: -4 } });
    expect(state.userData?.canvasAreas).toBe(saved.canvasAreas);
    expect(state.userData?.canvasLabels).toBe(saved.canvasLabels);
    state = appReducer(state, { type: 'SET_CANVAS_AREAS', canvasAreas: required(state.userData?.canvasAreas) });
    state = appReducer(initialAppState, { type: 'SET_USER_DATA', userData: JSON.parse(JSON.stringify(state.userData)) });
    expect(state.userData?.canvasAreas).toEqual(saved.canvasAreas);
    expect(state.userData?.canvasLabels).toEqual(saved.canvasLabels);
    expect(state.userData?.gridVersion).toBe(saved.gridVersion);
  });

  it('switches highlight modes while keeping overlay choices and the shared user schema', () => {
    const withUser = appReducer(initialAppState, { type: 'SET_USER_DATA', userData: createGuestUserData('test') });
    const selected = appReducer(withUser, { type: 'SET_SELECTED_CARD_CATEGORY', categoryId: 'removal' });
    const stats = appReducer(selected, { type: 'SET_CARD_STATISTICS', settings: { highlightEnabled: true, showOverlays: true } });
    expect(stats.ui.selectedCardCategory).toBeNull();
    expect(stats.ui.associationsEnabled).toBe(false);
    expect(stats.userData).not.toHaveProperty('cardStatistics');
    const associations = appReducer(stats, { type: 'SET_ASSOCIATIONS_ENABLED', enabled: true });
    expect(associations.ui.cardStatistics).toMatchObject({ highlightEnabled: false, showOverlays: true });
    const category = appReducer(stats, { type: 'SET_SELECTED_CARD_CATEGORY', categoryId: 'removal' });
    expect(category.ui.cardStatistics).toMatchObject({ highlightEnabled: false, showOverlays: true });
    expect(category.ui.cardStatistics.highlightRules).toBe(stats.ui.cardStatistics.highlightRules);

    const edited = appReducer(stats, { type: 'SET_CARD_STATISTIC_RULE', metric: 'drawnDifference', change: { comparison: 'atMost', threshold: -4 } });
    expect(edited.ui.cardStatistics.highlightRules.drawnDifference).toMatchObject({ comparison: 'atMost', threshold: -4 });
    expect(edited.userData).toBe(stats.userData);
  });
});
