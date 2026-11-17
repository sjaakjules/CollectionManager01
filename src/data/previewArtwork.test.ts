import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeCardCatalog } from './cardCatalog';
import { provisionalCards, withProvisionalCards } from './provisionalCards';
import { hasPreviewArtwork } from './previewArtwork';
import { required } from '@/utils/required';

describe('preview artwork marking', () => {
  const official = normalizeCardCatalog(JSON.parse(readFileSync('docs/Sorcery_CardInfo.json', 'utf8'))).cards;
  it('marks video-only Baldassare cards and excludes all 120 released duel-deck cards', () => {
    const cards = withProvisionalCards(official);
    expect(cards.filter(hasPreviewArtwork).map(card => card.name).sort()).toEqual(provisionalCards.map(card => card.name).sort());
    const released = cards.filter(card => card.sets.some(set => set.name === 'Frost Mage Vs. Lavamancer'));
    expect(released).toHaveLength(120);
    expect(released.some(hasPreviewArtwork)).toBe(false);
    expect(cards.find(card => card.name === 'The White Death')?.provisional).toBeDefined();
    expect(hasPreviewArtwork(cards.find(card => card.name === 'The White Death'))).toBe(false);
    expect(hasPreviewArtwork(undefined)).toBe(false);
  });
  it('exempts a preview as soon as its released set is present, and retires the marking when official metadata arrives', () => {
    const preview = required(provisionalCards[0]);
    expect(hasPreviewArtwork({ ...preview, sets: [...preview.sets, {
      name: 'Frost Mage vs Lavamancer', metadata: preview.guardian, releasedAt: '2026-11-01', variants: [],
    }] })).toBe(false);
    expect(hasPreviewArtwork({ ...preview, provisional: undefined })).toBe(false);
  });
});
