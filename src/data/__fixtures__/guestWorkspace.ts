import { createEmptyDeck, createGuestUserData, type UserData } from '../dataModels';
import { createDefaultCatalogueLayout } from '../catalogueLayout';
import type { CanvasArea } from '@/canvas/canvasAreas';
import { ensureDeckSectionTabs, saveDeckSectionLayouts } from '@/canvas/deckSectionLayouts';
import { saveDeckLayoutProfile } from '@/canvas/deckLayoutProfiles';

/** A whole guest workspace, with independent memberships, variants and layouts. */
export function guestWorkspaceFixture(): UserData {
  const user = createGuestUserData('guest-workspace');
  const deck = createEmptyDeck('Saved deck', 'deck-user');
  deck.origin = 'user';
  deck.boards.mainboard = [{ name: 'Toolbox', quantity: 2 }, { name: 'Island', quantity: 1 }];
  deck.boards.collection = [{ name: 'Toolbox', quantity: 1 }];
  deck.boards.maybeboard = [{ name: 'Island', quantity: 1 }];
  user.decks = [deck];
  user.removedDecks = { removed: '2026-11-01T10:00:00.000Z' };
  user.collection = [{ name: 'Toolbox', quantity: 4 }];
  user.favouriteDeckIds = [deck.id];
  user.selectedCardCategory = 'draw';
  user.cardCategories = { version: 'test', categories: [{ id: 'draw', name: 'Draw', tooltip: 'Draw', description: 'Draw cards', base: true }], scores: { Toolbox: { draw: .75 } } };
  user.catalogueLayout = createDefaultCatalogueLayout();
  user.interactionEffects = { intensity: 'off', lettering: 'none' };
  const area: CanvasArea = {
    id: 'deck-area', deckId: deck.id, name: deck.name, type: 'deck', pinned: true,
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
  spellbook.tabs.push({ id: 'cost', name: 'Cost', mode: 'custom' }, { id: 'role', name: 'Role', mode: 'custom' });
  spellbook.activeId = 'role';
  const atlas = ensureDeckSectionTabs(area, 'atlas');
  atlas.tabs.push({ id: 'cards', name: 'Cards', mode: 'custom' });
  atlas.activeId = 'cards';
  user.canvasLabels = [{ id: 'role', text: 'Draw', areaId: area.id, board: 'mainboard', x: 300, y: 370,
    deckSectionLayout: { section: 'spellbook', id: 'role' } }];
  saveDeckSectionLayouts(area, user.canvasLabels, 'desktop', card => card === 'Island');
  saveDeckLayoutProfile(area, user.canvasLabels, 'desktop');
  saveDeckLayoutProfile(area, user.canvasLabels, 'phone');
  user.canvasAreas = [area, {
    id: 'stack', name: 'Ideas', type: 'stack', pinned: true,
    bounds: { x: -1200, y: 300, width: 400, height: 500 },
    cards: [{ id: 'stack-card', cardName: 'Island', board: null, x: -1000, y: 400 }],
  }];
  return user;
}
