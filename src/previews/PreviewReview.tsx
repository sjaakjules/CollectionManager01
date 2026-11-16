import { useCallback, useEffect, useMemo, useState } from 'react';
import { isAvatarType, isSiteType } from '@/data/dataModels';
import { PreviewCardTile } from './PreviewCardTile';
import {
  announcedRelease, captureNames, captures, loadAppearanceCards, previewCards, reviewSet, trailerUrl,
  type PreviewCapture,
} from './previewReviewData';
import type { ZoomImage } from './ReviewCardArtwork';
import { ReviewCardDialog } from './ReviewCardDialog';
import { usePreviewReview } from './usePreviewReview';

export function PreviewReview({ editable }: { editable: boolean }) {
  const [cards, setCards] = useState(previewCards);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState<ZoomImage | null>(null);
  const dismissZoom = useCallback(() => setZoom(null), []);
  const { drafts, saveState, edit, flush, download } = usePreviewReview(editable);
  const saveOnBlur = useCallback(() => flush(), [flush]);
  const groups = useMemo(() => {
    const minions: PreviewCapture[] = [];
    const magics: PreviewCapture[] = [];
    const spells: PreviewCapture[] = [];
    const sites: PreviewCapture[] = [];
    const avatars: PreviewCapture[] = [];
    for (const capture of [...captures].sort((a, b) => a.cardName.localeCompare(b.cardName, 'en'))) {
      const type = cards.get(capture.cardName)?.guardian.type ?? '';
      if (type === 'Minion') minions.push(capture);
      else if (type === 'Magic') magics.push(capture);
      else if (isSiteType(type)) sites.push(capture);
      else if (isAvatarType(type)) avatars.push(capture);
      else spells.push(capture);
    }
    return [
      { title: 'Minions', entries: minions },
      { title: 'Magic and other spells', entries: [...magics, ...spells] },
      { title: 'Sites', entries: sites },
      { title: 'Avatars', entries: avatars },
    ];
  }, [cards]);

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
  const openCardChanges = zoom && editable ? drafts.get(zoom.capture.cardName) : undefined;
  const editorStatus = saveState === 'unavailable' ? 'Autosave unavailable'
    : saveState === 'saving' ? 'Saving…' : openCardChanges ? 'Saved in this browser' : '';

  return (
    <>
      <header className="review-header">
        <a href="/">Open Sorcery Stacks</a>
        <h1>{reviewSet}</h1>
        <p>{captures.length} preview images · {captureNames.length} cards · Announced for {announcedRelease}</p>
        <p id="review-image-help">
          Hover left to right to compare source frames. Open a card to see the larger image and its details.
          <span className="review-visually-hidden"> With the image focused, use the left and right arrow keys to select a frame.</span>
        </p>
        {editable && <p>Edit in the enlarged card view. Changes save in this browser and can be downloaded.</p>}
      </header>
      {editable && (
        <div className="review-toolbar" onBlur={saveOnBlur}>
          <span className={saveState === 'unavailable' ? 'review-save-error' : ''} role="status">{status}</span>
          <button type="button" disabled={count === 0} onClick={download}>Download edits</button>
        </div>
      )}
      <main aria-label="Trailer cards">
        {groups.map(({ title, entries }) => entries.length > 0 && (
          <section className="review-section" key={title} aria-label={title}>
            <h2>{title}</h2>
            <div className="review-grid">
              {entries.map((capture) => (
                <PreviewCardTile
                  key={capture.output}
                  capture={capture}
                  card={cards.get(capture.cardName)}
                  changes={editable ? drafts.get(capture.cardName) : undefined}
                  onZoom={setZoom}
                />
              ))}
            </div>
          </section>
        ))}
      </main>
      <footer className="review-footer">
        <p>Images come from the <a href={trailerUrl}>official trailer</a>. Some titles and print details are still unconfirmed.</p>
      </footer>
      {zoom && (
        <ReviewCardDialog
          selection={zoom}
          card={cards.get(zoom.capture.cardName)}
          changes={openCardChanges}
          editable={editable}
          loading={loading}
          saveStatus={editorStatus}
          onEdit={edit}
          onFlush={saveOnBlur}
          onDismiss={dismissZoom}
        />
      )}
    </>
  );
}
