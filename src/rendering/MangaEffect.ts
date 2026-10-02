import { Container, Graphics, Text } from 'pixi.js';
import { MANGA_EFFECTS, MANGA_FPS, type MangaEffectKind, type InteractionEffectsSettings } from '@/data/interactionEffects';
import { getPixiTextResolution } from './deviceProfile';
import { MANGA_PALETTE, mangaGeometry, type EffectBounds } from './mangaStyle';

export type { EffectBounds } from './mangaStyle';
const { ink: INK, paper: PAPER, gold: GOLD } = MANGA_PALETTE;

/** Original line drawings held at 24fps, never a card transform. */
export class MangaEffect {
  readonly root = new Container();
  private readonly ink = new Graphics();
  private readonly words = new Container();
  private width = 0;
  private height = 0;
  private detail = 1;
  private bounds: EffectBounds;
  private frame = -1;
  private readonly duration: number;

  constructor(readonly kind: MangaEffectKind, bounds: EffectBounds, zoom: number,
    settings: InteractionEffectsSettings, showWords: boolean) {
    this.bounds = { ...bounds };
    this.root.eventMode = 'none';
    this.root.interactiveChildren = false;
    this.root.label = `manga:${kind}`;
    this.duration = MANGA_EFFECTS[kind].duration;
    this.root.addChild(this.ink, this.words);
    if (showWords && settings.lettering !== 'none') {
      const definition = MANGA_EFFECTS[kind];
      const japanese = settings.lettering === 'both' ? definition.japanese : '';
      const size = settings.intensity === 'expressive' ? 24 : 19;
      for (const [index, text] of [japanese, definition.english].entries()) {
        if (!text) continue;
        const caption = new Text({ text, resolution: getPixiTextResolution(), style: {
          fontFamily: index === 0 ? ['Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Noto Sans JP', 'sans-serif'] : ['Arial', 'sans-serif'],
          fontSize: index === 0 ? size : 12, fontWeight: '800', fontStyle: index === 1 ? 'italic' : 'normal',
          fill: PAPER, stroke: { color: INK, width: 3, join: 'round' },
        } });
        caption.anchor.set(0.5);
        caption.position.set(0, index === 0 ? -13 : 8);
        this.words.addChild(caption);
      }
      this.words.rotation = -0.09;
    }
    this.update(0, zoom);
  }

