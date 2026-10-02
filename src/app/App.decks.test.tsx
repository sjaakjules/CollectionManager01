// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppAction } from './AppState';
import type { CanvasArea } from '@/canvas/canvasAreas';
import type { DecksPanel } from '@/ui/DecksPanel';
import type { PixiCanvas } from '@/rendering/PixiCanvas';
import { createEmptyDeck, createGuestUserData } from '@/data/dataModels';
import { App } from './App';

const mocks = vi.hoisted(() => ({ startup: vi.fn(), decks: vi.fn(), canvas: vi.fn() }));
vi.mock('./Startup', () => ({ initializeApp: mocks.startup }));
vi.mock('@/rendering/PixiCanvas', () => ({ PixiCanvas: (props: ComponentProps<typeof PixiCanvas>) => { mocks.canvas(props); return null; } }));
vi.mock('@/ui/DecksPanel', () => ({ DecksPanel: (props: ComponentProps<typeof DecksPanel>) => { mocks.decks(props); return null; } }));
vi.mock('@/ui/BottomPanel', () => ({ BottomPanel: () => null }));
vi.mock('@/ui/StacksPanel', () => ({ StacksPanel: () => null }));
vi.mock('@/ui/LoginModal', () => ({ LoginModal: () => null }));
vi.mock('@/ui/Notifications', () => ({ Notifications: () => null }));
vi.mock('@/ui/useResponsiveUiMode', () => ({ useResponsiveUiMode: () => 'desktop' }));
vi.mock('@/data/userStorage', () => ({ saveUserData: vi.fn().mockResolvedValue(undefined), mirrorUserDataToLocalStorage: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('reopening saved decks', () => {
  it('retains the current canvas avatar and arrangement instead of restoring the saved snapshot', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const deck = createEmptyDeck('Original name', 'saved');
    deck.boards.avatar = [{ name: 'Original avatar', quantity: 1 }];
    const area: CanvasArea = {
      id: 'area', deckId: deck.id, type: 'deck', name: 'Edited name', pinned: false,
      avatarCardName: 'Edited avatar', deckAuthor: 'Local author',
      cards: [{ id: 'kept', cardName: 'Fireball', board: 'mainboard', x: 400, y: 800 }],
      bounds: { x: 0, y: 0, width: 2000, height: 2000 },
    };
    const userData = { ...createGuestUserData('guest'), decks: [deck], canvasAreas: [area] };
    mocks.startup.mockImplementation(async (dispatch: (action: AppAction) => void) => {
      dispatch({ type: 'SET_USER_DATA', userData });
      return { success: true };
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<App />));
      const before = (mocks.canvas.mock.lastCall?.[0] as ComponentProps<typeof PixiCanvas>).canvasAreas?.[0];
      const panel = mocks.decks.mock.lastCall?.[0] as ComponentProps<typeof DecksPanel>;
      await act(async () => { panel.onCreateDeckZone(deck); });
      const reopened = (mocks.canvas.mock.lastCall?.[0] as ComponentProps<typeof PixiCanvas>).canvasAreas?.[0];
      expect(reopened).toEqual({ ...before, pinned: true });
      expect(reopened?.avatarCardName).toBe('Edited avatar');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
