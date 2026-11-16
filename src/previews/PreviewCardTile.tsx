import { memo } from 'react';
import type { Card } from '@/data/dataModels';
import {
  fieldsForCard, reviewImageUrl, trailerUrl, type FieldKey, type PreviewCapture, type ReviewFields,
} from './previewReviewData';

interface PreviewCardTileProps {
  capture: PreviewCapture;
  card: Card | undefined;
  changes: Partial<ReviewFields> | undefined;
  editable: boolean;
  waitingForCard: boolean;
  onEdit: (name: string, field: FieldKey, value: string, original: string) => void;
  onBlur: () => void;
}

const uncertaintyLabels: Readonly<Record<string, string>> = {
  name: 'title',
  rulesText: 'ability text',
  attack: 'power',
  subTypes: 'subtypes',
  image: 'image',
  set: 'set appearance',
};

function frameLink(seconds: number): string {
  const url = new URL(trailerUrl);
  url.searchParams.set('t', `${Math.floor(seconds)}s`);
  return url.href;
}

export const PreviewCardTile = memo(function PreviewCardTile({
  capture, card, changes, editable, waitingForCard, onEdit, onBlur,
}: PreviewCardTileProps) {
  const original = fieldsForCard(capture.cardName, card);
  const fields = editable ? { ...original, ...changes } : original;
  const canEdit = editable && Boolean(card);
  const image = reviewImageUrl(capture);
  const title = fields.name.trim() || original.name;
  const art = capture.name.startsWith(`${capture.cardName} - `)
    ? capture.name.slice(capture.cardName.length + 3)
    : '';
  const uncertainty = card?.provisional?.uncertainFields.map((field) => uncertaintyLabels[field] ?? field) ?? [];
  const save = (field: FieldKey, value: string) => onEdit(capture.cardName, field, value, original[field]);
  const frames = [capture, ...(capture.layers ?? [])];

  const textField = (field: 'rulesText' | 'flavorText', label: string, rows: number) => (
    <label className="review-field">
      <span>{label}</span>
      {canEdit ? (
        <textarea
          name={field}
          rows={rows}
          value={fields[field]}
          placeholder="—"
          onChange={(event) => save(field, event.currentTarget.value)}
          onBlur={onBlur}
        />
      ) : <span className="review-value">{fields[field] || '—'}</span>}
    </label>
  );

  const statField = (field: 'cost' | 'power', label: string) => (
    <label className="review-field review-stat">
      <span>{label}</span>
      {canEdit ? (
        <input
          name={field}
          value={fields[field]}
          inputMode={field === 'cost' ? 'numeric' : undefined}
          placeholder="—"
          title={field === 'power' ? 'Power, or attack/defence for split power' : undefined}
          autoComplete="off"
          onChange={(event) => save(field, event.currentTarget.value)}
          onBlur={onBlur}
        />
      ) : <span className="review-value">{fields[field] || '—'}</span>}
    </label>
  );

  return (
    <figure className="review-tile" data-card={capture.cardName}>
      <a className="review-art" href={image} target="_blank" rel="noreferrer" aria-label={`Open full-size ${title}`}>
        <img
          src={image}
          alt={`${title}${art ? ` · ${art}` : ''} · trailer preview`}
          loading="lazy"
          decoding="async"
          width={capture.landscape ? 1039 : 744}
          height={capture.landscape ? 744 : 1039}
        />
      </a>
      <figcaption>
        <h2 className="review-title">
          {canEdit ? (
            <input
              className="review-name"
              name="name"
              aria-label="Card name"
              value={fields.name}
              placeholder={original.name}
              autoComplete="off"
              onChange={(event) => save('name', event.currentTarget.value)}
              onBlur={onBlur}
            />
          ) : <span>{title}</span>}
          {art && <span className="review-illustration">{art}</span>}
        </h2>
        <div className="review-fields">
          {textField('rulesText', 'Ability text', 2)}
          <div className="review-stats">
            {statField('cost', 'Cost')}
            {statField('power', 'Power')}
          </div>
          {textField('flavorText', 'Flavour', 1)}
        </div>
        {!card && <p className="review-capture-note">{waitingForCard ? 'Loading card details…' : 'Card details unavailable. Refresh to try again.'}</p>}
        <div className="review-card-links">
          <details>
            <summary>Source and notes</summary>
            {uncertainty.length > 0 && <p>Needs confirmation · {uncertainty.join(', ')}</p>}
            {capture.notes.map((note) => <p key={note}>{note}</p>)}
            {art && <p>All Treasure illustrations share the same card details.</p>}
            <ul>
              {frames.map(({ timestampSeconds }, index) => (
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
      </figcaption>
    </figure>
  );
});
