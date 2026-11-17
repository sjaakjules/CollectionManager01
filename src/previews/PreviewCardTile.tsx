import { memo } from 'react';
import type { Card } from '@/data/dataModels';
import { hasPreviewArtwork } from '@/data/previewArtwork';
import { ReviewCardArtwork, type ZoomImage } from './ReviewCardArtwork';
import { illustrationFor, type PreviewCapture, type ReviewFields } from './previewReviewData';

interface PreviewCardTileProps {
  capture: PreviewCapture;
  card: Card | undefined;
  changes: Partial<ReviewFields> | undefined;
  onZoom: (image: ZoomImage) => void;
}

export const PreviewCardTile = memo(function PreviewCardTile({ capture, card, changes, onZoom }: PreviewCardTileProps) {
  const title = changes?.name?.trim() || capture.cardName;
  const illustration = illustrationFor(capture);
  const rulesText = changes?.rulesText ?? card?.guardian.rulesText;

  return (
    <figure className="review-tile" data-card={capture.cardName}>
      <ReviewCardArtwork capture={capture} title={title} illustration={illustration}
        isPreview={hasPreviewArtwork(card)} onZoom={onZoom} />
      <figcaption>
        <h3 className="review-title">
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={(event) => onZoom({ capture, opener: event.currentTarget })}
          >
            {title}
            {illustration && <span className="review-illustration">{illustration}</span>}
          </button>
        </h3>
        {rulesText && <p className="review-effect">{rulesText}</p>}
      </figcaption>
    </figure>
  );
});
