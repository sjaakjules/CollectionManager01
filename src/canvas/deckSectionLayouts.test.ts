import { describe, expect, it } from 'vitest';
import { appReducer, initialAppState } from '@/app/AppState';
import { createSpellbookLayout, type CatalogueLayoutConfig } from '@/data/catalogueLayout';
import { createGuestUserData, type CanvasLabel, type UserData } from '@/data/dataModels';
import { required } from '@/utils/required';
import type { CanvasArea } from './canvasAreas';
import { applyDeckLayoutProfile, saveDeckLayoutProfile } from './deckLayoutProfiles';
import { applyDeckSectionTab, ensureDeckSectionTabs, getDeckSectionTabLayout, getDeckSectionTabMode, inheritDeckSectionTabPosition, normalizeDeckSectionLayouts,
  restoreDeckSectionPositions, saveDeckSectionLayouts, scopeDeckLayoutLabels, seedDefaultSectionPositions,
  translateDeckSectionTabs, visibleDeckLayoutLabels } from './deckSectionLayouts';

const isLandscape = (name: string) => name === 'Site';
const regions = {
  spellbook: { x: 0, y: 0, width: 350, height: 325 },
  atlas: { x: 0, y: 350, width: 350, height: 300 },
};
function fixture() {
  const area: CanvasArea = { id: 'deck', name: 'Deck', pinned: true, type: 'deck',
    bounds: { x: 0, y: -250, width: 800, height: 1400 }, deckRegionBounds: regions,
    cards: [
      { id: 'spell', cardName: 'Spell', board: 'mainboard', x: 5, y: 67.5, labelId: 'spells' },
      { id: 'site', cardName: 'Site', board: 'mainboard', x: 12.5, y: 445, labelId: 'sites' },
      { id: 'maybe', cardName: 'Site', board: 'maybeboard', x: 12.5, y: 900, labelId: 'maybe' },
      { id: 'collection', cardName: 'Spell', board: 'collection', x: 5, y: 1067.5 },
    ], deckVariants: [{ id: 'variant', name: 'Variant', activeCardIds: ['spell', 'site'] }],
    activeDeckVariantId: 'variant' };
  const labels: CanvasLabel[] = [
    { id: 'spells', text: 'Spells', x: 5, y: 40, areaId: area.id, board: 'mainboard' },
    { id: 'sites', text: 'Sites', x: 12.5, y: 410, areaId: area.id, board: 'mainboard' },
    { id: 'maybe', text: 'Maybe group', x: 5, y: 865, areaId: area.id, board: 'maybeboard' },
  ];
  const spellbook = ensureDeckSectionTabs(area, 'spellbook');
  const atlas = ensureDeckSectionTabs(area, 'atlas');
  scopeDeckLayoutLabels(area, labels, regions, isLandscape);
  saveDeckSectionLayouts(area, labels, 'desktop', isLandscape);
  const custom = { id: 'openers', name: 'Openers' };
  atlas.tabs.push(custom);
  return { area, labels, spellbook, atlas, custom };
}

