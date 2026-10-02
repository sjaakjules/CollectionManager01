import { Container, Graphics, Text } from 'pixi.js';
import type { InteractionEffectsSettings } from '@/data/interactionEffects';
import { getPixiTextResolution } from './deviceProfile';
import { MANGA_PALETTE, mangaGeometry, type EffectBounds } from './mangaStyle';
import {
  ARRIVAL_FPS, ARRIVAL_RAY_DURATION_MS, ARRIVAL_VISUAL_DURATION_MS, ARRIVAL_WORD_DURATION_MS,
  arrivalEdgeRadius, createArrivalStars, getArrivalRay, getArrivalStarPulse, getArrivalWordPose,
} from './arrivalPopTimeline';

const { ink: INK, paper: PAPER, gold: GOLD } = MANGA_PALETTE;

/** Stack-aware arrival drawings with an independent, refreshable caption clock. */
export class ArrivalPop {
  readonly root = new Container();
  private readonly rays = new Graphics();
  private readonly sparkles = new Graphics();
  private readonly words = new Container();
  private readonly stars = createArrivalStars();
  private readonly settings: InteractionEffectsSettings;
  private bounds: EffectBounds;
  private width = -1;
  private height = -1;
  private detail = 1;
  private rayFrame = -1;
  private starFrame = -1;
  private wordFrame = -1;
  private wordStartMs = 0;

  constructor(bounds: EffectBounds, zoom: number, settings: InteractionEffectsSettings, private readonly fullArrival = true) {
    this.settings = { ...settings };
    this.bounds = { ...bounds };
    this.root.eventMode = 'none';
    this.root.interactiveChildren = false;
    this.root.label = 'arrival-pop';
    this.rays.label = 'arrival-rays';
    this.sparkles.label = 'arrival-stars';
    this.words.label = 'arrival-words';
    this.root.addChild(this.rays, this.sparkles, this.words);
    if (settings.lettering !== 'none') {
      const both = settings.lettering === 'both';
      for (const [index, text] of [both ? 'ポンッ' : '', 'POP!'].entries()) {
        if (!text) continue;
        const caption = new Text({ text, resolution: getPixiTextResolution(), style: {
          fontFamily: index === 0 ? ['Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Noto Sans JP', 'sans-serif'] : ['Impact', 'Arial Black', 'sans-serif'],
          fontSize: index === 0 ? 30 : 27, fontWeight: '900', fontStyle: index === 1 ? 'italic' : 'normal',
          fill: index === 0 ? PAPER : GOLD, stroke: { color: INK, width: 4, join: 'round' },
          dropShadow: { color: INK, alpha: 0.3, blur: 0, distance: 2, angle: Math.PI / 2 },
        } });
        caption.anchor.set(0.5);
        caption.position.set(0, both ? (index === 0 ? -15 : 15) : 0);
        this.words.addChild(caption);
      }
      this.words.rotation = -0.12;
    }
    this.update(0, zoom);
  }

  /** Repeated presses replace the caption pulse without replaying any graphics. */
  refreshWords(elapsedMs: number): void {
    if (this.root.destroyed) return;
    this.wordStartMs = Math.max(0, elapsedMs);
    this.wordFrame = -1;
    this.drawWords(0);
  }

