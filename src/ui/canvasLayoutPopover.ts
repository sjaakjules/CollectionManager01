import type { CatalogueLayoutConfig } from '@/data/catalogueLayout';
import { mountLayoutEditor } from './mountLayoutEditor';
import './canvasLayoutPopover.css';

export interface CanvasLayoutPopoverOptions {
  label: string;
  layout: CatalogueLayoutConfig;
  anchor: () => { left: number; top: number; bottom: number } | null;
  onChange: (layout: CatalogueLayoutConfig) => void;
  onClose: () => void;
  onApply?: () => void;
  allowClean?: boolean;
}

/** One compact editor shared by live automatic tabs and cancellable selections. */
export class CanvasLayoutPopover {
  private root = document.createElement('div');
  private editor: ReturnType<typeof mountLayoutEditor>;
  private apply: HTMLButtonElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private closed = false;

  constructor(private options: CanvasLayoutPopoverOptions) {
    this.root.className = 'canvas-layout-popover';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', options.label);
    const header = document.createElement('div');
    header.className = 'canvas-layout-popover-header';
    const title = document.createElement('strong');
    title.textContent = options.label;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '⌄';
    close.setAttribute('aria-label', options.onApply ? 'Cancel layout preview' : 'Hide layout controls');
    close.onclick = options.onClose;
    header.append(title, close);
    const body = document.createElement('div');
    this.root.append(header, body);
    if (options.onApply) {
      const apply = document.createElement('button');
      apply.className = 'canvas-layout-apply';
      apply.type = 'button';
      apply.textContent = 'Apply';
      apply.onclick = options.onApply;
      this.apply = apply;
      this.updateApply(options.layout);
      this.root.append(apply);
    }
    for (const type of ['pointerdown', 'click', 'dblclick', 'wheel']) this.root.addEventListener(type, event => event.stopPropagation());
    document.body.append(this.root);
    if (options.onApply) {
      this.root.tabIndex = -1;
      this.root.focus({ preventScroll: true });
    }
    this.editor = mountLayoutEditor(body, this.editorProps(options.layout));
    document.addEventListener('pointerdown', this.outside, true);
    document.addEventListener('keydown', this.keydown, true);
    window.addEventListener('resize', this.reposition);
    this.resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(this.reposition);
    this.resizeObserver?.observe(this.root);
    this.reposition();
  }

  private editorProps(layout: CatalogueLayoutConfig) {
    return { layout, onChange: this.change, ariaLabel: this.options.label, allowClean: this.options.allowClean };
  }

  private updateApply(layout: CatalogueLayoutConfig): void {
    if (this.apply && this.options.allowClean) this.apply.disabled = !layout.clean && !layout.steps.length;
  }

  private change = (layout: CatalogueLayoutConfig): void => {
    this.editor.update(this.editorProps(layout));
    this.updateApply(layout);
    this.options.onChange(layout);
    this.reposition();
  };

  private outside = (event: PointerEvent): void => {
    if (this.options.onApply && event.target instanceof Node && !this.root.contains(event.target)) this.options.onClose();
  };

  private keydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    // A tab's inline name field handles its own Escape without hiding the rules.
    if (!this.options.onApply && event.target instanceof HTMLInputElement && !this.root.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    this.options.onClose();
  };

  reposition = (): void => {
    if (this.closed) return;
    const anchor = this.options.anchor();
    if (!anchor) { this.root.hidden = true; return; }
    this.root.hidden = false;
    const width = this.root.offsetWidth;
    const height = this.root.offsetHeight;
    const top = anchor.top - height - 8;
    this.root.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, anchor.left - width / 2))}px`;
    this.root.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, top >= 8 ? top : anchor.bottom + 8))}px`;
  };

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    document.removeEventListener('pointerdown', this.outside, true);
    document.removeEventListener('keydown', this.keydown, true);
    window.removeEventListener('resize', this.reposition);
    this.resizeObserver?.disconnect();
    this.editor.destroy();
    this.root.remove();
  }
}
