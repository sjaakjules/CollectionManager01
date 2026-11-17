import { Container, Graphics, Text, TextStyle, CanvasTextMetrics, Rectangle, type FederatedPointerEvent } from 'pixi.js';
import { formatDeckManaCell, type DeckSectionSummary, type DeckStatisticCell, type DeckStatisticColumn } from '@/canvas/deckSectionStatistics';
import { MANGA_PALETTE } from './mangaStyle';
import { paginateStatisticColumns, STATISTIC_ROW_LABELS, type StatisticColumnPage } from './statisticColumns';

interface Options {
  summary: DeckSectionSummary;
  height: number;
  page: number;
  configureText: (text: Text) => Text;
  tooltip: (target: Container, text: string) => void;
  hideTooltip: () => void;
  pageChanged: (page: number) => void;
  gestureVersion: () => number;
  canPress: (event: FederatedPointerEvent) => boolean;
}

const ELEMENT_COLORS = { earth: 0xb49a55, air: 0xb9e8ff, water: 0x5aa7ff, fire: 0xff8a3d };
const LEGEND_HINTS = {
  composition: ['Earth / Air / Water / Fire', 'Ordinary / Exceptional / Elite / Unique', 'Cards at each mana cost'],
  synergy: ['Matching cards / total', 'Percentage of each total', 'Chance of at least one in 3 / 6 draws'],
};

/** A single grid-row strip. Camera changes reflow cached cells, never card analysis. */
export class DeckStatisticStrip extends Container {
  private readonly fontSize: number;
  private readonly lineHeight: number;
  private readonly bodyStyle: TextStyle;
  private readonly headingStyle: TextStyle;
  private readonly columns: DeckStatisticColumn[] = [];
  private readonly cells: Container[][] = [];
  private readonly measured = new Map<string, number>();
  private readonly legends = new Map<string, Text[]>();
  private readonly dividers = new Graphics();
  private readonly controls: Text[] = [];
  private pages: StatisticColumnPage[] = [];
  private pageIndex: number;
  private currentWidth = -1;

  constructor(private readonly options: Options) {
    super();
    this.fontSize = Math.min(10.5, (options.height - 2) / 4 - 1);
    this.lineHeight = this.fontSize + 1.5;
    this.bodyStyle = new TextStyle({ fontFamily: 'Arial', fontSize: this.fontSize, fill: MANGA_PALETTE.muted });
    this.headingStyle = new TextStyle({ fontFamily: 'Arial', fontSize: this.fontSize, fontWeight: '600', fill: MANGA_PALETTE.paper });
    this.pageIndex = options.page;
    this.addChild(this.dividers);
    for (const column of options.summary.columns) {
      const rows = column.rows.slice(0, 4).map(row => ({ ...row }));
      const rendered = rows.slice(0, 3).map((row, index) => this.createCell(row, index === 0));
      const referenceWidth = Math.max(1, ...rendered.map(cell => cell.width));
      if (rows[3]) {
        rows[3] = formatDeckManaCell(rows[3], referenceWidth, text => this.measure(text, false));
        rendered.push(this.createCell(rows[3], false));
      }
      this.columns.push({ ...column, rows });
      this.cells.push(rendered);
    }
    for (const group of ['composition', 'synergy'] as const) {
      const labels = STATISTIC_ROW_LABELS[group].map((label, index) => {
        const text = this.makeText(label, false);
        text.alpha = 0.74;
        text.anchor.x = 1;
        options.tooltip(text, LEGEND_HINTS[group][index] ?? label);
        this.addChild(text);
        return text;
      });
      this.legends.set(group, labels);
    }
    for (const [index, glyph] of ['‹', '›'].entries()) {
      const control = options.configureText(new Text({ text: glyph,
        style: { fontFamily: 'Arial', fontSize: 20, fontWeight: '600', fill: MANGA_PALETTE.paper } }));
      options.tooltip(control, index ? 'More statistics' : 'Previous statistics');
      control.cursor = 'pointer';
      control.hitArea = new Rectangle(0, 0, 14, options.height);
      let press: { x: number; y: number; version: number } | undefined;
      control.on('pointerdown', (event: FederatedPointerEvent) => {
        if (!options.canPress(event)) return;
        press = { x: event.globalX, y: event.globalY, version: options.gestureVersion() };
        if (event.pointerType !== 'touch') event.stopPropagation();
      });
      control.on('pointertap', (event: FederatedPointerEvent) => {
        const origin = press;
        press = undefined;
        if (!origin || origin.version !== options.gestureVersion() || !options.canPress(event) ||
          Math.hypot(event.globalX - origin.x, event.globalY - origin.y) > 6) return;
        event.stopPropagation();
        this.pageIndex = Math.max(0, Math.min(this.pages.length - 1, this.pageIndex + (index ? 1 : -1)));
        options.hideTooltip();
        this.showPage();
      });
      control.on('pointercancel', () => { press = undefined; });
      control.on('pointerupoutside', () => { press = undefined; });
      this.controls.push(control);
      this.addChild(control);
    }
  }

