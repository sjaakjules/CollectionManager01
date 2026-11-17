import { Container, Graphics, Text } from 'pixi.js';
import type { CardStatisticsPresentation } from '@/data/cardStatisticHighlights';

/** Render prepared colours and labels inside the existing card bounds. */
export class CardStatisticsOverlay extends Container {
  private readonly outline = new Graphics();
  private values: Container | null = null;
  private presentation: CardStatisticsPresentation | null = null;
  private zoom = 1;

  constructor(private readonly cardWidth: number, private readonly cardHeight: number) {
    super();
    this.label = 'card-statistics';
    this.eventMode = 'none';
    this.interactiveChildren = false;
    this.outline.label = 'card-statistic-outline';
    this.addChild(this.outline);
  }

  setPresentation(presentation: CardStatisticsPresentation, zoom: number): void {
    if (presentation === this.presentation) {
      this.updateZoom(zoom);
      return;
    }
    const previousLabels = this.presentation?.labels;
    if (previousLabels?.length !== presentation.labels.length
      || !presentation.labels.every((label, index) => label === previousLabels?.[index])) {
      this.values?.destroy({ children: true });
      this.values = null;
    }
    this.presentation = presentation;
    this.zoom = Math.max(.01, zoom);
    this.drawOutline();
    this.updateValues();
  }

  updateZoom(zoom: number): void {
    if (this.zoom === zoom) return;
    this.zoom = Math.max(.01, zoom);
    if (this.presentation?.outlines.length) this.drawOutline();
    this.updateValues();
  }

  private drawOutline(): void {
    this.outline.clear();
    const colours = this.presentation?.outlines;
    if (!colours?.length) return;

    const inset = Math.min(this.cardWidth / 8, this.cardHeight / 8, 2.5 / this.zoom);
    const width = this.cardWidth - 2 * inset;
    const height = this.cardHeight - 2 * inset;
    const single = colours[0];
    if (colours.length === 1 && single) {
      this.outline.roundRect(inset, inset, width, height, inset)
        .stroke({ color: single.colour, width: inset });
      return;
    }

    // Split the perimeter among matches so several colours fit even on thumbnails.
    const edges = [
      { x: inset, y: inset, dx: 1, dy: 0, length: width },
      { x: inset + width, y: inset, dx: 0, dy: 1, length: height },
      { x: inset + width, y: inset + height, dx: -1, dy: 0, length: width },
      { x: inset, y: inset + height, dx: 0, dy: -1, length: height },
    ];
    const segmentLength = 2 * (width + height) / colours.length;
    const gap = Math.min(inset / 2, segmentLength / 12);
    for (const [index, { colour }] of colours.entries()) {
      const from = index * segmentLength + gap;
      const to = (index + 1) * segmentLength - gap;
      let offset = 0;
      let started = false;
      for (const edge of edges) {
        const start = Math.max(0, from - offset);
        const end = Math.min(edge.length, to - offset);
        offset += edge.length;
        if (end <= start) continue;
        if (!started) this.outline.moveTo(edge.x + edge.dx * start, edge.y + edge.dy * start);
        this.outline.lineTo(edge.x + edge.dx * end, edge.y + edge.dy * end);
        started = true;
      }
      this.outline.stroke({ color: colour, width: inset, join: 'round' });
    }
  }

  private updateValues(): void {
    const labels = this.presentation?.labels ?? [];
    const readable = this.cardWidth * this.zoom >= 160 && labels.length > 0;
    // Do not allocate/measure text for overview thumbnails or offscreen cards.
    if (readable && !this.values) {
      const padding = this.cardWidth * .04;
      const longest = Math.max(...labels.map(label => label.length));
      const fontSize = Math.min(this.cardWidth * .095, (this.cardWidth - padding * 2) / (longest * .62));
      const lineHeight = fontSize * 1.45;
      const height = lineHeight * labels.length + padding * 2;
      this.values = new Container();
      this.values.label = 'card-statistic-values';
      this.values.y = this.cardHeight - height;
      this.values.addChild(new Graphics().rect(0, 0, this.cardWidth, height).fill({ color: 0x101b25, alpha: .94 }));
      const text = new Text({ text: labels.join('\n'), style: {
        fontFamily: 'monospace', fontSize, lineHeight, fill: 0xf1f8fa,
      } });
      text.x = padding;
      text.y = padding;
      this.values.addChild(text);
      this.addChildAt(this.values, 0);
    }
    if (this.values) this.values.visible = readable;
  }
}
