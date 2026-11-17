import type { Card } from '@/data/dataModels';
import { hasPreviewArtwork } from '@/data/previewArtwork';

/** Real text supplements the source image; it never disguises missing lettering. */
export function PreviewCardText({ card }: { card: Card | null | undefined }) {
  if (!card || !hasPreviewArtwork(card)) return null;
  const uncertain = card.provisional?.uncertainFields ?? [];
  const rules = card.guardian.rulesText.trim();
  return <aside className="card-hover-transcription" aria-label={`Readable preview text for ${card.name}`}>
    <span className="card-transcription-heading">Readable preview text</span>
    <h3>{card.name}</h3>
    {uncertain.includes('name') && <p className="card-transcription-note">Title unconfirmed.</p>}
    <p className="card-transcription-rules">{rules || 'Ability text has not been confirmed from the footage.'}</p>
    <p className="card-transcription-note">{uncertain.includes('rulesText')
      ? 'Partial or unconfirmed transcription. Check the source image.'
      : 'Reviewed transcription from the trailer. Preview details may change.'}</p>
  </aside>;
}
