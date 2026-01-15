/**
 * Core data models for Sorcery Collection Manager
 *
 * These types define the contract for:
 * - Card data from the Sorcery API
 * - User data stored in guest.json / username.json
 * - Deck and collection structures
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
// User Data Types (stored in guest.json / username.json)
// ============================================================================

export interface UserData {
  name: string;
  id: string;
  decks: Deck[];
  collection: CollectionItem[];
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

export function createGuestUserData(id: string): UserData {
  return {
    name: 'Guest',
    id,
    decks: [],
    collection: [],
  };
}

// ============================================================================
// Type Guards
// ============================================================================

export function isSpellType(type: CardType): boolean {
  return type !== 'Site' && type !== 'Avatar';
}

export function isSiteType(type: CardType): boolean {
  return type === 'Site';
}

export function isAvatarType(type: CardType): boolean {
  return type === 'Avatar';
}

// ============================================================================
// Threshold Helpers
// ============================================================================

export function getThresholdGroup(thresholds: Thresholds): ThresholdGroup {
  const active: Element[] = [];

  if (thresholds.air > 0) active.push('Air');
  if (thresholds.earth > 0) active.push('Earth');
  if (thresholds.fire > 0) active.push('Fire');
  if (thresholds.water > 0) active.push('Water');

  if (active.length === 0) return 'none';
  if (active.length > 1) return 'multiple';

  return active[0]!.toLowerCase() as ThresholdGroup;
}
