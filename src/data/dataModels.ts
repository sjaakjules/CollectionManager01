/**
 * Core data models for Sorcery Collection Manager
 *
 * These types define the contract for:
 * - Card data from the Sorcery API
 * - User data stored in guest.json / username.json
 * - Deck and collection structures
 *
 * Related files:
 * - `src/app/AppState.ts` (state contracts and reducer payloads)
 * - `src/data/importExport.ts` (deck serialization/parsing)
 * - `src/rules/deckRules.ts` (deck validation logic)
 */

// ============================================================================
// Card Data Types (from Sorcery API)
// ============================================================================

export type CardRarity = 'Ordinary' | 'Exceptional' | 'Elite' | 'Unique';

export type CardType = 'Minion' | 'Magic' | 'Aura' | 'Artifact' | 'Site' | 'Avatar';

export type Element = 'Air' | 'Earth' | 'Fire' | 'Water';

export interface Thresholds {
  air: number;
  earth: number;
  fire: number;
  water: number;
}

export interface CardStats {
  rarity: CardRarity;
  type: CardType;
  rulesText: string;
  cost: number;
  attack: number | null;
  defence: number | null;
  life: number | null;
  thresholds: Thresholds;
}

export interface CardVariant {
  slug: string;
  finish: 'Standard' | 'Foil';
  product: string;
  artist: string;
  flavorText: string;
  typeText: string;
}

export interface CardSet {
  name: string;
  releasedAt: string;
  metadata: CardStats;
  variants: CardVariant[];
}

export interface Card {
  name: string;
  guardian: CardStats;
  elements: string;
  subTypes: string;
  sets: CardSet[];
}

// ============================================================================
// Derived Card Types (for rendering and grouping)
// ============================================================================

export type ThresholdGroup = 'air' | 'earth' | 'fire' | 'water' | 'multiple' | 'none';

export interface CardDisplayInfo {
  name: string;
  type: CardType;
  rarity: CardRarity;
  cost: number;
  thresholdGroup: ThresholdGroup;
  isLandscape: boolean;
  defaultVariantSlug: string;
}

// ============================================================================
// Deck Types
// ============================================================================

export interface DeckCard {
  name: string;
  quantity: number;
}

export interface DeckBoards {
  mainboard: DeckCard[];
  sideboard: DeckCard[];
  avatar: DeckCard[];
  maybeboard: DeckCard[];
}

export interface Deck {
  id: string;
  name: string;
  author?: string;
  boards: DeckBoards;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Collection Types
// ============================================================================

export interface CollectionItem {
  name: string;
  quantity: number;
}

// ============================================================================
// Canvas Types
// ============================================================================

export interface CanvasLabel {
  id: string;
  text: string;
  x: number;
  y: number;
}

export type { CardCategoryData } from '@/data/cardCategories';

// ============================================================================
// User Data Types (stored in guest.json / username.json)
// ============================================================================

export interface UserData {
  name: string;
  id: string;
  decks: Deck[];
  collection: CollectionItem[];
  selectedCardCategory?: string | null;
  cardCategories?: import('@/data/cardCategories').CardCategoryData;
  favouriteDeckIds?: string[];
  canvasLabels?: CanvasLabel[];
  canvasAreas?: import('@/canvas/canvasAreas').CanvasArea[];
}

// ============================================================================
// App State Types
// ============================================================================

export type ActiveBoard = 'mainboard' | 'sideboard' | 'avatar' | 'maybeboard';

export interface DeckEditorState {
  activeDeckId: string | null;
  activeBoard: ActiveBoard;
}

// ============================================================================
// Deck Limits (from PDR)
// ============================================================================

export const DECK_LIMITS = {
  AVATAR_COUNT: 1,
  SPELL_COUNT: 60,
  SITE_COUNT: 30,
  SIDEBOARD_COUNT: 10,
  RARITY_LIMITS: {
    Ordinary: 4,
    Exceptional: 3,
    Elite: 2,
    Unique: 1,
  },
} as const;

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new empty deck skeleton.
 *
 * Inputs:
 * - `name`: Deck display name.
 * - `id`: Stable deck identifier.
 *
 * Outputs:
 * - Returns initialized `Deck` with empty boards and timestamps.
 */
export function createEmptyDeck(name: string, id: string): Deck {
  const now = new Date().toISOString();
  return {
    id,
    name,
    boards: {
      mainboard: [],
      sideboard: [],
      avatar: [],
      maybeboard: [],
    },
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Create default guest user data for first-time/offline sessions.
 *
 * Inputs:
 * - `id`: Guest user id.
 *
 * Outputs:
 * - Returns initialized `UserData` with empty collections/decks.
 */
export function createGuestUserData(id: string): UserData {
  return {
    name: 'Guest',
    id,
    decks: [],
    collection: [],
    selectedCardCategory: null,
    favouriteDeckIds: [],
    canvasLabels: [],
    canvasAreas: [],
  };
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check whether a card type belongs to spell-style boards.
 *
 * Inputs:
 * - `type`: Card type to test.
 *
 * Outputs:
 * - Returns `true` for non-site, non-avatar card types.
 */
export function isSpellType(type: CardType): boolean {
  return type !== 'Site' && type !== 'Avatar';
}

/**
 * Check whether a card type is a site.
 *
 * Inputs:
 * - `type`: Card type to test.
 *
 * Outputs:
 * - Returns `true` when type is `Site`.
 */
export function isSiteType(type: CardType): boolean {
  return type === 'Site';
}

/**
 * Check whether a card type is an avatar.
 *
 * Inputs:
 * - `type`: Card type to test.
 *
 * Outputs:
 * - Returns `true` when type is `Avatar`.
 */
export function isAvatarType(type: CardType): boolean {
  return type === 'Avatar';
}

// ============================================================================
// Threshold Helpers
// ============================================================================

/**
 * Collapse elemental thresholds into a UI-friendly threshold group.
 *
 * Inputs:
 * - `thresholds`: Element thresholds from card guardian stats.
 *
 * Outputs:
 * - Returns one of `air|earth|fire|water|multiple|none`.
 */
export function getThresholdGroup(thresholds: Thresholds): ThresholdGroup {
  const active: Element[] = [];

  if (thresholds.air > 0) active.push('Air');
  if (thresholds.earth > 0) active.push('Earth');
  if (thresholds.fire > 0) active.push('Fire');
  if (thresholds.water > 0) active.push('Water');

  if (active.length === 0) return 'none';
  if (active.length > 1) return 'multiple';

  const [onlyElement] = active;
  if (!onlyElement) return 'none';
  return onlyElement.toLowerCase() as ThresholdGroup;
}
