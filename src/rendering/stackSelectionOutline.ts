import type { CardSprite } from './CardSprite';
import { unionEffectBounds } from './mangaStyle';

/** Keep stack edges readable instead of drawing a bright rectangle per copy. */
export function outlineSelectedStack(sprites: CardSprite[]): void {
  if (!sprites.length) return;
  const bounds = unionEffectBounds(sprites.map(sprite => sprite.getWorldBounds()));
  if (!bounds) return;
  let top = sprites[0];
  for (const sprite of sprites) {
    sprite.setSelectionOutline(null);
    if (!top || sprite.zIndex >= top.zIndex) top = sprite;
  }
  if (!top) return;
  top.setSelectionOutline({
    left: bounds.left - top.x, top: bounds.top - top.y,
    right: bounds.right - top.x, bottom: bounds.bottom - top.y,
  });
}
