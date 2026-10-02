import type { CanvasLabel } from '@/data/dataModels';
import type { CanvasArea, CanvasAreaBounds, CanvasCardInstance } from './canvasAreas';
import { CARD_SIZE } from '@/rendering/Grid';

/** Membership is explicit: crossing a drawn outline never silently captures cards. */
export function getLabelFamily(labels: CanvasLabel[], id: string): Set<string> {
  const family = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const label of labels) {
      if (label.parentLabelId && family.has(label.parentLabelId) && !family.has(label.id)) {
        family.add(label.id);
        changed = true;
      }
    }
  }
  return family;
}

export function getLabelCards(labels: CanvasLabel[], id: string, areas: CanvasArea[]): CanvasCardInstance[] {
  const family = getLabelFamily(labels, id);
  return areas.flatMap(area => area.cards.filter(card => card.labelId && family.has(card.labelId)));
}

/** Keep populated titles with their cards when an explicit sort resets positions. */
export function repositionLabelsAfterCardLayout(
  labels: CanvasLabel[], areaId: string, before: CanvasCardInstance[], after: CanvasCardInstance[],
): CanvasLabel[] {
  const nextById = new Map(after.map(card => [card.id, card]));
  let changed = false;
  const next = labels.map(label => {
    if (label.areaId !== areaId) return label;
    const family = getLabelFamily(labels, label.id);
    const members = before.filter(card => card.labelId && family.has(card.labelId) && nextById.has(card.id));
    if (!members.length) return label;
    const nextMembers = members.flatMap(card => {
      const nextCard = nextById.get(card.id);
      return nextCard ? [nextCard] : [];
    });
    const dx = Math.min(...nextMembers.map(card => card.x)) - Math.min(...members.map(card => card.x));
    const dy = Math.min(...nextMembers.map(card => card.y)) - Math.min(...members.map(card => card.y));
    if (!dx && !dy) return label;
    changed = true;
    return { ...label, x: label.x + dx, y: label.y + dy };
  });
  return changed ? next : labels;
}

export function getLabelRegionBounds(
  labels: CanvasLabel[], label: CanvasLabel, areas: CanvasArea[],
  isLandscape: (name: string) => boolean,
  titleSize: (id: string) => { width: number; height: number },
): CanvasAreaBounds | null {
  const cards = getLabelCards(labels, label.id, areas);
  if (!cards.length) return null;
  const family = getLabelFamily(labels, label.id);
  const titles = labels.filter(entry => family.has(entry.id));
  const left = Math.min(...cards.map(card => card.x), ...titles.map(entry => entry.x));
  const top = Math.min(...cards.map(card => card.y), ...titles.map(entry => entry.y));
  const right = Math.max(...cards.map(card => card.x + (isLandscape(card.cardName) ? CARD_SIZE.LANDSCAPE.width : CARD_SIZE.PORTRAIT.width)), ...titles.map(entry => entry.x + titleSize(entry.id).width));
  const bottom = Math.max(...cards.map(card => card.y + (isLandscape(card.cardName) ? CARD_SIZE.LANDSCAPE.height : CARD_SIZE.PORTRAIT.height)), ...titles.map(entry => entry.y + titleSize(entry.id).height));
  return { x: left - 14, y: top - 14, width: right - left + 28, height: bottom - top + 28 };
}

/** Three deliberate direction changes detach; tiny pointer noise does not. */
export class ShakeDetector {
  private point = { x: 0, y: 0 };
  private direction = { x: 0, y: 0 };
  private reversals = 0;
  private startTime = 0;
  reset(point: { x: number; y: number }, now: number): void {
    this.point = { ...point };
    this.direction = { x: 0, y: 0 };
    this.reversals = 0;
    this.startTime = now;
  }
  move(point: { x: number; y: number }, now: number): boolean {
    if (now - this.startTime > 900) this.reset(this.point, now);
    const dx = point.x - this.point.x;
    const dy = point.y - this.point.y;
    if (Math.hypot(dx, dy) < 16) return false;
    if (dx * this.direction.x + dy * this.direction.y < -0.5 * Math.hypot(dx, dy) * Math.hypot(this.direction.x, this.direction.y)) this.reversals++;
    this.point = { ...point };
    this.direction = { x: dx, y: dy };
    return this.reversals >= 3;
  }
}
