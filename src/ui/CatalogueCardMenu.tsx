import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { QuickAddBoard } from '@/rendering/cardQuickAdd';
import { BOARD_CHOICE_OPTIONS } from './boardChoice';
import './catalogueCardMenu.css';

export interface CatalogueCardMenuRequest {
  cardName: string;
  clientX: number;
  clientY: number;
}

interface Props {
  request: CatalogueCardMenuRequest;
  deck: { name: string } | null;
  stacks: readonly { id: string; name: string }[];
  onDeck: (board: QuickAddBoard) => void;
  onStack: (stackId: string) => void;
  onCreateStack: (name: string) => void;
  onClose: () => void;
}

type Destination = 'stack' | 'deck';

const VIEWPORT_MARGIN = 8;
const ROOT_WIDTH = 112;
const SUBMENU_WIDTH = 184;
const MENU_ITEM = 'button[role="menuitem"]:not(:disabled)';

function clamp(value: number, lower: number, upper: number): number {
  return Math.max(lower, Math.min(upper, value));
}

/** Adds a catalogue copy through one destination while keeping canvas state in the caller. */
export function CatalogueCardMenu({ request, deck, stacks, onDeck, onStack, onCreateStack, onClose }: Props) {
  const [destination, setDestination] = useState<Destination | null>(null);
  const [newStack, setNewStack] = useState(false);
  const [stackName, setStackName] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const parentMenu = useRef<HTMLDivElement>(null);
  const submenu = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const focusSubmenuAfterRender = useRef(false);
  const finished = useRef(false);
  const submenuId = useId();
  const noDeckId = useId();

  const finish = useCallback((action?: () => void, restoreFocus = true) => {
    if (finished.current) return;
    finished.current = true;
    action?.();
    onClose();
    if (restoreFocus && previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
  }, [onClose]);

  const position = useCallback(() => {
    if (!root.current || !parentMenu.current) return;
    const viewport = window.visualViewport;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const minX = (viewport?.offsetLeft ?? 0) + VIEWPORT_MARGIN;
    const minY = (viewport?.offsetTop ?? 0) + VIEWPORT_MARGIN;
    const maxX = minX + width - 2 * VIEWPORT_MARGIN;
    const maxY = minY + height - 2 * VIEWPORT_MARGIN;
    const rootWidth = Math.max(0, Math.min(ROOT_WIDTH, Math.floor((maxX - minX) / 2)));
    const subWidth = Math.max(0, Math.min(SUBMENU_WIDTH, maxX - minX - rootWidth));
    const anchor = clamp(request.clientX, minX, maxX - rootWidth);
    const leftRoom = anchor - minX;
    const rightRoom = maxX - anchor - rootWidth;
    const opensLeft = rightRoom < subWidth && (leftRoom >= subWidth || leftRoom > rightRoom);
    const left = opensLeft
      ? clamp(anchor, minX + subWidth, maxX - rootWidth)
      : clamp(anchor, minX, maxX - rootWidth - subWidth);

    const shell = root.current;
    shell.dataset.submenuSide = opensLeft ? 'left' : 'right';
    shell.style.setProperty('--catalogue-menu-width', `${rootWidth}px`);
    shell.style.setProperty('--catalogue-submenu-width', `${subWidth}px`);
    shell.style.setProperty('--catalogue-menu-height', `${Math.max(0, maxY - minY)}px`);
    const top = clamp(request.clientY, minY, maxY - parentMenu.current.offsetHeight);
    shell.style.left = `${left}px`;
    shell.style.top = `${top}px`;
    if (submenu.current) {
      const subTop = clamp(top, minY, maxY - submenu.current.offsetHeight);
      submenu.current.style.top = `${subTop - top}px`;
    }
  }, [request.clientX, request.clientY]);

  const focusSubmenu = () => {
    const menu = submenu.current;
    (menu?.querySelector<HTMLElement>(MENU_ITEM) ?? menu)?.focus({ preventScroll: true });
  };

  const reveal = (next: Destination, focus = false) => {
    if (destination === next) {
      if (focus) {
        if (newStack) input.current?.focus();
        else focusSubmenu();
      }
      return;
    }
    focusSubmenuAfterRender.current = focus || !!submenu.current?.contains(document.activeElement);
    setDestination(next);
    setNewStack(false);
    setStackName('');
  };

  const returnToParent = () => {
    const parent = parentMenu.current?.querySelector<HTMLButtonElement>(`[data-destination="${destination}"]`);
    setDestination(null);
    setNewStack(false);
    parent?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !root.current?.contains(active)) previousFocus.current = active;
    parentMenu.current?.querySelector<HTMLButtonElement>(MENU_ITEM)?.focus({ preventScroll: true });
  }, []);

  const hasDeck = deck !== null;
  useLayoutEffect(position, [position, destination, newStack, stacks.length, hasDeck]);
  useLayoutEffect(() => {
    if (newStack) input.current?.focus();
    else if (destination && focusSubmenuAfterRender.current) {
      focusSubmenuAfterRender.current = false;
      focusSubmenu();
    }
  }, [destination, newStack]);

  useEffect(() => {
    const outside = (event: Event) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return;
      finish(undefined, false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish();
    };
    const resize = () => finish();
    const viewport = window.visualViewport;
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('wheel', outside, { capture: true, passive: true });
    window.addEventListener('focusin', outside);
    window.addEventListener('keydown', escape, true);
    window.addEventListener('resize', resize);
    viewport?.addEventListener('resize', position);
    viewport?.addEventListener('scroll', position);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('wheel', outside, true);
      window.removeEventListener('focusin', outside);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', resize);
      viewport?.removeEventListener('resize', position);
      viewport?.removeEventListener('scroll', position);
    };
  }, [finish, position]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const target = event.target;
    if (!(target instanceof Node) || (newStack && submenu.current?.contains(target))) return;
    if (event.key === 'Tab') {
      finish(undefined, false);
      return;
    }
    const onParent = parentMenu.current?.contains(target);
    if (onParent && event.key === 'ArrowRight') {
      if (target instanceof HTMLButtonElement) {
        reveal(target.dataset.destination === 'deck' ? 'deck' : 'stack', true);
        event.preventDefault();
      }
      return;
    }
    if (!onParent && event.key === 'ArrowLeft') {
      returnToParent();
      event.preventDefault();
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...((onParent ? parentMenu.current : submenu.current)?.querySelectorAll<HTMLButtonElement>(MENU_ITEM) ?? [])];
    if (!buttons.length) return;
    const active = buttons.findIndex(button => button === document.activeElement);
    let next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    if (event.key === 'ArrowDown') next = (active + 1) % buttons.length;
    if (event.key === 'ArrowUp') next = (active <= 0 ? buttons.length : active) - 1;
    buttons[next]?.focus();
  };

  const name = stackName.trim();
  return (
    <div ref={root} className="catalogue-card-menu"
      onKeyDown={onKeyDown}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
      <div ref={parentMenu} className="catalogue-card-menu-main" role="menu" aria-label={`Add ${request.cardName}`}>
        {(['stack', 'deck'] as const).map(option => (
          <button key={option} type="button" role="menuitem" tabIndex={-1} data-destination={option}
            aria-haspopup="menu" aria-expanded={destination === option} aria-controls={destination === option ? submenuId : undefined}
            onPointerEnter={event => { if (event.pointerType !== 'touch') reveal(option); }}
            onClick={() => reveal(option, true)}>
            {option === 'stack' ? 'Stack' : 'Deck'} <span aria-hidden="true" className="catalogue-card-menu-caret">›</span>
          </button>
        ))}
      </div>
      {destination && (
        <div ref={submenu} id={submenuId} className="catalogue-card-menu-submenu" tabIndex={-1}
          role={newStack ? 'group' : 'menu'} aria-label={destination === 'deck' ? deck ? `${deck.name} boards` : 'Deck boards' : newStack ? 'New stack' : 'Saved stacks'}
          aria-describedby={destination === 'deck' && !deck ? noDeckId : undefined}>
          {destination === 'deck' && (
            <>
              {BOARD_CHOICE_OPTIONS.map(({ board, label }) => (
                <button key={board} type="button" role="menuitem" tabIndex={-1} disabled={!deck}
                  onClick={() => finish(() => onDeck(board))}>{label}</button>
              ))}
              {!deck && <p id={noDeckId}>Choose an active deck first.</p>}
            </>
          )}
          {destination === 'stack' && (newStack ? (
            <form onSubmit={event => {
              event.preventDefault();
              if (name) finish(() => onCreateStack(name));
            }}>
              <input ref={input} aria-label="Stack name" placeholder="Stack name" value={stackName}
                onChange={event => setStackName(event.target.value)} />
              <button type="submit" disabled={!name}>Create</button>
            </form>
          ) : (
            <>
              <button type="button" role="menuitem" tabIndex={-1} aria-label="New stack" onClick={() => setNewStack(true)}>+</button>
              {stacks.map(stack => (
                <button key={stack.id} type="button" role="menuitem" tabIndex={-1} title={stack.name}
                  onClick={() => finish(() => onStack(stack.id))}>{stack.name}</button>
              ))}
            </>
          ))}
        </div>
      )}
    </div>
  );
}