  /** False means finished and disposed, including after a background time jump. */
  update(elapsedMs: number, zoom: number, bounds?: EffectBounds): boolean {
    if (this.root.destroyed) return false;
    const elapsed = Math.max(0, elapsedMs);
    const wordAge = Math.max(0, elapsed - this.wordStartMs);
    const visualsDone = !this.fullArrival || elapsed >= ARRIVAL_VISUAL_DURATION_MS;
    const wordsDone = this.settings.lettering === 'none' || wordAge >= ARRIVAL_WORD_DURATION_MS;
    if (this.settings.intensity === 'off' || (visualsDone && wordsDone)) { this.destroy(); return false; }
    if (bounds) this.bounds = { ...bounds };
    const geometry = mangaGeometry(this.bounds, zoom);
    const resized = geometry.width !== this.width || geometry.height !== this.height || geometry.detail !== this.detail;
    this.width = geometry.width; this.height = geometry.height; this.detail = geometry.detail;
    this.root.position.set((this.bounds.left + this.bounds.right) / 2, (this.bounds.top + this.bounds.bottom) / 2);
    this.root.scale.set(1 / Math.max(0.01, zoom));
    const heldTime = Math.floor(elapsed * ARRIVAL_FPS / 1000) * 1000 / ARRIVAL_FPS;
    const rayFrame = this.fullArrival && elapsed < ARRIVAL_RAY_DURATION_MS ? Math.floor(elapsed * ARRIVAL_FPS / 1000) : -2;
    if (rayFrame !== this.rayFrame || (resized && elapsed < ARRIVAL_RAY_DURATION_MS)) {
      this.rayFrame = rayFrame;
      this.rays.clear();
      if (this.fullArrival && elapsed < ARRIVAL_RAY_DURATION_MS) this.drawRays(heldTime);
    }
    const starFrame = !visualsDone ? Math.floor(elapsed * ARRIVAL_FPS / 1000) : -2;
    if (starFrame !== this.starFrame || (resized && !visualsDone)) {
      this.starFrame = starFrame;
      this.sparkles.clear();
      if (!visualsDone) this.drawStars(heldTime);
    }
    // Include an explicit terminal frame so a caption cannot linger to the next tick.
    const wordFrame = wordAge >= ARRIVAL_WORD_DURATION_MS ? -2 : Math.floor(wordAge * ARRIVAL_FPS / 1000);
    if (wordFrame !== this.wordFrame || resized) {
      this.wordFrame = wordFrame;
      this.drawWords(wordFrame === -2 ? ARRIVAL_WORD_DURATION_MS : wordFrame * 1000 / ARRIVAL_FPS);
    }
    return true;
  }

  destroy(): void { if (!this.root.destroyed) this.root.destroy({ children: true }); }

  private drawRays(elapsed: number): void {
    const subtle = this.settings.intensity === 'subtle';
    for (let index = 0; index < 30; index++) {
      if (subtle && index % 2) continue;
      const ray = getArrivalRay(elapsed, index, this.width, this.height, this.detail, subtle);
      if (!ray.visible) continue;
      const cos = Math.cos(ray.angle); const sin = Math.sin(ray.angle);
      const shoulder = ray.tail + (ray.head - ray.tail) * 0.35;
      this.rays.poly([
        cos * ray.tail, sin * ray.tail,
        cos * shoulder - sin * ray.thickness, sin * shoulder + cos * ray.thickness,
        cos * ray.head, sin * ray.head,
        cos * shoulder + sin * ray.thickness, sin * shoulder - cos * ray.thickness,
      ]).fill({ color: ray.gold ? GOLD : PAPER, alpha: subtle ? 0.75 : 0.95 })
        .stroke({ color: INK, width: 0.65 * this.detail, alpha: 0.7 });
    }
  }

  private drawStars(elapsed: number): void {
    const subtle = this.settings.intensity === 'subtle';
    for (const [index, star] of this.stars.entries()) {
      if (subtle && index % 2) continue;
      const pulse = getArrivalStarPulse(star, elapsed);
      if (pulse <= 0) continue;
      const progress = Math.max(0, elapsed - star.birth) / star.life;
      const radius = arrivalEdgeRadius(star.angle, this.width, this.height) + (star.gap + progress * 7) * this.detail;
      const x = Math.cos(star.angle) * radius; const y = Math.sin(star.angle) * radius;
      const size = star.size * this.detail * pulse * (subtle ? 0.8 : 1);
      const rotation = star.rotation + progress * 0.2;
      const points: number[] = [];
      for (let point = 0; point < 8; point++) {
        const angle = rotation + point * Math.PI / 4;
        const radial = point % 2 ? size * 0.14 : point % 4 ? size : size * 0.75;
        points.push(x + Math.cos(angle) * radial, y + Math.sin(angle) * radial);
      }
      this.sparkles.poly(points).fill({ color: GOLD, alpha: pulse * (subtle ? 0.8 : 1) })
        .stroke({ color: PAPER, width: 0.65 * this.detail, alpha: pulse * 0.85 });
      this.sparkles.circle(x, y, Math.max(0.2, size * 0.1)).fill({ color: PAPER, alpha: pulse });
    }
  }

  private drawWords(elapsed: number): void {
    const pose = getArrivalWordPose(elapsed);
    this.words.visible = this.settings.lettering !== 'none' && pose.visible;
    this.words.alpha = pose.alpha;
    const strength = this.settings.intensity === 'subtle' ? 0.85 : 1;
    this.words.scale.set(pose.scale * this.detail * strength);
    this.words.position.set(this.width / 2 + 48 * this.detail * strength, -this.height / 2 - (19 + pose.rise) * this.detail);
  }
}
