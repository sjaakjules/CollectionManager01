import { describe, expect, it, vi } from 'vitest';
import type { CanvasArea } from '@/canvas/canvasAreas';
import { saveDeckLayoutProfile } from '@/canvas/deckLayoutProfiles';
import { ensureDeckSectionTabs, getDeckSectionTabMode } from '@/canvas/deckSectionLayouts';
import { createSelectionLayout, type CatalogueLayoutConfig } from '@/data/catalogueLayout';
import type { CanvasLabel, Card } from '@/data/dataModels';
import type { LabelCleanUpTarget, CardQuickAddTarget } from './cardQuickAdd';
import type { CanvasLayoutPopoverOptions } from '@/ui/canvasLayoutPopover';
import { required } from '@/utils/required';
import { PixiStage } from './PixiStage';

const openedPopover = vi.hoisted(() => vi.fn<(options: CanvasLayoutPopoverOptions) => void>());
vi.mock('@/ui/canvasLayoutPopover', () => ({ CanvasLayoutPopover: class {
  constructor(options: CanvasLayoutPopoverOptions) { openedPopover(options); }
  destroy() { /* No DOM is needed for the renderer's snapshot contract. */ }
} }));

interface LayoutEditingStage {
  canvasAreas: CanvasArea[];
  canvasLabels: CanvasLabel[];
  selectionLayoutPreview: { areas: CanvasArea[]; labels: CanvasLabel[]; keys: Set<string>; layout: CatalogueLayoutConfig; rendered: boolean } | null;
  handleViewportChange(): void;
  runCanvasGesture(command: 'undo'): string | null;
  cloneCanvasAreas(areas: CanvasArea[]): CanvasArea[];
  fitDeckSections(area: CanvasArea): boolean;
  previewSelectionLayout(layout: CatalogueLayoutConfig): void;
  cancelSelectionLayout(): void;
  applySelectionLayout(): void;
  refreshAutomaticSectionLayouts(): boolean;
  emitCanvasAreasChange(): void;
  emitCanvasLabelsChange(): void;
  quickSortSelection(field: 'name'): void;
  cleanUpSelection(): void;
  cleanUpLabel(id: string): void;
  updateCardQuickAddTargets(): void;
  getSelectionActions(): { canLayout: boolean; canQuickSort: boolean; canCleanUp: boolean };
  openSelectionLayout(): void;
  rebuildZoneVisuals(publishBounds?: boolean): void;
}

const layout: CatalogueLayoutConfig = {
  columns: 6, columnMode: 'limit', clean: true,
  steps: [{ field: 'name', mode: 'sort', direction: 'asc', axis: 'horizontal' }],
};

function cardMetadata(name: string, type: 'Minion' | 'Site'): Card {
  return { name, sets: [], elements: '', subTypes: '', guardian: {
    type, rarity: 'Ordinary', cost: type === 'Site' ? null : 1, rulesText: '',
    attack: null, life: null, defence: null, thresholds: { air: 0, earth: 0, fire: 0, water: 0 },
  } };
}

function fixture() {
  const spells = ['Zephyr', 'Ally', 'Thaw', 'Ice', 'Wisp', 'Flame'].map(name => cardMetadata(name, 'Minion'));
  const spellInstances = spells.map((spell, index) => ({ id: `spell-${index}`, cardName: spell.name,
    board: 'mainboard' as const, x: 31, y: 253 + index * 220, labelId: 'spells' }));
  const area: CanvasArea = {
    id: 'deck', name: 'Deck', type: 'deck', pinned: true, bounds: { x: 0, y: 0, width: 550, height: 2400 },
    deckRegionBounds: { spellbook: { x: 0, y: 168, width: 220, height: 230 } },
    cards: [...spellInstances,
      { id: 'atlas', cardName: 'Island', board: 'mainboard', x: 31, y: 1670 },
      { id: 'collection', cardName: 'Ice', board: 'collection', x: 31, y: 1925 },
      { id: 'maybe', cardName: 'Wisp', board: 'maybeboard', x: 31, y: 2170 },
    ],
    deckVariants: [{ id: 'variant', name: 'Variant', activeCardIds: ['spell-0', 'spell-1', 'atlas'] }],
    activeDeckVariantId: 'variant',
  };
  const labels: CanvasLabel[] = [{ id: 'spells', text: 'Spells', areaId: area.id, board: 'mainboard', x: 31, y: 210,
    deckSectionLayout: { section: 'spellbook', id: 'cost' } }];
  const spellbook = ensureDeckSectionTabs(area, 'spellbook');
  spellbook.activeId = 'cost';
  const atlas = ensureDeckSectionTabs(area, 'atlas');
  atlas.tabs.push({ id: 'islands', name: 'Islands', mode: 'automatic', layout });
  atlas.activeId = 'islands';
  const onCanvasAreasChange = vi.fn<(areas: CanvasArea[]) => void>();
  const onCanvasLabelsChange = vi.fn<(labels: CanvasLabel[]) => void>();
  const stage = Object.assign(Object.create(PixiStage.prototype) as LayoutEditingStage, {
    canvasAreas: [area], canvasLabels: labels, cards: [...spells, cardMetadata('Island', 'Site')],
    deckLayoutProfile: 'desktop', onCanvasAreasChange, onCanvasLabelsChange,
    motionEnabled: () => false, isLandscapeCard: (name: string) => name === 'Island',
    syncDeckSectionTabs: vi.fn(), playCardsEffect: vi.fn(), playMangaEffect: vi.fn(),
    zoneCardSprites: new Map(), scheduleCulling: vi.fn(), rebuildCollectionForLayoutVariantChange: vi.fn(),
    rebuildZoneVisuals: vi.fn((publishBounds = true) => {
      for (const candidate of stage.canvasAreas) {
        if (stage.fitDeckSections(candidate) && publishBounds) stage.emitCanvasAreasChange();
      }
    }),
  });
  stage.fitDeckSections(area);
  saveDeckLayoutProfile(area, stage.canvasLabels, 'phone');
  const beginPreview = () => {
    const keys = new Set(spellInstances.map(card => `deck:${card.id}`));
    const before = { areas: stage.cloneCanvasAreas(stage.canvasAreas),
      labels: stage.canvasLabels.map(label => ({ ...label })), keys, layout, rendered: false };
    stage.selectionLayoutPreview = before;
    return structuredClone(before);
  };
  return { stage, area, beginPreview, onCanvasAreasChange, onCanvasLabelsChange };
}

