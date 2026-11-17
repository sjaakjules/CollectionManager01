import './canvasStatisticTooltip.css';

/** Displays text from a canvas statistic at a viewport client position. */
export class CanvasStatisticTooltip {
  private element: HTMLDivElement | undefined;
  private readonly view: Window;
  private width = 0;
  private height = 0;
  private destroyed = false;

  constructor(private readonly host: HTMLElement = document.body) {
    this.view = host.ownerDocument.defaultView ?? window;
  }

  show(text: string, point: { x: number; y: number }): void {
    if (this.destroyed) return;
    let element = this.element;
    if (!element) {
      element = this.host.ownerDocument.createElement('div');
      element.className = 'canvas-statistic-tooltip';
      element.setAttribute('role', 'tooltip');
      element.hidden = true;
      this.host.append(element);
      this.element = element;
    }
    const wasHidden = element.hidden;
    if (wasHidden) {
      this.view.addEventListener('pointerdown', this.hide, true);
      this.view.addEventListener('wheel', this.hide, { capture: true, passive: true });
      this.view.addEventListener('keydown', this.keydown, true);
      this.view.addEventListener('blur', this.hide);
      this.view.addEventListener('resize', this.hide);
      element.hidden = false;
    }
    if (wasHidden || element.textContent !== text) {
      element.textContent = text;
      this.width = element.offsetWidth;
      this.height = element.offsetHeight;
    }
    const margin = 8;
    const gap = 12;
    const maxLeft = this.view.innerWidth - this.width - margin;
    const maxTop = this.view.innerHeight - this.height - margin;
    const top = point.y + gap <= maxTop ? point.y + gap : point.y - gap - this.height;
    element.style.left = `${Math.max(margin, Math.min(point.x + gap, maxLeft))}px`;
    element.style.top = `${Math.max(margin, Math.min(top, maxTop))}px`;
  }

  hide = (): void => {
    if (!this.element || this.element.hidden) return;
    this.element.hidden = true;
    this.view.removeEventListener('pointerdown', this.hide, true);
    this.view.removeEventListener('wheel', this.hide, true);
    this.view.removeEventListener('keydown', this.keydown, true);
    this.view.removeEventListener('blur', this.hide);
    this.view.removeEventListener('resize', this.hide);
  };

  destroy(): void {
    this.hide();
    this.element?.remove();
    this.element = undefined;
    this.destroyed = true;
  }

  private keydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.hide();
  };
}
