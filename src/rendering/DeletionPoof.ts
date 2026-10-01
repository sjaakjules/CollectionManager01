import { Container, Graphics, Text } from 'pixi.js';
import { getPixiTextResolution } from './deviceProfile';
import { createPoofStars, getPoofFrame, getPoofPhase, POOF_FRAME_COUNT, POOF_POP_FRAME, type PoofStar } from './deletionPoofTimeline';

const INK = 0x17131d;
const PAPER = 0xfffcf1;
const GOLD = 0xffce52;
const TAU = Math.PI * 2;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

interface PoofBounds { left: number; top: number; right: number; bottom: number }

/**
 * Transparent, code-native in-betweens inspired by tmp/GraphicIdeas/pufu-01…06.
 * The cloud compresses, a ring snaps outward, then staggered stars and lettering
 * linger. Only an active effect redraws, and only when its 24 fps frame changes.
 */
export class DeletionPoof {
  readonly root = new Container();
  private readonly speedLines = new Graphics();
  private readonly cloud = new Graphics();
  private readonly burst = new Graphics();
  private readonly sparkles = new Graphics();
  private readonly japanese: Text;
  private readonly english: Text;
  private readonly stars: PoofStar[];
  private frame = -1;
  private disposed = false;

  constructor(bounds: PoofBounds, zoom = 1, seed = Math.random() * 0x100000000, private readonly lettering: 'both' | 'english' | 'none' = 'both') {
    this.root.eventMode = 'none';
    this.root.interactiveChildren = false;
    this.root.position.set((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2);
    // Legible at overview zoom, but bounded so one deletion cannot fill the view.
    const safeZoom = Math.max(0.01, zoom);
    const cardSize = Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top);
    const screenSize = Math.min(280, Math.max(140, cardSize * safeZoom * 1.8));
    this.root.scale.set(screenSize / (300 * safeZoom));
    this.stars = createPoofStars(seed);
    const commonStyle = {
      fontWeight: '900' as const,
      fill: PAPER,
      stroke: { color: INK, width: 6, join: 'round' as const },
      dropShadow: { color: INK, alpha: 0.3, angle: Math.PI / 2, blur: 0, distance: 3 },
    };
    this.japanese = new Text({
      text: 'ボフッ',
      resolution: getPixiTextResolution(),
      style: { ...commonStyle, fontFamily: ['Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Noto Sans JP', 'sans-serif'], fontSize: 44, letterSpacing: 2 },
    });
    this.english = new Text({
      text: 'pooft',
      resolution: getPixiTextResolution(),
      style: { ...commonStyle, fontFamily: ['Impact', 'Arial Black', 'sans-serif'], fontSize: 39, fontStyle: 'italic', letterSpacing: 1 },
    });
    this.japanese.anchor.set(0.5);
    this.english.anchor.set(0.5);
    this.root.addChild(this.speedLines, this.cloud, this.burst, this.sparkles, this.japanese, this.english);
    this.update(0);
  }

  /** False means finished and already disposed. Large time jumps do not replay. */
  update(elapsedMs: number): boolean {
    if (this.disposed) return false;
    const frame = getPoofFrame(elapsedMs);
    if (frame >= POOF_FRAME_COUNT) { this.destroy(); return false; }
    if (frame === this.frame) return true;
    this.frame = frame;
    this.speedLines.clear();
    this.cloud.clear();
    this.burst.clear();
    this.sparkles.clear();
    const phase = getPoofPhase(frame);
    if (phase === 'cloud') this.drawCloud(frame);
    if (phase === 'pop') this.drawBurst(frame - POOF_POP_FRAME);
    this.drawStars(frame);
    this.drawWords(frame);
    return true;
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.destroy({ children: true });
  }