describe('canvas layout editing', () => {
  it.each(['onApply', 'onClose'] as const)('opens an empty editor and %s without changing or rebuilding the canvas', close => {
    const { stage, area, onCanvasAreasChange, onCanvasLabelsChange } = fixture();
    Object.assign(stage, {
      selectedCards: new Set(), selectedZoneCardKeys: new Set(area.cards.slice(0, 6).map(card => `deck:${card.id}`)),
      zoneCardSprites: new Map(area.cards.map(card => [`deck:${card.id}`, { zoneId: area.id, cardName: card.cardName,
        sprite: { x: card.x, y: card.y }, displaySize: { width: 100, height: 140 } }])),
      app: { canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }) } },
    });
    const original = structuredClone({ areas: stage.canvasAreas, labels: stage.canvasLabels });
    stage.openSelectionLayout();
    const options = required(openedPopover.mock.lastCall?.[0]);
    expect(options.layout).toEqual(createSelectionLayout());
    expect(options.allowClean).toBe(true);
    expect(stage.rebuildZoneVisuals).not.toHaveBeenCalled();
    expect({ areas: stage.canvasAreas, labels: stage.canvasLabels }).toEqual(original);
    options[close]?.();
    expect({ areas: stage.canvasAreas, labels: stage.canvasLabels }).toEqual(original);
    expect(stage.canvasAreas[0]).toBe(area);
    expect(stage.rebuildZoneVisuals).not.toHaveBeenCalled();
    expect(onCanvasAreasChange).not.toHaveBeenCalled();
    expect(onCanvasLabelsChange).not.toHaveBeenCalled();
  });

  it('previews sort-only steps in the old slots and restores an empty sequence exactly', () => {
    const { stage, beginPreview, onCanvasAreasChange } = fixture();
    const before = beginPreview();
    stage.previewSelectionLayout({ ...layout, clean: false });
    const slots = (area: CanvasArea) => area.cards.map(card => `${card.x},${card.y}`).sort();
    expect(slots(required(stage.canvasAreas[0]))).toEqual(slots(required(before.areas[0])));
    expect(stage.canvasLabels).toEqual(before.labels);
    stage.previewSelectionLayout(createSelectionLayout());
    expect(stage.canvasAreas).toEqual(before.areas);
    expect(stage.canvasLabels).toEqual(before.labels);
    stage.applySelectionLayout();
    expect(onCanvasAreasChange).not.toHaveBeenCalled();
  });

  it.each(['quick-sort', 'clean-up'] as const)('persists %s in the current tab without changing other boards or variants', action => {
    const { stage, area, onCanvasAreasChange, onCanvasLabelsChange } = fixture();
    // The single selected Atlas stack has nothing to rearrange and stays automatic.
    const selected = new Set(area.cards.slice(0, 7).map(card => `deck:${card.id}`));
    Object.assign(stage, {
      selectedZoneCardKeys: selected, selectedCards: new Set(),
      zoneCardSprites: new Map([...selected].map(key => [key, { zoneId: area.id }])),
      app: { canvas: { getBoundingClientRect: () => ({ width: 1200, height: 800 }) } },
    });
    const before = structuredClone(area);
    expect(stage.getSelectionActions()).toEqual({ canLayout: true, canQuickSort: true, canCleanUp: true });
    if (action === 'quick-sort') stage.quickSortSelection('name');
    else stage.cleanUpSelection();
    const saved = required(onCanvasAreasChange.mock.lastCall?.[0][0]);
    expect(saved.cards.slice(-3)).toEqual(before.cards.slice(-3));
    expect(saved.cards.map(({ id, board, labelId }) => ({ id, board, labelId })))
      .toEqual(before.cards.map(({ id, board, labelId }) => ({ id, board, labelId })));
    expect(saved.deckVariants).toEqual(before.deckVariants);
    expect(saved.layoutProfiles?.phone).toEqual(before.layoutProfiles?.phone);
    expect(saved.layoutProfiles?.desktop?.cards['spell-0'])
      .toEqual({ x: required(saved.cards[0]).x, y: required(saved.cards[0]).y });
    expect(getDeckSectionTabMode(required(saved.sectionLayouts?.spellbook?.tabs.find(tab => tab.id === 'cost')))).toBe('custom');
    expect(getDeckSectionTabMode(required(saved.sectionLayouts?.atlas?.tabs.find(tab => tab.id === 'islands')))).toBe('automatic');
    expect(onCanvasLabelsChange).toHaveBeenCalledWith(stage.canvasLabels);
  });

  it('rejects selection arrangement commands for a single card', () => {
    const { stage, area, onCanvasAreasChange } = fixture();
    Object.assign(stage, { selectedCards: new Set(), selectedZoneCardKeys: new Set(['deck:spell-0']) });
    const before = structuredClone(area);
    expect(stage.getSelectionActions()).toEqual({ canLayout: false, canQuickSort: false, canCleanUp: false });
    stage.quickSortSelection('name');
    stage.cleanUpSelection();
    expect(stage.canvasAreas[0]).toEqual(before);
    expect(onCanvasAreasChange).not.toHaveBeenCalled();
  });

  it('anchors Clean Up above the selected label and only arranges its members', () => {
    const { stage, area, onCanvasAreasChange } = fixture();
    required(area.cards[1]).cardName = required(area.cards[0]).cardName;
    delete required(area.cards[5]).labelId;
    const outside = structuredClone(area.cards.slice(5));
    const onCardQuickAddTargetsChange = vi.fn<(cards: CardQuickAddTarget[], label?: LabelCleanUpTarget) => void>();
    Object.assign(stage, {
      isInitialized: true, selectedLabelId: 'spells',
      selectedCards: new Set(), selectedZoneCardKeys: new Set(),
      dragState: { isDragging: false }, zoneCardDragState: { isDragging: false },
      labelSprites: new Map([['spells', {
        text: { x: 31, y: 123, width: 80, height: 20, visible: true },
        bounds: { left: 23, top: 115, right: 119, bottom: 151 },
      }]]),
      app: { canvas: { getBoundingClientRect: () => ({ left: 40, top: 50, right: 1240, bottom: 850, width: 1200, height: 800 }) } },
      camera: { viewport: { toScreen: (x: number, y: number) => ({ x: 2 * x, y: 2 * y }) } },
      onCardQuickAddTargetsChange,
    });
    stage.updateCardQuickAddTargets();
    expect(onCardQuickAddTargetsChange).toHaveBeenCalledExactlyOnceWith([], {
      id: 'spells', clientX: 182, clientY: 296, visible: true,
    });
    stage.cleanUpLabel('stale-id');
    expect(onCanvasAreasChange).not.toHaveBeenCalled();
    stage.cleanUpLabel('spells');
    const saved = required(onCanvasAreasChange.mock.lastCall?.[0][0]);
    const [first, second] = saved.cards;
    expect(required(first).x).toBe(required(second).x);
    expect(required(first).y).toBe(required(second).y);
    expect(saved.cards.slice(5)).toEqual(outside);
  });

  it('previews updated bounds and labels without publishing and restores the original on cancel', () => {
    const { stage, beginPreview, onCanvasAreasChange, onCanvasLabelsChange } = fixture();
    const before = beginPreview();
    stage.previewSelectionLayout(layout);
    expect(required(stage.canvasAreas[0]).bounds).not.toEqual(required(before.areas[0]).bounds);
    expect(stage.canvasLabels).not.toEqual(before.labels);
    expect(stage.selectionLayoutPreview?.areas).toEqual(before.areas);
    expect(stage.selectionLayoutPreview?.labels).toEqual(before.labels);
    stage.emitCanvasAreasChange();
    stage.emitCanvasLabelsChange();
    expect(onCanvasAreasChange).not.toHaveBeenCalled();
    expect(onCanvasLabelsChange).not.toHaveBeenCalled();

    stage.cancelSelectionLayout();
    expect(stage.selectionLayoutPreview).toBeNull();
    expect(stage.canvasAreas).toEqual(before.areas);
    expect(stage.canvasLabels).toEqual(before.labels);
    expect(onCanvasAreasChange).not.toHaveBeenCalled();
    expect(onCanvasLabelsChange).not.toHaveBeenCalled();
  });

  it('saves the arranged selection in the editing device layout and freezes its automatic tab', () => {
    const { stage, beginPreview, onCanvasAreasChange, onCanvasLabelsChange } = fixture();
    const before = required(beginPreview().areas[0]);
    stage.previewSelectionLayout(layout);
    const arranged = structuredClone(required(stage.canvasAreas[0]).cards);
    stage.applySelectionLayout();
    expect(stage.selectionLayoutPreview).toBeNull();
    expect(onCanvasAreasChange).toHaveBeenCalledOnce();
    expect(onCanvasLabelsChange).toHaveBeenCalledExactlyOnceWith(stage.canvasLabels);

    const saved = required(onCanvasAreasChange.mock.calls[0]?.[0][0]);
    expect(saved.cards).toEqual(arranged);
    expect(saved.cards.map(({ id, board, labelId }) => ({ id, board, labelId })))
      .toEqual(before.cards.map(({ id, board, labelId }) => ({ id, board, labelId })));
    expect(saved.cards.slice(-3)).toEqual(before.cards.slice(-3));
    expect(saved.deckVariants).toEqual(before.deckVariants);
    expect(saved.layoutProfiles?.phone).toEqual(before.layoutProfiles?.phone);
    expect(saved.layoutProfiles?.desktop?.cards['spell-0'])
      .toEqual({ x: required(arranged[0]).x, y: required(arranged[0]).y });
    const tabMode = (section: 'spellbook' | 'atlas', id: string) =>
      getDeckSectionTabMode(required(saved.sectionLayouts?.[section]?.tabs.find(tab => tab.id === id)));
    expect(tabMode('spellbook', 'cost')).toBe('custom');
    expect(tabMode('spellbook', 'threshold')).toBe('automatic');
    expect(tabMode('atlas', 'islands')).toBe('automatic');
  });

  it('restores the incoming device layout when resizing interrupts a preview', () => {
    const { stage, area, beginPreview, onCanvasAreasChange, onCanvasLabelsChange } = fixture();
    const phone = required(area.layoutProfiles?.phone);
    const maybe = required(phone.cards.maybe);
    maybe.y += 220;
    beginPreview();
    stage.previewSelectionLayout(layout);
    vi.stubGlobal('window', { innerWidth: 400, innerHeight: 800 });
    try {
      stage.handleViewportChange();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(stage.selectionLayoutPreview).toBeNull();
    expect(stage.canvasAreas[0]?.cards.find(card => card.id === 'maybe')).toMatchObject(maybe);
    expect(onCanvasAreasChange).not.toHaveBeenCalled();
    expect(onCanvasLabelsChange).not.toHaveBeenCalled();
  });

  it('cancels the preview before restoring a deleted card with the undo shortcut', () => {
    const { stage, area, beginPreview, onCanvasAreasChange } = fixture();
    const card = { ...required(area.cards[0]), id: 'removed-id' };
    Object.assign(stage, { removedCardHistory: [{ areaId: area.id, card, index: 0, variants: ['variant'] }],
      deletionPuffs: [], mangaEffects: [] });
    beginPreview();
    stage.previewSelectionLayout(layout);
    expect(stage.runCanvasGesture('undo')).toBeNull();
    expect(stage.selectionLayoutPreview).toBeNull();
    const saved = required(onCanvasAreasChange.mock.lastCall?.[0][0]);
    expect(saved.cards[0]).toEqual(card);
    expect(saved.deckVariants?.[0]?.activeCardIds).toContain(card.id);
  });

  it('refreshes an automatic tab for new deck contents and leaves position-only edits alone', () => {
    const { stage, area } = fixture();
    expect(stage.refreshAutomaticSectionLayouts()).toBe(true);
    const original = required(area.cards[0]);
    original.x += 66;
    const x = original.x;
    expect(stage.refreshAutomaticSectionLayouts()).toBe(false);
    expect(original.x).toBe(x);

    area.cards.push({ ...original, id: 'new-copy', x: 1200, y: 400 });
    expect(stage.refreshAutomaticSectionLayouts()).toBe(true);
    expect(area.cards.at(-1)).toMatchObject({ id: 'new-copy', x: original.x, y: original.y });
    expect(stage.refreshAutomaticSectionLayouts()).toBe(false);
  });
});