  update(elapsed: number, zoom: number, bounds?: EffectBounds): boolean {
    if (this.root.destroyed) return false;
    if (elapsed >= this.duration) { this.destroy(); return false; }
    if (bounds) this.bounds = { ...bounds };
    this.root.position.set((this.bounds.left + this.bounds.right) / 2, (this.bounds.top + this.bounds.bottom) / 2);
    this.root.scale.set(1 / Math.max(0.01, zoom));
    const geometry = mangaGeometry(this.bounds, zoom);
    const resized = this.width !== geometry.width || this.height !== geometry.height;
    this.width = geometry.width; this.height = geometry.height; this.detail = geometry.detail;
    const frame = Math.floor(Math.max(0, elapsed) * MANGA_FPS / 1000);
    if (frame === this.frame && !resized) return true;
    this.frame = frame;
    const t = Math.min(1, frame * 1000 / MANGA_FPS / this.duration);
    const out = 1 - (1 - t) ** 3;
    const fade = t < 0.55 ? 1 : (1 - t) / 0.45;
    const s = this.detail;
    const w = this.width / (2 * s); const h = this.height / (2 * s);
    this.ink.clear();
    this.ink.scale.set(s);
    this.ink.alpha = fade;
    this.words.alpha = Math.min(1, t * 8 + 0.3) * fade;
    this.words.position.set(this.width * 0.15 + out * 4 * s, -this.height / 2 - (25 + out * 5) * s);
    this.words.scale.set((0.94 + out * 0.09) * s);
    // Strengthen everyday accents while keeping their geometry anchored to the card.
    const accent = this.kind === 'delete' ? 1 : 1.2;
    const line = (x1: number, y1: number, x2: number, y2: number, color: number = PAPER, width = 1.8) => {
      this.ink.moveTo(x1, y1).lineTo(x2, y2).stroke({ color: INK, width: (width + 2) * accent, alpha: 0.6 });
      this.ink.moveTo(x1, y1).lineTo(x2, y2).stroke({ color, width: width * accent });
    };
    const brackets = (spread: number, color: number = PAPER) => {
      for (const x of [-1, 1]) for (const y of [-1, 1]) {
        line(x * (w + spread), y * (h + spread - 10), x * (w + spread), y * (h + spread), color);
        line(x * (w + spread), y * (h + spread), x * (w + spread - 10), y * (h + spread), color);
      }
    };
    const glint = (x: number, y: number, radius: number) => {
      if (this.kind !== 'delete') radius *= 1.15;
      this.ink.poly([x, y - radius, x + radius * 0.18, y - radius * 0.18, x + radius, y,
        x + radius * 0.18, y + radius * 0.18, x, y + radius, x - radius * 0.18, y + radius * 0.18,
        x - radius, y, x - radius * 0.18, y - radius * 0.18]).fill(GOLD).stroke({ color: INK, width: 1 });
    };
    switch (this.kind) {
      case 'pickup':
        this.ink.ellipse(0, h + 5 + out * 3, w * 0.8, 3).fill({ color: INK, alpha: 0.4 });
        for (const side of [-1, 1]) line(side * (w + 4), h, side * (w + 6), h - 8 - out * 6);
        for (const side of [-1, 1]) line(side * (w + 8), h - 3, side * (w + 11), h - 14 - out * 8, GOLD, 1.2);
        break;
      case 'place': case 'stack':
        this.ink.ellipse(0, h + 4, w * (0.85 + out * 0.1), 2).fill({ color: INK, alpha: 0.5 });
        for (const side of [-1, 1]) {
          line(side * (w + 3), h, side * (w + 7 + out * 5), h - 4);
          line(side * (w + 2), h + 4, side * (w + 5 + out * 5), h + 7);
        }
        if (this.kind === 'stack') line(-w, h + 4 - Math.sin(t * Math.PI) * 3, w, h + 4 - Math.sin(t * Math.PI) * 3, PAPER);
        break;
      case 'snap': case 'select': brackets(5 + (1 - out) * 10, GOLD); break;
      case 'attach':
        brackets(3, PAPER);
        line(w - 6 - (1 - out) * 12, -h - 6, w, -h - 6, PAPER, 2);
        line(w, -h - 6, w + 6 + (1 - out) * 12, -h - 6, PAPER, 2);
        if (t > 0.2) { line(w, -h - 11, w, -h - 16, GOLD); line(w + 7, -h - 10, w + 11, -h - 13, GOLD); }
        break;
      case 'detach': case 'label': {
        const peel = this.kind === 'detach' ? out : 1 - out;
        const x = w - 18 * peel; const y = -h - 12 * peel;
        line(w - 20, -h, w, -h, PAPER);
        this.ink.moveTo(w, -h).quadraticCurveTo(x - 10, y - 16 * peel, x - 16, y).stroke({ color: PAPER, width: 2 * accent });
        line(x - 16, y, x - 9, y + 5, PAPER);
        if (this.kind === 'label') brackets(2 + peel * 3, PAPER);
        break;
      }
      case 'arrive': case 'restore':
        glint(w + 3, -h, 3 + Math.sin(t * Math.PI) * 9);
        if (t > 0.25) glint(-w - 3, h * 0.45, Math.sin((t - 0.25) / 0.75 * Math.PI) * 6);
        if (this.kind === 'restore') brackets((1 - out) * 14, GOLD);
        break;
      case 'reveal':
        brackets(3 + (1 - out) * 12, GOLD);
        for (const side of [-1, 1]) for (let i = 0; i < 3; i++) line(side * (w + 7), -h / 2 + i * 14, side * (w + 12 + i * 3 + out * 4), -h / 2 + i * 16 - 3, PAPER);
        break;
      case 'hide':
        for (let i = 0; i < 3; i++) line(-w + out * w * 2, -h + i * 7, -w + out * w * 2 + 14 * (1 - t), -h + i * 7);
        break;
      case 'filter':
        for (let i = 0; i < 3; i++) line(-w + out * w * 2 - i * 8, -h + 4, -w + out * w * 2 - i * 8, -h + 18, PAPER, 1);
        break;
      case 'sort':
        for (let i = 0; i < 3; i++) {
          const ripple = Math.sin(Math.max(0, Math.min(1, t * 1.5 - i * 0.15)) * Math.PI);
          const x = -w + w * 2 / 3 * i;
          line(x, -h - ripple * 8, x + Math.min(24, w / 2), -h - ripple * 8, PAPER);
          line(x, -h - ripple * 8, x + ripple * 3, -h + 13 - ripple * 8, PAPER);
        }
        break;
      case 'focus': case 'inspect': brackets(4, this.kind === 'focus' ? PAPER : GOLD); break;
      case 'delete':
        for (let i = 0; i < 6; i++) {
          const angle = i * Math.PI / 3;
          const radius = 11 * (1 - out);
          this.ink.circle(Math.cos(angle) * radius, Math.sin(angle) * radius, 7 * (1 - out) + 1).fill(PAPER);
        }
        if (t > 0.4) glint(16, -13, Math.sin((t - 0.4) / 0.6 * Math.PI) * 5);
        break;
    }
    return true;
  }

  destroy(): void { if (!this.root.destroyed) this.root.destroy({ children: true }); }
}
