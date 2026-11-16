import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { normalizeCardCatalog } from './cardCatalog';
import { provisionalCards, withProvisionalCards } from './provisionalCards';
import { canonicalCardName } from './catalogueMigrations';
import { importDeckFromText, exportDeckToText } from './importExport';

describe('official replacement of photographed cards', () => {
  it('covers every archived transcription with official data and no remaining overlays', async () => {
    const official = normalizeCardCatalog(JSON.parse(await readFile('docs/Sorcery_CardInfo.json', 'utf8'))).cards;
    const photos = JSON.parse(await readFile('offlineData/card-photos/2026-11-13/transcriptions.json', 'utf8')) as { cards: { card: { name: string } }[] };
    expect(photos.cards).toHaveLength(71);
    expect(provisionalCards).toEqual([]);
    expect(withProvisionalCards(official)).toEqual(official);
    for (const { card } of photos.cards) {
      const released = official.find(entry => entry.name === canonicalCardName(card.name));
      expect(released?.sets.some(set => set.name === 'Frost Mage Vs. Lavamancer')).toBe(true);
      expect(released?.provisional).toBeUndefined();
    }
    expect(official.find(card => card.name === 'Humming Hummocks')?.sets[0]?.variants[0]?.artist).toBe('Jeff A. Menges');
    expect(official.filter(card => card.sets.some(set => set.name === 'Frost Mage Vs. Lavamancer'))).toHaveLength(120);
  });

  it('loads both avatars and imports a photographed spelling into the official shared schema', async () => {
    const official = normalizeCardCatalog(JSON.parse(await readFile('docs/Sorcery_CardInfo.json', 'utf8'))).cards;
    expect(['Frost Mage', 'Lavamancer'].every(name => official.some(card => card.name === name && card.guardian.type === 'Avatar'))).toBe(true);
    const imported = importDeckFromText('// Avatar\n1 Frost Mage\n// Main\n2 Shatter\n1 Reed-cord Measurer', 'Preview saved deck', official);
    expect(imported.unknownCards).toEqual([]);
    expect(imported.deck.boards.avatar).toEqual([{ name: 'Frost Mage', quantity: 1 }]);
    expect(imported.deck.boards.mainboard).toContainEqual({ name: 'Reed Cord Measurer', quantity: 1 });
    const roundTrip = importDeckFromText(exportDeckToText(imported.deck), 'Round trip', official);
    expect(roundTrip.deck.boards).toEqual(imported.deck.boards);
    expect(JSON.stringify(imported.deck)).not.toContain('rulesText');
  });
});
