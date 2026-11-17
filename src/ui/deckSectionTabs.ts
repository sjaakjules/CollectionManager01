import { DECK_REGION_NAMES } from '@/canvas/deckRegionInteraction';
import type { CanvasAreaBounds } from '@/canvas/canvasAreas';
import type { CanvasPoint, DeckLayoutSection, DeckSectionLayoutTab } from '@/canvas/deckSectionLayouts';
import { getDeckSectionTabMode } from '@/canvas/deckSectionLayouts';
import { CANVAS_LABEL_FONT_SIZE } from '@/rendering/deckHeadingStyle';

interface SectionTabsData {
  areaId: string;
  section: DeckLayoutSection;
  bounds: CanvasAreaBounds;
  minX?: number;
  activeId: string;
  tabs: DeckSectionLayoutTab[];
}

interface TabsCallbacks {
  select: (areaId: string, section: DeckLayoutSection, tabId: string) => void;
  edit: (areaId: string, section: DeckLayoutSection, tabId: string | null, button: HTMLButtonElement) => void;
  toggleMode: (areaId: string, section: DeckLayoutSection, tabId: string, button: HTMLButtonElement) => void;
}

interface TabRow {
  group: HTMLDivElement;
  list: HTMLDivElement;
  overflow: HTMLDivElement;
  more: HTMLButtonElement;
  tabs: Map<string, TabControl>;
  tabIds: string[];
  bounds: CanvasAreaBounds;
  minX?: number;
  activeId: string;
  capacity: number;
  width: number;
  reservedWidth: number;
  zoom: number;
}

interface TabControl {
  name: HTMLButtonElement;
  wrapper: HTMLSpanElement;
  width: number;
}

const TAB_HEIGHT = 22;
const TAB_FONT_SIZE = CANVAS_LABEL_FONT_SIZE;
const TAB_MODE_WIDTH = 16;
const TAB_NAME_PADDING = 4;
const CONTROL_GAP = 3;
const VIEWPORT_MARGIN = 24;

/** Native controls stay usable with a keyboard while following their canvas sections. */
export class DeckSectionTabs {
  private rows = new Map<string, TabRow>();
  private pending: { button: HTMLButtonElement; timer: ReturnType<typeof setTimeout> } | null = null;
  private openRow: TabRow | null = null;
  private measurement: CanvasRenderingContext2D | null | undefined;

  constructor(private host: HTMLElement, private callbacks: TabsCallbacks) {}

