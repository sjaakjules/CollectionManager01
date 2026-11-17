import { normalizeCardCatalog } from '@/data/cardCatalog';
import imageVersions from '@/data/cardImageVersions.json';
import type { Card } from '@/data/dataModels';
import { provisionalCards, withProvisionalCards } from '@/data/provisionalCards';
import comparisonFrames from '../../offlineData/card-previews/baldassares-travels/comparison-frames.json';
import comparisonSequences from '../../offlineData/card-previews/baldassares-travels/comparison-sequences.json';
import galleryImageVersions from '../../offlineData/card-previews/baldassares-travels/gallery-image-versions.json';
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

export const thresholdFields = ['air', 'earth', 'fire', 'water'] as const;
export const fieldKeys = [
  'name', 'rulesText', 'cost', 'power', 'life', ...thresholdFields,
  'type', 'typeText', 'subTypes', 'rarity', 'flavorText', 'artist',
] as const;
export type FieldKey = typeof fieldKeys[number];
export type ReviewFields = Record<FieldKey, string>;

export function fieldsForCard(cardName: string, card: Card | undefined): ReviewFields {
  const attack = card?.guardian.attack ?? null;
  const defence = card?.guardian.defence ?? null;
  const printing = card?.sets.find((set) => set.name === reviewSet)?.variants[0]
    ?? card?.sets[0]?.variants[0];
  const thresholds = card?.guardian.thresholds;
  const threshold = (element: typeof thresholdFields[number]) => {
    if (card?.provisional?.uncertainFields.includes('thresholds') && !thresholds?.[element]) return '';
    return String(thresholds?.[element] ?? '');
  };
  return {
    name: cardName,
    rulesText: card?.guardian.rulesText ?? '',
    cost: String(card?.guardian.cost ?? ''),
    power: defence === null ? String(attack ?? '') : `${attack ?? ''}/${defence}`,
    life: String(card?.guardian.life ?? ''),
    air: threshold('air'),
    earth: threshold('earth'),
    fire: threshold('fire'),
    water: threshold('water'),
    type: card?.guardian.type ?? '',
    typeText: printing?.typeText ?? '',
    subTypes: card?.subTypes ?? '',
    rarity: card?.guardian.rarity ?? '',
    flavorText: printing?.flavorText ?? '',
    artist: printing?.artist ?? '',
  };
}

export function illustrationFor(capture: PreviewCapture): string {
  const prefix = `${capture.cardName} - `;
  return capture.name.startsWith(prefix) ? capture.name.slice(prefix.length) : '';
}

export function reviewImageUrl(capture: PreviewCapture): string {
  const url = capture.output.replace(/^public\//u, '/');
  const slug = url.split('/').at(-1)?.replace(/\.webp$/u, '') ?? '';
  const versions: Readonly<Record<string, string>> = imageVersions;
  const galleryVersions: Readonly<Record<string, string>> = galleryImageVersions;
  const version = url.startsWith('/assets/Cards/') ? versions[slug] : galleryVersions[url];
  return version ? `${url}?v=${version}` : url;
}

export function reviewSourceFrames(capture: PreviewCapture): GalleryFrame[] {
  const urls: Readonly<Record<string, string>> = comparisonFrames;
  const sequences: Readonly<Record<string, GalleryFrame[]>> = comparisonSequences;
  const originals = [capture, ...(capture.layers ?? [])]
    .flatMap(({ source, timestampSeconds }) => {
      const url = urls[source];
      return url ? [{ url, timestampSeconds }] : [];
    });
  const frames = new Map(
    [...originals, ...(sequences[capture.cardName] ?? [])].map((frame) =>
      [Math.round(frame.timestampSeconds * manifest.video.framesPerSecond), frame]),
  );
  return [...frames.values()].sort((first, second) => first.timestampSeconds - second.timestampSeconds);
}

/** Resolve official cards and previews using the same precedence as the catalogue. */
export async function loadReviewCards(): Promise<Map<string, Card>> {
  const nameKey = (name: string) => name.trim().normalize('NFC').toLowerCase();
  const names = new Set(captureNames.map(nameKey));
  const response = await fetch('/assets/sorcery_cards.json');
  if (!response.ok) throw new Error('Could not load the bundled card catalogue');
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('The bundled card catalogue is not an array');
  const selected = payload.filter((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('name' in entry)) return false;
    return typeof entry.name === 'string' && names.has(nameKey(entry.name));
  });
  const { cards } = normalizeCardCatalog(selected);
  const catalogue = new Map(withProvisionalCards(cards).map((card) => [nameKey(card.name), card]));
  return new Map(captureNames.flatMap((name): [string, Card][] => {
    const card = catalogue.get(nameKey(name));
    return card ? [[name, card]] : [];
  }));
}
