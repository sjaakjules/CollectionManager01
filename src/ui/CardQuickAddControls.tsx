import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { DECK_QUICK_SORT_FIELDS, type DeckQuickSortField } from '@/canvas/selectionActions';
import { CATALOGUE_FIELD_LABELS } from '@/data/catalogueLayout';
import type { CardQuickAddDeck, CardQuickAddTarget, CardScreenBounds, LabelCleanUpTarget, QuickAddBoard, QuickAddScope } from '@/rendering/cardQuickAdd';
import './cardQuickAdd.css';

export interface CardQuickAddControlsHandle {
  updateTargets(targets: CardQuickAddTarget[], label?: LabelCleanUpTarget | null): void;
  openForHold(key: string): boolean;
  cancelHoldMenu(): void;
}

interface Props {
  deck: CardQuickAddDeck | null;
  onAdd: (key: string, scope: QuickAddScope, board: QuickAddBoard) => void;
  onLayout?: (key: string) => void;
  onQuickSort?: (field: DeckQuickSortField) => void;
  onCleanUp?: () => void;
  onCleanUpLabel?: (id: string) => void;
}

type OpenMenu = { kind: 'boards'; key: string; held?: boolean } | { kind: 'quick-sort' };
type PointerPosition = { x: number; y: number; touch: boolean };
type ControlPress = {
  pointerId: number;
  button: HTMLButtonElement;
  selectedKeys: ReadonlySet<string>;
  labelId: string | undefined;
  releaseTimer?: number;
};

const boards = [
  { board: 'collection', label: 'Collection' },
  { board: 'mainboard', label: 'Main' },
  { board: 'maybeboard', label: 'Maybe' },
] as const;

const quickSortLabels = { ...CATALOGUE_FIELD_LABELS, type: 'Type', power: 'Power' };
const TOOLBAR_FAR_OPACITY = 0.18;
const TOOLBAR_CARD_OPACITY = 0.56;
const TOOLBAR_NEAR_DISTANCE = 80;
const TOOLBAR_FAR_DISTANCE = 220;

function selectionCenter(targets: CardQuickAddTarget[], width: number, height: number) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  let visible = false;
  let layoutKey: string | null = null;
  for (const target of targets) {
    const bounds = target.bounds;
    if (!bounds && !target.visible) continue;
    left = Math.min(left, bounds?.left ?? target.clientX);
    top = Math.min(top, bounds?.top ?? target.clientY);
    right = Math.max(right, bounds?.right ?? target.clientX);
    bottom = Math.max(bottom, bounds?.bottom ?? target.clientY);
    const onScreen = target.visible || !!(bounds && bounds.left < width && bounds.right > 0 && bounds.top < height && bounds.bottom > 0);
    if (!onScreen) continue;
    visible = true;
    if (target.canLayout) layoutKey ??= target.key;
  }
  return visible ? { x: (left + right) / 2, y: (top + bottom) / 2, layoutKey } : null;
}

function positionAtCenter(element: HTMLElement, center: { x: number; y: number }, viewport: { width: number; height: number }): CardScreenBounds {
  const { offsetWidth: width, offsetHeight: height } = element;
  const left = Math.max(8, Math.min(viewport.width - width - 8, center.x - width / 2));
  const top = Math.max(8, Math.min(viewport.height - height - 8, center.y - height / 2));
  element.style.transform = `translate(${left}px, ${top}px)`;
  return { left, top, right: left + width, bottom: top + height };
}

function positionAboveLabel(element: HTMLElement, label: LabelCleanUpTarget, viewport: { width: number; height: number }): CardScreenBounds | null {
  const height = element.offsetHeight;
  const bottom = label.clientY - 6;
  // Keep the heading available for drag and edit even when it reaches the top edge.
  return bottom - height >= 8 ? positionAtCenter(element, { x: label.clientX, y: bottom - height / 2 }, viewport) : null;
}