  sync(sections: SectionTabsData[]): void {
    const keys = new Set<string>();
    for (const { areaId, section, bounds, minX, activeId, tabs } of sections) {
      const key = `${areaId}:${section}`;
      keys.add(key);
      let row = this.rows.get(key);
      if (!row) {
        const group = document.createElement('div');
        group.className = 'deck-section-layouts';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', `${DECK_REGION_NAMES[section]} layouts`);
        group.style.setProperty('--layout-tab-height', `${TAB_HEIGHT}px`);
        group.style.setProperty('--layout-tab-font-size', `${TAB_FONT_SIZE}px`);
        group.style.setProperty('--layout-tab-mode-width', `${TAB_MODE_WIDTH}px`);
        group.style.setProperty('--layout-tab-name-padding', `${TAB_NAME_PADDING}px`);
        group.style.setProperty('--layout-tab-gap', `${CONTROL_GAP}px`);
        group.hidden = true;
        const list = document.createElement('div');
        list.className = 'deck-section-layout-list';
        const more = document.createElement('button');
        more.className = 'deck-section-layout-more';
        more.type = 'button';
        more.textContent = '…';
        more.title = `More ${DECK_REGION_NAMES[section]} layouts`;
        more.setAttribute('aria-label', more.title);
        more.setAttribute('aria-expanded', 'false');
        more.hidden = true;
        const overflow = document.createElement('div');
        overflow.className = 'deck-section-layout-overflow';
        overflow.setAttribute('role', 'group');
        overflow.setAttribute('aria-label', more.title);
        overflow.hidden = true;
        const add = document.createElement('button');
        add.className = 'deck-section-layout-add';
        add.type = 'button';
        add.textContent = '+';
        add.title = `Add ${DECK_REGION_NAMES[section]} layout`;
        add.setAttribute('aria-label', add.title);
        add.onclick = () => {
          this.cancelPending();
          this.callbacks.edit(areaId, section, null, add);
        };
        group.append(list, more, add, overflow);
        this.host.append(group);
        const created: TabRow = { group, list, more, overflow, tabs: new Map(), tabIds: [], bounds, activeId,
          capacity: -1, width: 0, reservedWidth: 0, zoom: 1 };
        more.onclick = () => this.toggleOverflow(created);
        row = created;
        this.rows.set(key, row);
      }
      row.bounds = bounds;
      row.minX = minX;
      row.activeId = activeId;
      row.tabIds = tabs.map(tab => tab.id);
      row.capacity = -1;
      const tabIds = new Set(row.tabIds);
      for (const [id, control] of row.tabs) if (!tabIds.has(id)) {
        control.wrapper.remove();
        row.tabs.delete(id);
      }
      for (const tab of tabs) {
        const { id, name } = tab;
        let entry = row.tabs.get(id);
        if (!entry) {
          const tabRow = row;
          const control = document.createElement('button');
          control.type = 'button';
          control.className = 'deck-section-layout-name';
          const select = () => {
            const fromOverflow = tabRow.overflow.contains(control);
            this.callbacks.select(areaId, section, id);
            if (fromOverflow && tabRow.list.contains(control)) {
              this.closeOverflow();
              control.focus({ preventScroll: true });
            }
          };
          let renamedOnSecondClick = false;
          control.onclick = (event) => {
            // Give a second click a chance to rename before switching can move the tab.
            if (this.pending?.button === control) {
              this.cancelPending();
              renamedOnSecondClick = true;
              this.callbacks.edit(areaId, section, id, control);
            } else if (event.detail === 0) {
              this.cancelPending();
              select();
            } else {
              renamedOnSecondClick = false;
              this.cancelPending();
              const timer = setTimeout(() => {
                this.pending = null;
                if (control.isConnected) select();
              }, 275);
              this.pending = { button: control, timer };
            }
          };
          control.ondblclick = () => {
            this.cancelPending();
            if (!renamedOnSecondClick) this.callbacks.edit(areaId, section, id, control);
            renamedOnSecondClick = false;
          };
          control.onkeydown = (event) => {
            if (event.key !== 'F2') return;
            event.preventDefault();
            this.cancelPending();
            this.callbacks.edit(areaId, section, id, control);
          };
          const wrapper = document.createElement('span');
          wrapper.className = 'deck-section-layout-tab';
          const mode = document.createElement('button');
          mode.type = 'button';
          mode.className = 'deck-section-layout-mode';
          mode.ondblclick = event => {
            event.stopPropagation();
            this.cancelPending();
            this.callbacks.toggleMode(areaId, section, id, control);
          };
          mode.onclick = event => {
            this.cancelPending();
            if (event.detail === 0) this.callbacks.toggleMode(areaId, section, id, control);
          };
          wrapper.append(control, mode);
          row.list.append(wrapper);
          entry = { name: control, wrapper, width: 0 };
          row.tabs.set(id, entry);
        }
        const button = entry.name;
        if (button.textContent !== name) {
          button.textContent = name;
          entry.width = this.measureTab(name);
          entry.wrapper.style.setProperty('--layout-tab-width', `${entry.width}px`);
        }
        const automatic = getDeckSectionTabMode(tab) === 'automatic';
        const mode = button.nextElementSibling;
        if (mode instanceof HTMLButtonElement) {
          mode.textContent = automatic ? '@' : 'ⓒ';
          mode.title = `${automatic ? 'Automatic' : 'Custom'} · Double-click to make ${automatic ? 'custom' : 'automatic'}`;
          mode.setAttribute('aria-label', `${name}: ${mode.title}`);
        }
        button.title = `${name} · Double-click or press F2 to ${automatic ? 'edit name and layout' : 'rename'}`;
        entry.wrapper.classList.toggle('is-active', id === activeId);
        button.setAttribute('aria-pressed', String(id === activeId));
      }
    }
    for (const [key, row] of this.rows) if (!keys.has(key)) {
      if (this.openRow === row) this.closeOverflow();
      row.group.remove();
      this.rows.delete(key);
    }
  }