describe('named deck section layouts', () => {
  it('restores independent card positions and label memberships without altering the deck or variants', () => {
    const { area, labels, atlas, custom } = fixture();
    const before = structuredClone(area.cards);
    const site = required(area.cards[1]);
    const variants = structuredClone(area.deckVariants);
    applyDeckSectionTab(area, labels, 'atlas', custom, 'desktop', isLandscape);
    expect(visibleDeckLayoutLabels(labels, [area]).map(label => label.id)).toEqual(['spells', 'maybe']);
    expect(site.labelId).toBeUndefined();
    site.x += 165;
    site.labelId = 'water';
    labels.push({ id: 'water', text: 'Water sites', x: 175, y: 411, areaId: area.id, board: 'mainboard' });
    scopeDeckLayoutLabels(area, labels, regions, isLandscape);
    saveDeckSectionLayouts(area, labels, 'desktop', isLandscape);
    applyDeckSectionTab(area, labels, 'atlas', required(atlas.tabs[0]), 'desktop', isLandscape);
    expect(area.cards).toEqual(before);
    expect(visibleDeckLayoutLabels(labels, [area]).map(label => label.id)).toEqual(['spells', 'sites', 'maybe']);
    applyDeckSectionTab(area, labels, 'atlas', custom, 'desktop', isLandscape);
    expect(site).toMatchObject({ x: 177.5, labelId: 'water' });
    expect(visibleDeckLayoutLabels(labels, [area]).map(label => label.id)).toEqual(['spells', 'maybe', 'water']);
    expect(area.deckVariants).toEqual(variants);
    expect(area.cards.map(({ id, cardName, board }) => ({ id, cardName, board })))
      .toEqual(before.map(({ id, cardName, board }) => ({ id, cardName, board })));
  });

  it('forgets removed and transferred cards across every tab, even when the same ID returns', () => {
    const { area, labels, atlas, custom } = fixture();
    const site = required(area.cards[1]);
    applyDeckSectionTab(area, labels, 'atlas', custom, 'desktop', isLandscape);
    saveDeckSectionLayouts(area, labels, 'desktop', isLandscape);
    site.board = 'collection';
    saveDeckSectionLayouts(area, labels, 'desktop', isLandscape);
    site.board = 'mainboard';
    site.x = 815;
    expect(applyDeckSectionTab(area, labels, 'atlas', required(atlas.tabs[0]), 'desktop', isLandscape)).toEqual([site]);
    expect(site).toMatchObject({ x: 815 });
    expect(site.labelId).toBeUndefined();
    expect(applyDeckSectionTab(area, labels, 'atlas', custom, 'desktop', isLandscape)).toEqual([site]);
  });

  it('keeps legacy mixed groups visible and does not reassign their members', () => {
    const { area, labels, atlas, custom } = fixture();
    const spell = required(area.cards[0]);
    const site = required(area.cards[1]);
    spell.labelId = 'sites';
    scopeDeckLayoutLabels(area, labels, regions, isLandscape);
    saveDeckSectionLayouts(area, labels, 'desktop', isLandscape);
    applyDeckSectionTab(area, labels, 'atlas', custom, 'desktop', isLandscape);
    expect(visibleDeckLayoutLabels(labels, [area]).some(label => label.id === 'sites')).toBe(true);
    expect(site.labelId).toBe('sites');
    expect(spell.labelId).toBe('sites');
    expect(required(atlas.tabs[0]).cardLabels).toEqual({});
  });

  it('keeps old device layouts and moves archived tabs with a section only on the editing device', () => {
    const { area, labels, atlas, custom } = fixture();
    const site = required(area.cards[1]);
    const defaultTab = required(atlas.tabs[0]);
    saveDeckLayoutProfile(area, labels, 'desktop');
    site.x = 287.5;
    saveDeckLayoutProfile(area, labels, 'phone');
    applyDeckLayoutProfile(area, labels, 'desktop');
    delete defaultTab.positions;
    seedDefaultSectionPositions(area, 'atlas', labels, 'desktop', isLandscape);
    saveDeckSectionLayouts(area, labels, 'desktop', isLandscape);
    applyDeckSectionTab(area, labels, 'atlas', custom, 'desktop', isLandscape);
    site.x = 177.5;
    saveDeckSectionLayouts(area, labels, 'desktop', isLandscape);
    applyDeckLayoutProfile(area, labels, 'phone');
    restoreDeckSectionPositions(area, labels, 'phone', isLandscape);
    expect(site.x).toBe(177.5); // Phone inherits the new tab even though it had a previous Default position.
    translateDeckSectionTabs(area, 'atlas', 'phone', { x: 55, y: 110 });
    applyDeckSectionTab(area, labels, 'atlas', defaultTab, 'phone', isLandscape);
    expect(site).toMatchObject({ x: 342.5, y: 555 });
    applyDeckSectionTab(area, labels, 'atlas', defaultTab, 'desktop', isLandscape);
    expect(site).toMatchObject({ x: 12.5, y: 445 });
    applyDeckSectionTab(area, labels, 'atlas', custom, 'phone', isLandscape);
    expect(site).toMatchObject({ x: 232.5, y: 555 });
  });

  it('puts duplicates on the matching stack in a saved tab', () => {
    const { area, labels, atlas, custom } = fixture();
    const site = required(area.cards[1]);
    applyDeckSectionTab(area, labels, 'atlas', custom, 'desktop', isLandscape);
    site.x += 165;
    area.cards.push({ ...site, id: 'copy' });
    inheritDeckSectionTabPosition(area, site.id, 'copy');
    saveDeckSectionLayouts(area, labels, 'desktop', isLandscape);
    applyDeckSectionTab(area, labels, 'atlas', required(atlas.tabs[0]), 'desktop', isLandscape);
    const copy = area.cards.find(card => card.id === 'copy');
    expect(copy).toMatchObject({ x: site.x, y: site.y, labelId: 'sites' });
  });

  it('restores a valid tab and label reference through a shared-schema JSON load', () => {
    const { area, labels, atlas, custom } = fixture();
    atlas.activeId = custom.id;
    const serialized = JSON.stringify({ ...createGuestUserData('guest'), canvasAreas: [area], canvasLabels: labels });
    const state = appReducer(initialAppState, { type: 'SET_USER_DATA', userData: JSON.parse(serialized) as UserData });
    expect(state.userData?.canvasAreas?.[0]?.sectionLayouts?.atlas?.activeId).toBe('openers');
    expect(state.userData?.canvasLabels?.find(label => label.id === 'sites')?.deckSectionLayout)
      .toEqual({ section: 'atlas', id: 'default' });
    expect(normalizeDeckSectionLayouts({ atlas: { activeId: 'missing', tabs: [{ id: 'a', name: ' ' }] } })?.atlas)
      .toEqual({ activeId: 'default', tabs: [{ id: 'default', name: 'Default' }] });
  });

  it('loads saved automatic and custom tab modes and deep-clones layout steps', () => {
    const { area, labels, spellbook, atlas } = fixture();
    const editedLayout: CatalogueLayoutConfig = { columns: 8, columnMode: 'limit', steps: [
      { field: 'set', mode: 'group', direction: 'desc', axis: 'horizontal' },
      { field: 'name', mode: 'sort', direction: 'asc', axis: 'vertical' },
    ] };
    const cost = required(spellbook.tabs.find(tab => tab.id === 'cost'));
    expect(getDeckSectionTabMode(cost)).toBe('automatic');
    expect(getDeckSectionTabLayout(cost)).toEqual(createSpellbookLayout('cost'));
    cost.mode = 'custom';
    cost.layout = editedLayout;
    atlas.tabs.push({ id: 'release', name: 'Release', mode: 'automatic', layout: editedLayout });
    atlas.activeId = 'release';

    const clone = normalizeDeckSectionLayouts(area.sectionLayouts);
    const clonedCost = required(clone?.spellbook?.tabs.find(tab => tab.id === 'cost'));
    required(clonedCost.layout?.steps[0]).direction = 'asc';
    expect(editedLayout.steps[0]?.direction).toBe('desc');

    const data = JSON.stringify({ ...createGuestUserData('guest'), canvasAreas: [area], canvasLabels: labels });
    const state = appReducer(initialAppState, { type: 'SET_USER_DATA', userData: JSON.parse(data) as UserData });
    const restored = required(state.userData?.canvasAreas?.[0]);
    const restoredCost = required(restored.sectionLayouts?.spellbook?.tabs.find(tab => tab.id === 'cost'));
    const restoredRelease = required(restored.sectionLayouts?.atlas?.tabs.find(tab => tab.id === 'release'));
    expect(getDeckSectionTabMode(restoredCost)).toBe('custom');
    expect(getDeckSectionTabMode(restoredRelease)).toBe('automatic');
    expect(getDeckSectionTabLayout(restoredCost)).toEqual(editedLayout);
    expect(getDeckSectionTabLayout(restoredRelease)).toEqual(editedLayout);
    expect(restored.sectionLayouts?.atlas?.activeId).toBe('release');
    expect(restored.cards).toEqual(area.cards);
  });
});