function actionOpacity(pointer: PointerPosition | null, toolbar: CardScreenBounds, targets: CardQuickAddTarget[]): number {
  if (!pointer) return TOOLBAR_FAR_OPACITY;
  if (pointer.touch) return 1;
  const { x, y } = pointer;
  const distance = Math.hypot(Math.max(0, toolbar.left - x, x - toolbar.right), Math.max(0, toolbar.top - y, y - toolbar.bottom));
  if (distance <= TOOLBAR_NEAR_DISTANCE) return 1;
  const onCard = targets.some(({ bounds }) => bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom);
  const fade = Math.min(1, (distance - TOOLBAR_NEAR_DISTANCE) / (TOOLBAR_FAR_DISTANCE - TOOLBAR_NEAR_DISTANCE));
  return Math.max(onCard ? TOOLBAR_CARD_OPACITY : TOOLBAR_FAR_OPACITY, 1 - fade * (1 - TOOLBAR_FAR_OPACITY));
}

/** React owns the controls; Pixi supplies only selection and screen positions.
 * Camera movement updates DOM positions without rendering React every frame. */
export const CardQuickAddControls = forwardRef<CardQuickAddControlsHandle, Props>(function CardQuickAddControls({ deck, onAdd, onLayout, onQuickSort, onCleanUp, onCleanUpLabel }, ref) {
  const [cards, setCards] = useState<CardQuickAddTarget[]>([]);
  const [labelId, setLabelId] = useState<string | null>(null);
  const [activeMenu, setActiveMenu] = useState<OpenMenu | null>(null);
  const targetsRef = useRef<CardQuickAddTarget[]>([]);
  const labelTargetRef = useRef<LabelCleanUpTarget | null>(null);
  const selectionSignature = useRef('');
  const selectedKeysRef = useRef(new Set<string>());
  const actionsDismissedRef = useRef(false);
  const activeMenuRef = useRef<OpenMenu | null>(null);
  const outsidePointers = useRef(new Set<number>());
  const controlPress = useRef<ControlPress | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const boardMenuRef = useRef<HTMLDivElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const actionsBoundsRef = useRef<CardScreenBounds | null>(null);
  const pointerRef = useRef<PointerPosition | null>(null);
  const layoutKeyRef = useRef<string | null>(null);
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());
  const hasDeck = deck !== null;
  const canCleanUpLabel = !!onCleanUpLabel;
  const showLabelCleanUp = canCleanUpLabel && labelId !== null;
  const showLayout = !showLabelCleanUp && !!onLayout && cards.length > 1 && cards.some(card => card.canLayout);
  const showQuickSort = !showLabelCleanUp && !!onQuickSort && cards.length > 1 && cards.some(card => card.canQuickSort);
  const showCleanUp = showLabelCleanUp || (!!onCleanUp && cards.length > 1 && cards.some(card => card.canCleanUp));
  const showActions = showLayout || showQuickSort || showCleanUp;

  const openMenu = useCallback((menu: OpenMenu | null) => {
    activeMenuRef.current = menu;
    setActiveMenu(menu);
  }, []);

  const updatePointerInteractivity = useCallback(() => {
    rootRef.current?.toggleAttribute('data-canvas-pointer-down', outsidePointers.current.size > 0);
  }, []);

  const clearControlPress = useCallback(() => {
    window.clearTimeout(controlPress.current?.releaseTimer);
    controlPress.current = null;
  }, []);

  const isCurrentControlPress = useCallback((press: ControlPress) =>
    press.selectedKeys === selectedKeysRef.current && press.labelId === labelTargetRef.current?.id, []);

  const updateActionOpacity = useCallback(() => {
    const toolbar = actionsRef.current;
    const bounds = actionsBoundsRef.current;
    if (!toolbar || toolbar.hidden || !bounds) return;
    const active = toolbar.contains(document.activeElement) || toolbar.contains(controlPress.current?.button ?? null);
    const opacity = active ? 1 : actionOpacity(pointerRef.current, bounds, targetsRef.current);
    const value = String(Math.round(opacity * 100) / 100);
    if (toolbar.style.getPropertyValue('--selection-actions-opacity') !== value) {
      toolbar.style.setProperty('--selection-actions-opacity', value);
    }
  }, []);

  const reposition = useCallback(() => {
    updatePointerInteractivity();
    const press = controlPress.current;
    if (press && rootRef.current?.contains(press.button) && isCurrentControlPress(press)) {
      updateActionOpacity();
      return;
    }
    const bounds = { width: window.innerWidth, height: window.innerHeight };
    let open = activeMenuRef.current;
    const menu = boardMenuRef.current;
    const menuKey = open?.kind === 'boards' ? open.key : null;
    const anchor = menuKey === null ? undefined : targetsRef.current.find(target => target.key === menuKey);
    if (menuKey !== null && !anchor?.visible) {
      openMenu(null);
      open = null;
    }
    let menuAnchorY: number | undefined;
    if (menu && anchor) {
      const width = Math.min(270, bounds.width - 16);
      const top = Math.max(8, Math.min(bounds.height - menu.offsetHeight - 8, anchor.clientY - 62));
      menu.style.left = `${Math.max(8, Math.min(bounds.width - width - 8, anchor.clientX - width / 2))}px`;
      menu.style.top = `${top}px`;
      // Keep the + between the rows when they need to shift near a screen edge.
      menuAnchorY = top + 62;
    }
    const actions = actionsRef.current;
    const sortMenu = sortMenuRef.current;
    const center = actions || sortMenu ? selectionCenter(targetsRef.current, bounds.width, bounds.height) : null;
    if (actions) {
      const label = canCleanUpLabel ? labelTargetRef.current : null;
      layoutKeyRef.current = center?.layoutKey ?? null;
      actionsBoundsRef.current = null;
      actions.hidden = !(label?.visible ?? center) || !!open || actionsDismissedRef.current;
      if (!actions.hidden) {
        actionsBoundsRef.current = label ? positionAboveLabel(actions, label, bounds) : center && positionAtCenter(actions, center, bounds);
        actions.hidden = actionsBoundsRef.current === null;
      }
      updateActionOpacity();
    }
    if (sortMenu) {
      sortMenu.hidden = !center || open?.kind !== 'quick-sort';
      if (center && !sortMenu.hidden) positionAtCenter(sortMenu, center, bounds);
      if (!center && open?.kind === 'quick-sort') openMenu(null);
    }
    for (const target of targetsRef.current) {
      const button = buttonsRef.current.get(target.key);
      if (!button) continue;
      button.hidden = !target.visible;
      const y = target === anchor && menuAnchorY !== undefined ? menuAnchorY : target.clientY;
      button.style.transform = `translate(${target.clientX - 16}px, ${y - 16}px)`;
    }
  }, [canCleanUpLabel, isCurrentControlPress, openMenu, updateActionOpacity, updatePointerInteractivity]);

  const finishControlPress = useCallback(() => {
    clearControlPress();
    reposition();
  }, [clearControlPress, reposition]);

  const dismissActions = () => {
    actionsDismissedRef.current = true;
    openMenu(null);
    reposition();
  };

  useImperativeHandle(ref, () => ({
    updateTargets(targets, label = null) {
      targetsRef.current = targets;
      const nextLabelId = label?.id ?? null;
      const labelChanged = nextLabelId !== (labelTargetRef.current?.id ?? null);
      labelTargetRef.current = label;
      if (labelChanged) {
        setLabelId(nextLabelId);
        actionsDismissedRef.current = false;
        openMenu(null);
      }
      const signature = JSON.stringify(targets.map(target => [target.key, target.cardName, target.canLayout, target.canQuickSort, target.canCleanUp]));
      if (signature !== selectionSignature.current) {
        selectionSignature.current = signature;
        setCards(targets);
        const keys = selectedKeysRef.current;
        if (keys.size !== targets.length || targets.some(target => !keys.has(target.key))) {
          selectedKeysRef.current = new Set(targets.map(target => target.key));
          actionsDismissedRef.current = false;
          openMenu(null);
        }
      }
      const open = activeMenuRef.current;
      if (open?.kind === 'quick-sort' && !targets.some(target => target.canQuickSort)) openMenu(null);
      reposition();
    },
    openForHold(key) {
      if (!hasDeck || !targetsRef.current.some(target => target.key === key && target.visible)) return false;
      openMenu({ kind: 'boards', key, held: true });
      return true;
    },
    cancelHoldMenu() {
      const open = activeMenuRef.current;
      if (open?.kind === 'boards' && open.held) openMenu(null);
    },
  }), [hasDeck, openMenu, reposition]);

  useLayoutEffect(reposition, [cards, labelId, activeMenu, hasDeck, showLayout, showQuickSort, showCleanUp, reposition]);
  useLayoutEffect(() => {
    if (activeMenu?.kind === 'quick-sort') sortMenuRef.current?.querySelector('button')?.focus({ preventScroll: true });
  }, [activeMenu]);
  useEffect(() => {
    if (activeMenuRef.current?.kind === 'boards') openMenu(null);
  }, [deck?.deckId, deck?.canvasAreaId, openMenu]);

  useEffect(() => {
    let opacityFrame: number | null = null;
    const scheduleOpacity = () => {
      if (!actionsRef.current || actionsRef.current.hidden || opacityFrame !== null) return;
      opacityFrame = window.requestAnimationFrame(() => {
        opacityFrame = null;
        updateActionOpacity();
      });
    };
    const pointer = (event: PointerEvent) => {
      if (event.type === 'pointermove' && event.buttons === 0) {
        if (outsidePointers.current.delete(event.pointerId)) updatePointerInteractivity();
        const press = controlPress.current;
        if (press?.pointerId === event.pointerId && press.releaseTimer === undefined) finishControlPress();
      }
      pointerRef.current = { x: event.clientX, y: event.clientY, touch: event.pointerType === 'touch' };
      scheduleOpacity();
    };
    const leave = (event: PointerEvent) => {
      if (event.relatedTarget || event.pointerType === 'touch') return;
      pointerRef.current = null;
      scheduleOpacity();
    };
    const pointerDown = (event: PointerEvent) => {
      if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) pointer(event);
      if (event.target instanceof Element && rootRef.current?.contains(event.target)) {
        const button = event.target.closest('button');
        if (event.button === 0 && button && !button.disabled && !button.closest('[hidden]')) {
          clearControlPress();
          controlPress.current = { pointerId: event.pointerId, button, selectedKeys: selectedKeysRef.current, labelId: labelTargetRef.current?.id };
          updateActionOpacity();
        }
        return;
      }
      if (controlPress.current) finishControlPress();
      openMenu(null);
      outsidePointers.current.add(event.pointerId);
      updatePointerInteractivity();
    };
    const release = (event: PointerEvent) => {
      outsidePointers.current.delete(event.pointerId);
      updatePointerInteractivity();
      const press = controlPress.current;
      if (!press || press.pointerId !== event.pointerId) return;
      if (event.type === 'pointercancel' || !(event.target instanceof Node && press.button.contains(event.target))) {
        finishControlPress();
        return;
      }
      // Leave the hit target in place until the browser sends click. If it
      // suppresses click after a gesture, resume after a short delay.
      press.releaseTimer = window.setTimeout(finishControlPress, 150);
    };
    const escape = (event: KeyboardEvent) => {
      const open = activeMenuRef.current;
      if (event.key !== 'Escape' || !open) return;
      event.preventDefault();
      openMenu(null);
      if (controlPress.current) finishControlPress();
      if (open.kind === 'boards') buttonsRef.current.get(open.key)?.focus({ preventScroll: true });
      else {
        reposition();
        sortButtonRef.current?.focus({ preventScroll: true });
      }
    };
    const blur = () => {
      outsidePointers.current.clear();
      pointerRef.current = null;
      openMenu(null);
      finishControlPress();
    };
    window.addEventListener('pointerdown', pointerDown, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    window.addEventListener('pointermove', pointer, { passive: true });
    window.addEventListener('pointerout', leave);
    window.addEventListener('focusin', scheduleOpacity);
    window.addEventListener('focusout', scheduleOpacity);
    window.addEventListener('keydown', escape);
    window.addEventListener('resize', reposition);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
      window.removeEventListener('pointermove', pointer);
      window.removeEventListener('pointerout', leave);
      window.removeEventListener('focusin', scheduleOpacity);
      window.removeEventListener('focusout', scheduleOpacity);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('blur', blur);
      clearControlPress();
      if (opacityFrame !== null) window.cancelAnimationFrame(opacityFrame);
    };
  }, [clearControlPress, finishControlPress, openMenu, reposition, updateActionOpacity, updatePointerInteractivity]);

  if (!deck && !showActions) return null;
  const openKey = activeMenu?.kind === 'boards' ? activeMenu.key : null;
  const openCard = deck && cards.find(card => card.key === openKey);
  const add = (scope: QuickAddScope, board: QuickAddBoard) => {
    if (!openCard) return;
    onAdd(openCard.key, scope, board);
    openMenu(null);
    buttonsRef.current.get(openCard.key)?.focus();
  };
  const row = (scope: QuickAddScope) => (
    <div className="card-quick-add-row" role="group" aria-label={scope === 'card' ? `Add ${openCard?.cardName} to ${deck?.name}` : `Add all ${cards.length} selected cards to ${deck?.name}`}>
      {boards.map(({ board, label }) => (
        <button type="button" key={board} onClick={() => add(scope, board)}
          aria-label={scope === 'card' ? `Add ${openCard?.cardName} to ${label}` : `Add all selected to ${label}`}>
          {label}
        </button>
      ))}
    </div>
  );
  return (
    <div ref={rootRef} className="card-quick-add-controls" data-menu-open={activeMenu ? true : undefined} onPointerDown={event => event.stopPropagation()}
      onClickCapture={event => {
        const press = controlPress.current;
        if (!press || event.detail === 0 || isCurrentControlPress(press)) return;
        if (!(event.target instanceof Node) || !press.button.contains(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        finishControlPress();
      }}
      onClick={event => {
        event.stopPropagation();
        if (controlPress.current) finishControlPress();
      }} onDoubleClick={event => event.stopPropagation()}>
      {showActions && (
        <div ref={actionsRef} className="card-selection-actions" role="group" aria-label={showLabelCleanUp ? 'Selected label actions' : 'Selected card actions'}>
          {showLayout && (
            <button type="button" aria-label="Layout selected cards" onClick={() => {
              const key = layoutKeyRef.current;
              if (!key) return;
              dismissActions();
              onLayout(key);
            }}>
              Layout
            </button>
          )}
          {showQuickSort && (
            <button ref={sortButtonRef} type="button" aria-expanded={activeMenu?.kind === 'quick-sort'}
              aria-controls={activeMenu?.kind === 'quick-sort' ? 'card-selection-sort-menu' : undefined}
              onClick={() => openMenu({ kind: 'quick-sort' })}>
              Quick Sort
            </button>
          )}
          {showCleanUp && (
            <button type="button" onClick={() => {
              dismissActions();
              if (showLabelCleanUp) onCleanUpLabel(labelId);
              else onCleanUp?.();
            }}>
              Clean Up
            </button>
          )}
        </div>
      )}
      {showQuickSort && activeMenu?.kind === 'quick-sort' && (
        <div ref={sortMenuRef} id="card-selection-sort-menu" className="card-selection-sort-menu" role="group" aria-label="Sort by">
          {DECK_QUICK_SORT_FIELDS.map(field => (
            <button key={field} type="button" onClick={() => {
              dismissActions();
              onQuickSort(field);
            }}>
              {quickSortLabels[field]}
            </button>
          ))}
        </div>
      )}
      {deck && cards.map(card => (
        <button type="button" key={card.key} className="card-quick-add-plus"
          ref={button => { if (button) buttonsRef.current.set(card.key, button); else buttonsRef.current.delete(card.key); }}
          aria-label={`Add ${card.cardName} to ${deck.name}`} aria-expanded={openKey === card.key}
          aria-controls={openKey === card.key ? 'card-quick-add-menu' : undefined}
          title={`Add ${card.cardName} to ${deck.name}`}
          onClick={() => openMenu(openKey === card.key ? null : { kind: 'boards', key: card.key })}>
          <span aria-hidden="true">+</span>
        </button>
      ))}
      {openCard && (
        <div ref={boardMenuRef} id="card-quick-add-menu" className="card-quick-add-menu">
          {row('card')}
          {cards.length > 1 && (
            <>
              <div className="card-quick-add-gap" />
              <div className="card-quick-add-selection">
                {row('selection')}
                <div className="card-quick-add-caption">All Selected <span>({cards.length})</span></div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
});