  private drawCloud(frame: number): void {
    const collapse = clamp01((frame - 2) / 9);
    const size = frame < 3 ? [0.96, 1.03, 1.06][frame] ?? 1 : 1 - 0.945 * collapse ** 1.45;
    const squeezeX = 1 + Math.sin(frame * 1.7) * 0.045;
    const squeezeY = 1 - Math.sin(frame * 1.7) * 0.035;
    const radiusX = 84 * size * squeezeX;
    const radiusY = 66 * size * squeezeY;
    const wobble = Math.floor(frame / 2) * 0.67;
    // Speed strokes converge toward the vanishing centre, with ink-black cores
    // and a thin paper edge that also reads against the dark deck canvas.
    for (let index = 0; index < 34; index++) {
      const angle = index * TAU / 34 + Math.sin(index * 8.1) * 0.04;
      const inner = Math.max(5, size * (70 + 9 * Math.sin(index * 4.2)));
      const outer = (95 + 40 * (0.5 + 0.5 * Math.sin(index * 9.2))) * (1 - collapse * 0.19);
      const width = index % 4 === 0 ? 2.8 : 0.85;
      const cos = Math.cos(angle); const sin = Math.sin(angle);
      this.speedLines.moveTo(cos * inner, sin * inner * 0.82);
      this.speedLines.lineTo(cos * outer, sin * outer * 0.82);
      this.speedLines.stroke({ color: PAPER, width: width + 2.3, alpha: 0.9 });
      this.speedLines.moveTo(cos * inner, sin * inner * 0.82);
      this.speedLines.lineTo(cos * outer, sin * outer * 0.82);
      this.speedLines.stroke({ color: INK, width });
      if (index % 4 === 0) {
        this.speedLines.poly([
          cos * outer, sin * outer * 0.82,
          cos * inner - sin * (3 + size * 3), sin * inner * 0.82 + cos * (3 + size * 3),
          cos * inner + sin * (3 + size * 3), sin * inner * 0.82 - cos * (3 + size * 3),
        ]).fill(INK);
      }
    }
    // One scalloped silhouette avoids the flower-like seams of overlapping circles.
    const lobes = 15;
    const point = (angle: number, radial: number) => ({ x: Math.cos(angle) * radiusX * radial, y: Math.sin(angle) * radiusY * radial });
    const start = point(0, 1);
    this.cloud.moveTo(start.x, start.y);
    for (let index = 0; index < lobes; index++) {
      const angle = index * TAU / lobes;
      const endAngle = (index + 1) * TAU / lobes;
      const bulge = 1.16 + 0.06 * Math.sin(index * 2.4 + wobble);
      const c1 = point(angle + 0.1, bulge);
      const c2 = point(endAngle - 0.1, bulge);
      const end = point(endAngle, 1);
      this.cloud.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
    }
    this.cloud.closePath().fill(PAPER).stroke({ color: INK, width: Math.max(1.5, 3.4 * size) });
    if (frame >= 3 && frame <= 10) {
      // Interior curls make the in-between drawings feel like billowing smoke.
      for (let index = 0; index < 5; index++) {
        const angle = index * TAU / 5 + wobble * 0.2;
        const x = Math.cos(angle) * radiusX * 0.54;
        const y = Math.sin(angle) * radiusY * 0.5;
        this.cloud.moveTo(x, y);
        this.cloud.bezierCurveTo(x - 22 * size, y - 22 * size, x - 30 * size, y + 14 * size, x - 13 * size, y + 17 * size);
        this.cloud.stroke({ color: INK, width: Math.max(1, size * 2.2) });
      }
    }
    if (frame === 11) this.cloud.circle(0, 0, 5).fill(PAPER);
  }

  private drawBurst(age: number): void {
    const radius = 19 + age * 25;
    const alpha = 1 - age / 4;
    // Broken concentric rings and long tapered wedges echo reference 05.
    for (let ring = 0; ring < 3; ring++) {
      const r = radius + ring * 6;
      for (let arc = 0; arc < 4; arc++) {
        const start = arc * Math.PI / 2 + age * 0.16;
        this.burst.moveTo(Math.cos(start) * r, Math.sin(start) * r);
        this.burst.arc(0, 0, r, start, start + 1.05);
        this.burst.stroke({ color: PAPER, width: 4 - ring * 0.8, alpha });
      }
    }
    for (let index = 0; index < 9; index++) {
      const angle = index * TAU / 9 + 0.16;
      const inner = radius * 0.72;
      const outer = radius + 37 + 13 * Math.sin(index * 4.3);
      const cos = Math.cos(angle); const sin = Math.sin(angle);
      this.burst.poly([
        cos * inner, sin * inner,
        cos * outer - sin * 4, sin * outer + cos * 4,
        cos * (outer + 16), sin * (outer + 16),
        cos * outer + sin * 4, sin * outer - cos * 4,
      ]).fill({ color: PAPER, alpha }).stroke({ color: INK, width: 1.6, alpha });
    }
  }

  private drawStars(frame: number): void {
    for (const star of this.stars) {
      const age = frame - star.birth;
      if (age < 0 || age >= star.life) continue;
      const progress = age / star.life;
      const pulse = Math.sin(Math.PI * progress) ** 0.7;
      const size = star.size * pulse;
      const drift = 1 + progress * 0.12;
      const x = star.x * drift;
      const y = star.y * drift - progress * 4;
      const rotation = star.rotation + progress * 0.18;
      const points: number[] = [];
      for (let index = 0; index < 8; index++) {
        const angle = rotation + index * Math.PI / 4;
        const radius = index % 2 ? size * 0.14 : index % 4 ? size : size * 0.75;
        points.push(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
      }
      this.sparkles.poly(points).fill({ color: GOLD, alpha: pulse }).stroke({ color: 0xffec9d, width: 0.7, alpha: pulse });
      this.sparkles.circle(x, y, Math.max(0.2, size * 0.1)).fill({ color: PAPER, alpha: pulse });
    }
  }

  private drawWords(frame: number): void {
    const age = frame - POOF_POP_FRAME;
    this.japanese.visible = age >= 0 && this.lettering === 'both';
    this.english.visible = age >= 0 && this.lettering !== 'none';
    if (age < 0) return;
    const progress = age / (POOF_FRAME_COUNT - POOF_POP_FRAME - 1);
    const enter = Math.min(1, (age + 1) / 3);
    const fade = 1 - clamp01((progress - 0.55) / 0.45);
    const kick = Math.sin(Math.min(1, age / 5) * Math.PI) * 0.1;
    const scale = 0.82 + enter * 0.18 + progress * 0.14 + kick;
    const shudder = age < 7 ? Math.sin(age * 2.6) * (1 - age / 7) * 3 : 0;
    this.japanese.alpha = enter * fade;
    this.english.alpha = enter * fade;
    this.japanese.scale.set(scale);
    this.english.scale.set(scale * 0.94);
    this.japanese.position.set(-21 - progress * 23 + shudder, -21 - progress * 24);
    this.english.position.set(22 + progress * 27 - shudder, 24 + progress * 23);
    this.japanese.rotation = -0.14 - shudder * 0.015;
    this.english.rotation = 0.12 + shudder * 0.012;
  }
}
