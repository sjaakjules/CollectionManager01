import type { CardFilterCriteria } from '@/data/cardFilters';

export type MultiCriteriaField = 'sets' | 'types' | 'rarities' | 'thresholds';

function normalizeToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

export function includesToken(list: string[], token: string): boolean {
  const normalizedToken = normalizeToken(token);
  if (!normalizedToken) return false;

  return list.some((entry) => normalizeToken(entry) === normalizedToken);
}

export function toggleMultiToken(list: string[], token: string): string[] {
  const normalizedToken = normalizeToken(token);
  if (!normalizedToken) return list;

  if (includesToken(list, normalizedToken)) {
    return list.filter((entry) => normalizeToken(entry) !== normalizedToken);
  }
  return [...list, normalizedToken];
}

function describeNumericRange(
  label: string,
  min: number | null,
  max: number | null,
): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return `${label} ${min}-${max}`;
  if (min !== null) return `${label} >= ${min}`;
  return `${label} <= ${max}`;
}

export function describeFilterClause(criteria: CardFilterCriteria): string {
  const parts: string[] = [];

  if (criteria.sets.length > 0) {
    parts.push(`Set: ${criteria.sets.join(' or ')}`);
  }
  if (criteria.types.length > 0) {
    parts.push(`Type: ${criteria.types.join(' or ')}`);
  }
  if (criteria.rarities.length > 0) {
    parts.push(`Rarity: ${criteria.rarities.join(' or ')}`);
  }
  if (criteria.subType.trim()) {
    parts.push(`Sub-type: ${criteria.subType.trim()}`);
  }
  if (criteria.artist.trim()) {
    parts.push(`Artist: ${criteria.artist.trim()}`);
  }
  if (criteria.thresholds.length > 0) {
    parts.push(
      `Threshold: ${criteria.thresholds.join(' + ')} (${criteria.thresholdMode})`,
    );
  }

  const costText = describeNumericRange('Cost', criteria.costMin, criteria.costMax);
  const attackText = describeNumericRange(
    'Attack',
    criteria.attackMin,
    criteria.attackMax,
  );
  const defenceText = describeNumericRange(
    'Defence',
    criteria.defenceMin,
    criteria.defenceMax,
  );

  if (costText) parts.push(costText);
  if (attackText) parts.push(attackText);
  if (defenceText) parts.push(defenceText);

  if (criteria.searchText.trim()) {
    parts.push(`Text: "${criteria.searchText.trim()}"`);
  }

  return parts.join(' • ');
}

function toTitleToken(token: string): string {
  if (!token.trim()) return '';
  return token
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function summarizeTokens(
  label: string,
  values: string[],
  maxTokens = 2,
): string | null {
  if (values.length === 0) return null;
  const shown = values.slice(0, maxTokens).map((token) => toTitleToken(token));
  const suffix = values.length > maxTokens ? '+' : '';
  return `${label}:${shown.join('/')}${suffix}`;
}

function compactRange(
  label: string,
  min: number | null,
  max: number | null,
): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return `${label}:${min}-${max}`;
  if (min !== null) return `${label}:>=${min}`;
  return `${label}:<=${max}`;
}

export function describeFilterButton(criteria: CardFilterCriteria): string {
  const parts: string[] = [];

  if (criteria.searchText.trim()) {
    parts.push(`Text:${criteria.searchText.trim().slice(0, 10)}`);
  }

  const setPart = summarizeTokens('Set', criteria.sets, 1);
  if (setPart) parts.push(setPart);

  const typePart = summarizeTokens('Type', criteria.types, 2);
  if (typePart) parts.push(typePart);

  const rarityPart = summarizeTokens('R', criteria.rarities, 1);
  if (rarityPart) parts.push(rarityPart);

  if (criteria.subType.trim()) {
    parts.push(`Sub:${toTitleToken(criteria.subType.trim())}`);
  }
  if (criteria.artist.trim()) {
    parts.push(`Artist:${criteria.artist.trim().slice(0, 10)}`);
  }

  const thresholdPart = summarizeTokens('Th', criteria.thresholds, 2);
  if (thresholdPart) parts.push(thresholdPart);

  const costPart = compactRange('C', criteria.costMin, criteria.costMax);
  const attackPart = compactRange('A', criteria.attackMin, criteria.attackMax);
  const defencePart = compactRange('D', criteria.defenceMin, criteria.defenceMax);
  if (costPart) parts.push(costPart);
  if (attackPart) parts.push(attackPart);
  if (defencePart) parts.push(defencePart);

  if (parts.length === 0) return 'Empty';
  return parts.slice(0, 2).join(' | ');
}

export function cloneCriteria(criteria: CardFilterCriteria): CardFilterCriteria {
  return {
    ...criteria,
    sets: [...criteria.sets],
    types: [...criteria.types],
    rarities: [...criteria.rarities],
    thresholds: [...criteria.thresholds],
  };
}
