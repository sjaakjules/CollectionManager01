import type { Card } from './dataModels';

/** Only video-sourced artwork needs a watermark; an unconfirmed set appearance
 * alone does not make an existing official image a preview. */
export function hasPreviewArtwork(card: Card | null | undefined): boolean {
  if (!card?.provisional) return false;
  const releasedInDuelDecks = card.sets.some(set =>
    set.name.toLowerCase().replace(/[^a-z0-9]/g, '') === 'frostmagevslavamancer');
  if (releasedInDuelDecks) return false;
  const uncertain = card.provisional.uncertainFields;
  return !(uncertain.length === 1 && uncertain[0] === 'set');
}
