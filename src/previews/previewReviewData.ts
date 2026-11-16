import { normalizeCardCatalog } from '@/data/cardCatalog';
import imageVersions from '@/data/cardImageVersions.json';
import type { Card } from '@/data/dataModels';
import { provisionalCards } from '@/data/provisionalCards';
import comparisonFrames from '../../offlineData/card-previews/baldassares-travels/comparison-frames.json';
import manifest from '../../offlineData/card-previews/baldassares-travels/manifest.json';

interface Frame {
  source: string;
  timestampSeconds: number;
}

export interface GalleryFrame {
  url: string;
  timestampSeconds: number;
}

export interface PreviewCapture extends Frame {
  name: string;
  cardName: string;
  output: string;
  landscape: boolean;
  notes: string[];
  layers?: Frame[];
}

export const reviewSet = manifest.setName;
export const trailerUrl = manifest.video.url;
export const announcedRelease = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'long',
  timeZone: 'UTC',
}).format(new Date(manifest.announcedRelease));
export const captures: PreviewCapture[] = manifest.images;
export const captureNames = [...new Set(captures.map((capture) => capture.cardName))];
export const previewCards = new Map(provisionalCards.map((card) => [card.name, card]));

export const fieldKeys = ['name', 'rulesText', 'cost', 'power', 'flavorText'] as const;
export type FieldKey = typeof fieldKeys[number];
export type ReviewFields = Record<FieldKey, string>;

export function fieldsForCard(cardName: string, card: Card | undefined): ReviewFields {
  const attack = card?.guardian.attack ?? null;
  const defence = card?.guardian.defence ?? null;
  const printing = card?.sets.find((set) => set.name === reviewSet)?.variants[0]
    ?? card?.sets[0]?.variants[0];
  return {
    name: cardName,
    rulesText: card?.guardian.rulesText ?? '',
    cost: String(card?.guardian.cost ?? ''),
    power: defence === null ? String(attack ?? '') : `${attack ?? ''}/${defence}`,
    flavorText: printing?.flavorText ?? '',
  };
}

export function reviewImageUrl(capture: PreviewCapture): string {
  const url = capture.output.replace(/^public\//u, '/');
  const slug = url.split('/').at(-1)?.replace(/\.webp$/u, '') ?? '';
  const versions: Readonly<Record<string, string>> = imageVersions;
  return url.startsWith('/assets/Cards/') && versions[slug] ? `${url}?v=${versions[slug]}` : url;
}

export function reviewSourceFrames(capture: PreviewCapture): GalleryFrame[] {
  const urls: Readonly<Record<string, string>> = comparisonFrames;
  return [capture, ...(capture.layers ?? [])]
    .sort((first, second) => first.timestampSeconds - second.timestampSeconds)
    .flatMap(({ source, timestampSeconds }) => {
      const url = urls[source];
      return url ? [{ url, timestampSeconds }] : [];
    });
}

/** Fill existing-card appearances from the bundled snapshot, without an upstream request. */
export async function loadAppearanceCards(): Promise<Map<string, Card>> {
  const missing = new Set(captureNames.filter((name) => !previewCards.has(name)));
  if (missing.size === 0) return previewCards;
  const response = await fetch('/assets/sorcery_cards.json');
  if (!response.ok) throw new Error('Could not load the bundled card catalogue');
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('The bundled card catalogue is not an array');
  const selected = payload.filter((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('name' in entry)) return false;
    return typeof entry.name === 'string' && missing.has(entry.name);
  });
  const { cards } = normalizeCardCatalog(selected);
  return new Map([...previewCards, ...cards.map((card): [string, Card] => [card.name, card])]);
}
