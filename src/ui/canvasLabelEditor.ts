export interface CanvasLabelEditorPosition {
  x: number;
  y: number;
  fontSize: number;
}

export interface CanvasLabelEditorOptions {
  title: string;
  position: CanvasLabelEditorPosition;
  initialText?: string;
  placeholder?: string;
  maxLength?: number;
  onSave: (text: string) => void;
  onClose?: () => void;
}

export interface CanvasLabelEditor {
  /** Discard the draft (Escape, canvas destruction). */
  close: () => void;
  commit: () => void;
  reposition: (position: CanvasLabelEditorPosition) => void;
}

/** A native caret on the canvas; label data changes only when the draft commits. */
export function openCanvasLabelEditor(options: CanvasLabelEditorOptions): CanvasLabelEditor {
  const previousFocus = document.activeElement;
  const input = document.createElement('input');
  input.className = 'canvas-label-input';
  input.name = 'label-name';
  input.type = 'text';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', options.title);
  input.value = options.initialText ?? '';
  input.placeholder = options.placeholder ?? 'Label name';
  if (options.maxLength) input.maxLength = options.maxLength;
  let closed = false;
  let fontSize = options.position.fontSize;
  const resize = () => {
    // scrollWidth accounts for proportional glyphs, including Japanese input.
    input.style.width = '1px';
    input.style.width = `${Math.max(fontSize * 7, input.scrollWidth + 8)}px`;
  };
  const reposition = (position: CanvasLabelEditorPosition) => {
    fontSize = Math.max(12, position.fontSize);
    input.style.left = `${position.x}px`;
    input.style.top = `${position.y}px`;
    input.style.fontSize = `${fontSize}px`;
    input.style.maxWidth = `${Math.max(40, window.innerWidth - position.x - 12)}px`;
    resize();
  };
  const finish = (save: boolean, restoreFocus = false) => {
    if (closed) return;
    closed = true;
    const text = input.value.trim();
    document.removeEventListener('pointerdown', handleOutsidePointer, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    input.removeEventListener('blur', commit);
    input.remove();
    options.onClose?.();
    // Clearing a draft never accidentally deletes an existing group.
    if (save && text && text !== options.initialText) options.onSave(text);
    if (restoreFocus && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
  };
  const commit = () => finish(true);
  const handleOutsidePointer = (event: PointerEvent) => {
    if (event.target !== input) commit();
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault();
      finish(event.key === 'Enter', true);
    } else if (event.key === 'Tab') {
      // Return focus to the opener before allowing normal keyboard navigation.
      finish(true, true);
    }
  };
  input.addEventListener('input', resize);
  input.addEventListener('blur', commit);
  input.addEventListener('pointerdown', event => event.stopPropagation());
  document.addEventListener('pointerdown', handleOutsidePointer, true);
  document.addEventListener('keydown', handleKeyDown, true);
  document.body.append(input);
  reposition(options.position);
  input.focus({ preventScroll: true });
  input.setSelectionRange(input.value.length, input.value.length);
  return { close: () => finish(false), commit, reposition };
}