  private makeText(value: string, heading: boolean): Text {
    return this.options.configureText(new Text({ text: value, style: heading ? this.headingStyle : this.bodyStyle }));
  }

  private measure = (text: string, heading: boolean): number => {
    const key = `${heading}:${text}`;
    const previous = this.measured.get(key);
    if (previous !== undefined) return previous;
    const width = CanvasTextMetrics.measureText(text, heading ? this.headingStyle : this.bodyStyle).width;
    this.measured.set(key, width);
    return width;
  };

  private createCell(cell: DeckStatisticCell, heading: boolean): Container {
    heading ||= cell.bold === true;
    let result: Container;
    if (cell.elementCounts) {
      result = new Container();
      let x = 0;
      cell.elementCounts.forEach(({ count, element }, index) => {
        const number = this.makeText(`${index ? ' / ' : ''}${count}`, false);
        number.x = x;
        result.addChild(number);
        x += number.width + 2;
        const width = this.fontSize * 0.75, height = this.fontSize * 0.75;
        const down = element === 'earth' || element === 'water';
        const icon = new Graphics();
        icon.moveTo(0, down ? 0 : height).lineTo(width, down ? 0 : height)
          .lineTo(width / 2, down ? height : 0).closePath();
        if (element === 'earth' || element === 'air') {
          const y = down ? height * 0.35 : height * 0.65;
          icon.moveTo(0, y).lineTo(width, y);
        }
        icon.stroke({ color: ELEMENT_COLORS[element], width: 0.9 });
        icon.position.set(x, (this.lineHeight - height) / 2);
        result.addChild(icon);
        x += width + 2;
      });
      this.measured.set(`${heading}:${cell.text}`, result.width);
    } else {
      result = cell.warning ? this.options.configureText(new Text({ text: cell.text,
        style: { fontFamily: 'Arial', fontSize: this.fontSize, fontWeight: heading ? '600' : '400', fill: 0xff9694 } }))
        : this.makeText(cell.text, heading);
      this.measured.set(`${heading}:${cell.text}`, result.width);
    }
    // Treat numbers, separators and element symbols as one hoverable row.
    result.hitArea = new Rectangle(0, 0, Math.max(1, result.width), this.lineHeight);
    result.interactiveChildren = false;
    this.options.tooltip(result, cell.tooltip ?? cell.text);
    this.addChild(result);
    return result;
  }

  layout(width: number): void {
    if (Math.abs(width - this.currentWidth) < 0.5) return;
    this.options.hideTooltip();
    this.currentWidth = width;
    this.pages = paginateStatisticColumns(this.columns, width, this.measure);
    this.pageIndex = Math.max(0, Math.min(this.pageIndex, this.pages.length - 1));
    this.showPage();
  }

  /** Local-space hit testing also lets touch navigation suppress canvas taps. */
  pageControlAt(point: { x: number; y: number }): number | null {
    const index = this.controls.findIndex(control => control.visible &&
      control.hitArea?.contains(point.x - control.x, point.y - control.y));
    return index < 0 ? null : index;
  }

  private showPage(): void {
    for (const column of this.cells) for (const cell of column) cell.visible = false;
    for (const legend of this.legends.values()) for (const label of legend) label.visible = false;
    this.dividers.clear();
    const page = this.pages[this.pageIndex];
    for (const column of page?.columns ?? []) this.cells[column.index]?.forEach((cell, row) => {
      cell.scale.set(1);
      if (cell.width > column.width) cell.scale.x = column.width / cell.width;
      cell.position.set(column.x, row * this.lineHeight);
      cell.visible = true;
    });
    for (const legend of page?.legends ?? []) this.legends.get(legend.group)?.forEach((label, row) => {
      const hasRow = page?.columns.some(column => this.columns[column.index]?.group === legend.group &&
        (this.columns[column.index]?.rows.length ?? 0) > row + 1);
      if (!hasRow) return;
      label.scale.set(1);
      if (label.width > legend.width) label.scale.x = legend.width / label.width;
      label.position.set(legend.x + legend.width, (row + 1) * this.lineHeight);
      label.visible = true;
    });
    for (const x of page?.separators ?? []) this.dividers.moveTo(x, 0).lineTo(x, this.options.height - 1);
    this.dividers.stroke({ width: 0.7, color: MANGA_PALETTE.line, alpha: 0.6 });
    this.controls.forEach((control, index) => {
      // The full hit area remains inside the reserved 28px and the header row.
      control.position.set(this.currentWidth - 28 + index * 14, this.options.height / 2);
      control.anchor.y = 0.5;
      control.hitArea = new Rectangle(0, -this.options.height / 2, 14, this.options.height);
      control.visible = this.pages.length > 1;
      const enabled = index ? this.pageIndex < this.pages.length - 1 : this.pageIndex > 0;
      control.alpha = enabled ? 1 : 0.3;
      control.eventMode = enabled && control.visible ? 'static' : 'none';
    });
    if (page) this.options.pageChanged(this.pageIndex);
  }

  override destroy(): void {
    super.destroy({ children: true, context: true });
    this.bodyStyle.destroy();
    this.headingStyle.destroy();
  }
}
