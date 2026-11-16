import { useCallback, useEffect, useState } from 'react';
import { PreviewCardTile } from './PreviewCardTile';
import { announcedRelease, captureNames, captures, loadAppearanceCards, previewCards, reviewSet, trailerUrl } from './previewReviewData';
import { usePreviewReview } from './usePreviewReview';

export function PreviewReview({ editable }: { editable: boolean }) {
  const [cards, setCards] = useState(previewCards);
  const [loading, setLoading] = useState(true);
  const { drafts, saveState, edit, flush, download } = usePreviewReview(editable);
  const saveOnBlur = useCallback(() => flush(), [flush]);

  useEffect(() => {
    let active = true;
    void loadAppearanceCards()
      .then((catalogue) => { if (active) setCards(catalogue); })
      .catch((error: unknown) => { if (active) console.warn('Preview card details unavailable', error); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const count = drafts.size;
  const saved = `${count} edited ${count === 1 ? 'card' : 'cards'} saved`;
  const status = saveState === 'unavailable'
    ? 'Autosave unavailable. Download edits to keep a copy.'
    : saveState === 'saving' ? 'Saving changes…' : count > 0 ? saved : 'No edits yet';

  return (
    <>
      <header className="review-header">
        <a href="/">Open Sorcery Stacks</a>
        <h1>{reviewSet}</h1>
        <p>{captures.length} preview images · {captureNames.length} cards · Announced for {announcedRelease}</p>
        {editable && <p>Click a title or field to edit it. Changes save in this browser. Download the edits when you’re ready to hand them back.</p>}
      </header>
      {editable && (
        <div className="review-toolbar" onBlur={saveOnBlur}>
          <span className={saveState === 'unavailable' ? 'review-save-error' : ''} role="status">{status}</span>
          <button type="button" disabled={count === 0} onClick={download}>Download edits</button>
        </div>
      )}
      <main className="review-grid" aria-label="Trailer cards">
        {captures.map((capture) => (
          <PreviewCardTile
            key={capture.output}
            capture={capture}
            card={cards.get(capture.cardName)}
            changes={drafts.get(capture.cardName)}
            editable={editable}
            waitingForCard={loading}
            onEdit={edit}
            onBlur={saveOnBlur}
          />
        ))}
      </main>
      <footer className="review-footer">
        <p>Images come from the <a href={trailerUrl}>official trailer</a>. Some titles and print details are still unconfirmed.</p>
      </footer>
    </>
  );
}
