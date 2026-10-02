import { useEffect, useRef } from 'react';

interface DeckActionDialogProps {
  action: 'reset' | 'remove';
  deckName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeckActionDialog({ action, deckName, onConfirm, onCancel }: DeckActionDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    cancelRef.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const reset = action === 'reset';
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal deck-action-dialog" role="dialog" aria-modal="true"
        aria-labelledby="deck-action-title" aria-describedby="deck-action-description"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.stopPropagation(); onCancel(); }
          if (event.key === 'Tab') {
            event.preventDefault();
            (document.activeElement === cancelRef.current ? confirmRef : cancelRef).current?.focus();
          }
        }}>
        <h2 id="deck-action-title">{reset ? 'Reset layout?' : 'Remove deck?'}</h2>
        <p id="deck-action-description">{reset
          ? `Arrange “${deckName}” into its default rows and stacks? This replaces your current card positions. Cards, boards and variants are kept.`
          : `Remove “${deckName}” from your saved decks and canvas? It will disappear from both Decks and Added. Export it first if you want a copy.`}</p>
        <div className="deck-active-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>Cancel</button>
          <button ref={confirmRef} type="button" onClick={onConfirm}>{reset ? 'Reset layout' : 'Remove deck'}</button>
        </div>
      </div>
    </div>
  );
}
