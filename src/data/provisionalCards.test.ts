import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { normalizeCardCatalog } from './cardCatalog';
import { provisionalCards, withProvisionalCards } from './provisionalCards';
import { canonicalCardName } from './catalogueMigrations';
import { importDeckFromText, exportDeckToText } from './importExport';

describe('official replacement of photographed cards', () => {
  it('covers every archived winter transcription with official rules', async () => {
    const official = normalizeCardCatalog(JSON.parse(await readFile('docs/Sorcery_CardInfo.json', 'utf8'))).cards;
    const photos = JSON.parse(await readFile('offlineData/card-photos/2026-11-13/transcriptions.json', 'utf8')) as { cards: { card: { name: string } }[] };
    expect(photos.cards).toHaveLength(71);
    expect(provisionalCards.some(card => card.sets.some(set => set.name === 'Frost Mage Vs. Lavamancer'))).toBe(false);
    const supplemented = withProvisionalCards(official);
    for (const { card } of photos.cards) {
      const released = official.find(entry => entry.name === canonicalCardName(card.name));
      expect(released?.sets.some(set => set.name === 'Frost Mage Vs. Lavamancer')).toBe(true);
      expect(released?.provisional).toBeUndefined();
      expect(supplemented.find(entry => entry.name === released?.name)?.guardian).toEqual(released?.guardian);
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

describe("Baldassare's Travels trailer previews", () => {
  const setName = "Baldassare's Travels";
  const loadOfficial = async () => normalizeCardCatalog(JSON.parse(await readFile('docs/Sorcery_CardInfo.json', 'utf8'))).cards;

  it('adds one record per identity, keeps uncertain fields explicit and is idempotent', async () => {
    const official = await loadOfficial();
    const result = withProvisionalCards(official);
    expect(provisionalCards).toHaveLength(43);
    expect(result).toHaveLength(official.length + 43);
    expect(result.filter(card => card.sets.some(set => set.name === setName))).toHaveLength(44);
    expect(new Set(result.map(card => card.name)).size).toBe(result.length);
    expect(withProvisionalCards(result)).toEqual(result);
    expect(result.filter(card => card.name.startsWith('Unidentified '))).toHaveLength(3);
    expect(result.find(card => card.name === 'Treasure')?.sets[0]?.variants).toHaveLength(8);
    expect(result.find(card => card.name === 'Nellie Bly')).toMatchObject({
      guardian: { cost: null, rarity: null, rulesText: '' },
      provisional: { uncertainFields: expect.arrayContaining(['cost', 'rulesText', 'image']) },
    });
    expect(result.find(card => card.name === 'Broadside')).toMatchObject({
      guardian: { rulesText: '' }, provisional: { uncertainFields: expect.arrayContaining(['rulesText', 'image']) },
    });
    expect(official.every(card => !card.provisional)).toBe(true);
  });

  it('retains official rules for a trailer appearance and retires that association when the set arrives', async () => {
    const official = await loadOfficial();
    const whiteDeath = official.find(card => card.name === 'The White Death');
    if (!whiteDeath) throw new Error('Missing official White Death fixture');
    const preview = withProvisionalCards([whiteDeath]).find(card => card.name === whiteDeath.name);
    const previewSet = preview?.sets.at(-1);
    if (!preview || !previewSet) throw new Error('Missing trailer appearance');
    expect(preview.guardian).toBe(whiteDeath.guardian);
    expect(preview.sets.slice(0, -1)).toEqual(whiteDeath.sets);
    expect(preview.provisional?.uncertainFields).toEqual(['set']);
    const released = { ...whiteDeath, guardian: { ...whiteDeath.guardian, rulesText: 'Latest official rules.' },
      sets: [...whiteDeath.sets, { ...previewSet, name: 'Baldassares Travels' }] };
    expect(withProvisionalCards([released]).find(card => card.name === released.name)).toBe(released);
  });

  it('prefers corrected official text, stats and printings for every newly released name', () => {
    for (const preview of provisionalCards) {
      const base = { ...preview };
      delete base.provisional;
      const previewSet = base.sets[0];
      if (!previewSet) throw new Error('Missing preview set');
      const official = { ...base, name: ` ${base.name.toUpperCase()} `,
        guardian: { ...base.guardian, cost: 9, rulesText: 'Official replacement.' },
        sets: [{ ...previewSet, name: setName }] };
      const result = withProvisionalCards([official]);
      expect(result.filter(card => card.name.trim().toLowerCase() === base.name.toLowerCase())).toEqual([official]);
      expect(result[0]?.provisional).toBeUndefined();
    }
  });

  it('supports preview avatars, sites, spells and tokens through all four saved boards', async () => {
    const catalog = withProvisionalCards(await loadOfficial());
    const text = '// Avatar\n1 Unidentified Avatar (BT trailer)\n// Main\n1 Guard Post\n1 Flying Machines\n1 A Very Little House\n// Collection\n2 Treasure\n// Maybe\n1 Broadside';
    const imported = importDeckFromText(text, 'Trailer deck', catalog);
    expect(imported.unknownCards).toEqual([]);
    expect(imported.deck.boards.avatar).toEqual([{ name: 'Unidentified Avatar (BT trailer)', quantity: 1 }]);
    expect(imported.deck.boards.mainboard).toEqual(expect.arrayContaining([
      { name: 'Grand Heist', quantity: 1 },
      { name: 'Flying Machine', quantity: 1 },
      { name: 'A Very Little House', quantity: 1 },
    ]));
    expect(imported.deck.boards.collection).toEqual([{ name: 'Treasure', quantity: 2 }]);
    expect(imported.deck.boards.maybeboard).toEqual([{ name: 'Broadside', quantity: 1 }]);
    expect(importDeckFromText(exportDeckToText(imported.deck), 'Round trip', catalog).deck.boards).toEqual(imported.deck.boards);
    expect(JSON.stringify(imported.deck)).not.toMatch(/rulesText|provisional|thresholds|source/);
  });
});
