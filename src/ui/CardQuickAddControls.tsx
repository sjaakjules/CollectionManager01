import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { CardQuickAddDeck, CardQuickAddTarget, QuickAddBoard, QuickAddScope } from '@/rendering/cardQuickAdd';
import './cardQuickAdd.css';

export interface CardQuickAddControlsHandle {
  updateTargets(targets: CardQuickAddTarget[]): void;
}

interface Props {
  deck: CardQuickAddDeck | null;
  onAdd: (key: string, scope: QuickAddScope, board: QuickAddBoard) => void;
}

const boards = [
  { board: 'collection', label: 'Collection' },
  { board: 'mainboard', label: 'Main' },
  { board: 'maybeboard', label: 'Maybe' },
] as const;

/** React owns the controls; Pixi supplies only selection and screen positions.
 * Camera movement updates DOM positions without rendering React every frame. */
export const CardQuickAddControls = forwardRef<CardQuickAddControlsHandle, Props>(function CardQuickAddControls({ deck, onAdd }, ref) {
  const [cards, setCards] = useState<CardQuickAddTarget[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const targetsRef = useRef<CardQuickAddTarget[]>([]);
  const selectionSignature = useRef('');
  const openKeyRef = useRef(openKey);
  openKeyRef.current = openKey;
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());

  const reposition = useCallback(() => {
    for (const target of targetsRef.current) {
      const button = buttonsRef.current.get(target.key);
      if (!button) continue;
      button.hidden = !target.visible;
      button.style.transform = `translate(${target.clientX - 16}px, ${target.clientY - 16}px)`;
    }
    const menu = menuRef.current;
    const anchor = targetsRef.current.find(target => target.key === openKeyRef.current);
    if (menu && anchor) {
      menu.style.left = `${Math.max(8, Math.min(window.innerWidth - 278, anchor.clientX - 135))}px`;
      menu.style.top = `${Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, anchor.clientY - 62))}px`;
    }
  }, []);

  useImperativeHandle(ref, () => ({
    updateTargets(targets) {
      targetsRef.current = targets;
      const signature = JSON.stringify(targets.map(target => [target.key, target.cardName]));
      if (signature !== selectionSignature.current) {
        selectionSignature.current = signature;
        setCards(targets);
        setOpenKey(null);
      } else if (openKeyRef.current && !targets.some(target => target.key === openKeyRef.current && target.visible)) {
        setOpenKey(null);
      }
      reposition();
    },
  }), [reposition]);

  useLayoutEffect(reposition, [cards, openKey, deck, reposition]);
  useEffect(() => setOpenKey(null), [deck?.deckId, deck?.canvasAreaId]);

  useEffect(() => {
    const pointers = new Set<number>();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpenKey(null);
      pointers.add(event.pointerId);
      // Let a canvas drag/pinch finish without crossing over an HTML button.
      if (rootRef.current) rootRef.current.style.visibility = 'hidden';
    };
    const release = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (!pointers.size && rootRef.current) rootRef.current.style.visibility = '';
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !openKeyRef.current) return;
      event.preventDefault();
      buttonsRef.current.get(openKeyRef.current)?.focus();
      setOpenKey(null);
    };
    const blur = () => {
      pointers.clear();
      if (rootRef.current) rootRef.current.style.visibility = '';
      setOpenKey(null);
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    window.addEventListener('keydown', escape);
    window.addEventListener('resize', reposition);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('blur', blur);
    };
  }, [reposition]);

  if (!deck) return null;
  const openCard = cards.find(card => card.key === openKey);
  const add = (scope: QuickAddScope, board: QuickAddBoard) => {
    if (!openCard) return;
    onAdd(openCard.key, scope, board);
    setOpenKey(null);
    buttonsRef.current.get(openCard.key)?.focus();
  };
  const row = (scope: QuickAddScope) => (
    <div className="card-quick-add-row" role="group" aria-label={scope === 'card' ? `Add ${openCard?.cardName} to ${deck.name}` : `Add all ${cards.length} selected cards to ${deck.name}`}>
      {boards.map(({ board, label }) => (
        <button type="button" key={board} onClick={() => add(scope, board)}
          aria-label={scope === 'card' ? `Add ${openCard?.cardName} to ${label}` : `Add all selected to ${label}`}>
          {label}
        </button>
      ))}
    </div>
  );
  return (
    <div ref={rootRef} className="card-quick-add-controls" onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      {cards.map(card => (
        <button type="button" key={card.key} className="card-quick-add-plus"
          ref={button => { if (button) buttonsRef.current.set(card.key, button); else buttonsRef.current.delete(card.key); }}
          aria-label={`Add ${card.cardName} to ${deck.name}`} aria-expanded={openKey === card.key}
          aria-controls={openKey === card.key ? 'card-quick-add-menu' : undefined}
          title={`Add ${card.cardName} to ${deck.name}`}
          onClick={() => setOpenKey(current => current === card.key ? null : card.key)}>
          <span aria-hidden="true">+</span>
        </button>
      ))}
      {openCard && (
        <div ref={menuRef} id="card-quick-add-menu" className="card-quick-add-menu">
          {row('card')}
          <div className="card-quick-add-gap" />
          {cards.length > 1 && (
            <div className="card-quick-add-selection">
              {row('selection')}
              <div className="card-quick-add-caption">All Selected <span>({cards.length})</span></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
