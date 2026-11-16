import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { Card } from '@/data/dataModels';
import type { ZoomImage } from './ReviewCardArtwork';
import {
  fieldsForCard, illustrationFor, reviewImageUrl, reviewSourceFrames, thresholdFields, trailerUrl,
  type FieldKey, type ReviewFields,
} from './previewReviewData';

interface ReviewCardDialogProps {
  selection: ZoomImage;
  card: Card | undefined;
  changes: Partial<ReviewFields> | undefined;
  editable: boolean;
  loading: boolean;
  saveStatus: string;
  onEdit: (name: string, field: FieldKey, value: string, original: string) => void;
  onFlush: () => void;
  onDismiss: () => void;
}

interface ReviewFieldProps {
  field: FieldKey;
  label: string;
  value: string;
  update?: (field: FieldKey, value: string) => void;
  numeric?: boolean;
  rows?: number;
  hint?: string;
}

function ReviewField({ field, label, value, update, numeric, rows, hint }: ReviewFieldProps) {
  return (
    <label className="review-field">
      <span>{label}</span>
      {update ? (
        rows ? (
          <textarea name={field} rows={rows} value={value} placeholder="—"
            onChange={(event) => update(field, event.currentTarget.value)} />
        ) : (
          <input name={field} value={value} inputMode={numeric ? 'numeric' : undefined}
            autoComplete="off" placeholder="—" title={hint}
            onChange={(event) => update(field, event.currentTarget.value)} />
        )
      ) : <span className="review-value">{value || '—'}</span>}
    </label>
  );
}

const uncertaintyLabels: Readonly<Record<string, string>> = {
  name: 'title', rulesText: 'ability text', attack: 'power', typeText: 'printed type line',
  subTypes: 'subtypes', image: 'image', set: 'set appearance',
};
const elementLabels = { air: 'Air', earth: 'Earth', fire: 'Fire', water: 'Water' };

function frameLink(seconds: number): string {
  const url = new URL(trailerUrl);
  url.searchParams.set('t', `${Math.floor(seconds)}s`);
  return url.href;
}

export function ReviewCardDialog({
  selection, card, changes, editable, loading, saveStatus, onEdit, onFlush, onDismiss,
}: ReviewCardDialogProps) {
  const { capture, opener, initialFrameUrl } = selection;
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const [frameUrl, setFrameUrl] = useState(initialFrameUrl ?? '');
  const original = fieldsForCard(capture.cardName, card);
  const fields = { ...original, ...changes };
  const title = fields.name.trim() || original.name;
  const illustration = illustrationFor(capture);
  const image = reviewImageUrl(capture);
  const frames = reviewSourceFrames(capture);
  const uncertainty = card?.provisional?.uncertainFields.map((field) => uncertaintyLabels[field] ?? field) ?? [];

  useLayoutEffect(() => {
    const modal = dialog.current;
    if (!modal) return;
    modal.showModal();
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      modal.close();
      opener.focus({ preventScroll: true });
    };
  }, [opener]);

  const dismiss = () => {
    onFlush();
    onDismiss();
  };
  const update = editable && card
    ? (field: FieldKey, value: string) => onEdit(capture.cardName, field, value, original[field])
    : undefined;
  const field = (key: FieldKey, label: string, options?: Pick<ReviewFieldProps, 'numeric' | 'rows' | 'hint'>) =>
    <ReviewField key={key} field={key} label={label} value={fields[key]} update={update} {...options} />;

  return (
    <dialog
      ref={dialog}
      className="review-dialog"
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}
      onWheel={(event) => { if (event.target === event.currentTarget) dismiss(); }}
      onTouchMove={(event) => { if (event.target === event.currentTarget) dismiss(); }}
    >
      <article className="review-dialog-panel">
        <header className="review-dialog-header">
          <h2 id={headingId}>{title}{illustration && <span className="review-illustration">{illustration}</span>}</h2>
          <div className="review-dialog-actions">
            {editable && <span role="status">{saveStatus}</span>}
            <button ref={closeButton} type="button" className="review-dialog-close" aria-label="Close card details" onClick={dismiss}>
              ×
            </button>
          </div>
        </header>
        <div className="review-dialog-body">
          <div className="review-dialog-art">
            <img src={frameUrl || image} alt={illustration ? `${title} · ${illustration}` : title}
              width={capture.landscape ? 1039 : 744} height={capture.landscape ? 744 : 1039} />
            <label className="review-frame-choice">
              <span>Image</span>
              <select value={frameUrl} onChange={(event) => setFrameUrl(event.currentTarget.value)}>
                <option value="">Finished image</option>
                {frames.map(({ url, timestampSeconds }, index) => (
                  <option key={url} value={url}>Frame {index + 1} of {frames.length} · {timestampSeconds}s</option>
                ))}
              </select>
            </label>
          </div>
          <div className="review-fields" onBlur={onFlush}>
            {field('name', 'Name')}
            {field('rulesText', 'Ability text', { rows: 4 })}
            <div className="review-stats">
              {field('cost', 'Cost', { numeric: true })}
              {field('power', 'Power', { hint: 'Power, or attack/defence for split power' })}
              {field('life', 'Life', { numeric: true })}
            </div>
            <fieldset className="review-thresholds">
              <legend>Threshold</legend>
              <div className="review-elements">
                {thresholdFields.map((element) => field(element, elementLabels[element], { numeric: true }))}
              </div>
            </fieldset>
            {field('typeText', 'Printed type line')}
            <div className="review-print-details">
              {field('type', 'Card type')}
              {field('rarity', 'Rarity')}
            </div>
            {field('subTypes', 'Subtypes')}
            {field('flavorText', 'Flavour', { rows: 2 })}
            {field('artist', 'Artist')}
            {!card && <p className="review-capture-note">{loading ? 'Loading card details…' : 'Card details unavailable. Refresh to try again.'}</p>}
            <div className="review-card-links">
              <details>
                <summary>Source and notes</summary>
                {uncertainty.length > 0 && <p>Needs confirmation · {uncertainty.join(', ')}</p>}
                {capture.notes.map((note) => <p key={note}>{note}</p>)}
                {illustration && <p>All Treasure illustrations share the same card details.</p>}
                <ul>
                  {[capture, ...(capture.layers ?? [])].map(({ timestampSeconds }, index) => (
                    <li key={timestampSeconds}>
                      <a href={frameLink(timestampSeconds)} target="_blank" rel="noreferrer">
                        {index === 0 ? 'Source' : 'Detail'} frame at {timestampSeconds}s
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
              <a className="review-webp" href={image} download>Save WebP</a>
            </div>
          </div>
        </div>
      </article>
    </dialog>
  );
}