  getButton(areaId: string, section: DeckLayoutSection, tabId: string): HTMLButtonElement | undefined {
    return this.rows.get(`${areaId}:${section}`)?.tabs.get(tabId)?.name;
  }

  /** Space reserved in canvas units, independent of camera zoom or clipping. */
  getReservedWidth(areaId: string, section: DeckLayoutSection): number {
    return this.rows.get(`${areaId}:${section}`)?.reservedWidth ?? 0;
  }

  position(project: (point: CanvasPoint) => CanvasPoint, screen: { width: number; height: number }, zoom: number, hide: boolean): void {
    const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    for (const row of this.rows.values()) {
      const bounds = row.bounds;
      const right = bounds.x + bounds.width - CONTROL_GAP;
      // Fit in canvas space once. Zooming must not change which tabs fit, the
      // statistics' reserved space, or the inset from the section corner.
      const capacity = Math.max(0, Math.floor(right - Math.max(bounds.x, row.minX ?? bounds.x)));
      if (capacity !== row.capacity) this.fitControls(row, capacity);
      const at = project({ x: right - row.width, y: bounds.y + CONTROL_GAP });
      row.zoom = scale;
      row.reservedWidth = row.width ? row.width + CONTROL_GAP : 0;
      row.group.style.transform = `translate(${at.x}px, ${at.y}px) scale(${scale})`;
      row.group.hidden = hide || !row.width || at.x >= screen.width || at.x + row.width * scale <= 0 ||
        at.y >= screen.height || at.y + TAB_HEIGHT * scale <= 0;
      if (row.group.hidden) {
        if (this.openRow === row) this.closeOverflow();
        continue;
      }
      if (this.openRow === row) this.positionOverflow(row, screen, at.x + row.width * scale, at.y);
    }
  }

  private measureTab(name: string): number {
    if (this.measurement === undefined) {
      this.measurement = this.host.ownerDocument.createElement('canvas').getContext('2d');
      if (this.measurement) this.measurement.font = `${TAB_FONT_SIZE}px Arial`;
    }
    const width = this.measurement?.measureText(name).width ?? name.length * TAB_FONT_SIZE;
    return Math.ceil(width) + TAB_NAME_PADDING * 2 + TAB_MODE_WIDTH + 2;
  }

  private fitControls(row: TabRow, capacity: number): void {
    row.capacity = capacity;
    const widthFor = (id: string) => (row.tabs.get(id)?.width ?? 0) + CONTROL_GAP;
    const fullWidth = row.tabIds.reduce((width, id) => width + widthFor(id), TAB_HEIGHT);
    const visible = new Set<string>();
    let width = fullWidth;
    const needsOverflow = fullWidth > capacity;
    if (needsOverflow) {
      width = TAB_HEIGHT * 2 + CONTROL_GAP;
      const activeWidth = widthFor(row.activeId);
      if (width + activeWidth <= capacity) {
        visible.add(row.activeId);
        width += activeWidth;
        for (const id of row.tabIds) if (id !== row.activeId && width + widthFor(id) <= capacity) {
          visible.add(id);
          width += widthFor(id);
        }
      }
    } else {
      for (const id of row.tabIds) visible.add(id);
    }
    row.width = width <= capacity ? width : 0;
    row.group.style.width = `${row.width}px`;
    row.list.hidden = visible.size === 0;
    row.more.hidden = !needsOverflow || !row.width;
    const selection = visible.has(row.activeId) ? '' : row.tabs.get(row.activeId)?.name.textContent;
    row.more.setAttribute('aria-label', selection ? `${row.more.title} · ${selection} selected` : row.more.title);
    if (row.more.hidden && this.openRow === row) this.closeOverflow();
    const focused = row.group.ownerDocument.activeElement;
    const inline: HTMLSpanElement[] = [];
    const hidden: HTMLSpanElement[] = [];
    for (const id of row.tabIds) {
      const wrapper = row.tabs.get(id)?.wrapper;
      if (wrapper) (visible.has(id) ? inline : hidden).push(wrapper);
    }
    this.placeTabs(row.list, inline);
    this.placeTabs(row.overflow, hidden);
    if (focused instanceof HTMLButtonElement && row.group.contains(focused) && focused !== row.group.ownerDocument.activeElement) {
      (row.overflow.hidden && row.overflow.contains(focused) ? row.more : focused).focus({ preventScroll: true });
    }
  }

  private placeTabs(parent: HTMLDivElement, tabs: HTMLSpanElement[]): void {
    tabs.forEach((tab, index) => {
      const current = parent.children[index];
      if (tab !== current) parent.insertBefore(tab, current ?? null);
    });
  }

  private toggleOverflow(row: TabRow): void {
    this.cancelPending();
    if (this.openRow === row) {
      this.closeOverflow(true);
      return;
    }
    this.closeOverflow();
    this.openRow = row;
    const view = row.group.ownerDocument.defaultView;
    const rect = row.group.getBoundingClientRect();
    if (view) this.positionOverflow(row, { width: view.innerWidth, height: view.innerHeight }, rect.right, rect.top);
    row.overflow.hidden = false;
    row.more.setAttribute('aria-expanded', 'true');
    row.overflow.querySelector('button')?.focus({ preventScroll: true });
    row.group.ownerDocument.addEventListener('pointerdown', this.dismissOutside);
    row.group.ownerDocument.addEventListener('keydown', this.dismissOnEscape);
  }

  private positionOverflow(row: TabRow, screen: { width: number; height: number }, right: number, top: number): void {
    const above = (top - VIEWPORT_MARGIN) / row.zoom;
    const below = (screen.height - top - VIEWPORT_MARGIN) / row.zoom - TAB_HEIGHT;
    const openAbove = below < 180 && above > below;
    const leftSpace = (right - VIEWPORT_MARGIN) / row.zoom;
    const rightSpace = (screen.width - right - VIEWPORT_MARGIN) / row.zoom + row.width;
    const alignLeft = rightSpace > leftSpace;
    row.overflow.classList.toggle('is-above', openAbove);
    row.overflow.classList.toggle('is-start-aligned', alignLeft);
    row.overflow.style.maxHeight = `${Math.max(0, Math.min(240, (openAbove ? above : below) - CONTROL_GAP))}px`;
    row.overflow.style.maxWidth = `${Math.max(leftSpace, rightSpace)}px`;
  }

  private closeOverflow(restoreFocus = false): void {
    const row = this.openRow;
    if (!row) return;
    this.openRow = null;
    row.overflow.hidden = true;
    row.more.setAttribute('aria-expanded', 'false');
    row.group.ownerDocument.removeEventListener('pointerdown', this.dismissOutside);
    row.group.ownerDocument.removeEventListener('keydown', this.dismissOnEscape);
    if (restoreFocus) row.more.focus({ preventScroll: true });
  }

  private dismissOutside = (event: PointerEvent): void => {
    if (event.target instanceof Node && !this.openRow?.group.contains(event.target)) {
      this.cancelPending();
      this.closeOverflow();
    }
  };

  private dismissOnEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelPending();
      this.closeOverflow(true);
    }
  };

  cancelPending(): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending = null;
  }

  destroy(): void {
    this.cancelPending();
    this.closeOverflow();
    for (const row of this.rows.values()) row.group.remove();
    this.rows.clear();
  }
}
