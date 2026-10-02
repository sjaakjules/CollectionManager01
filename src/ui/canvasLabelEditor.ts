export interface CanvasLabelEditorOptions {
  title: string;
  /** Omit for a new label. An existing label may be saved blank to remove it. */
  initialText?: string;
  onSave: (text: string) => void;
  onClose?: () => void;
}

let nextEditorId = 0;

/** DOM-only editor; callbacks keep label mutations in the canvas controller. */
export function openCanvasLabelEditor(options: CanvasLabelEditorOptions): () => void {
  const previousFocus = document.activeElement;
  const editing = options.initialText !== undefined;
  const id = `canvas-label-editor-${++nextEditorId}`;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay canvas-label-editor-overlay';
  const dialog = document.createElement('form');
  dialog.className = 'canvas-label-editor';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.setAttribute('aria-describedby', `${id}-hint`);
  const heading = document.createElement('h2');
  heading.id = `${id}-title`;
  heading.textContent = options.title;
  const label = document.createElement('label');
  label.htmlFor = `${id}-input`;
  label.textContent = 'Label name';
  const input = document.createElement('input');
  input.id = `${id}-input`;
  input.name = 'label-name';
  input.type = 'text';
  input.autocomplete = 'off';
  input.value = options.initialText ?? '';
  input.setAttribute('aria-describedby', `${id}-hint`);
  const hint = document.createElement('p');
  hint.id = `${id}-hint`;
  hint.textContent = editing
    ? 'Leave the name blank to remove only this label. Your cards stay.'
    : 'Drop cards on the label name to make a group.';
  const actions = document.createElement('div');
  actions.className = 'canvas-label-editor-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'canvas-label-editor-save';
  const updateSave = () => {
    const blank = input.value.trim().length === 0;
    save.disabled = !editing && blank;
    save.textContent = editing && blank ? 'Remove label' : 'Save';
    save.classList.toggle('remove', editing && blank);
  };
  input.addEventListener('input', updateSave);
  updateSave();
  actions.append(cancel, save);
  dialog.append(heading, label, input, hint, actions);
  overlay.append(dialog);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', handleKeyDown, true);
    overlay.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    options.onClose?.();
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    // Keep canvas shortcuts, panning and delete commands out of the editor.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const controls = [input, cancel, save].filter((control) => !control.disabled);
      const current = controls.findIndex((control) => control === document.activeElement);
      const next = current < 0 ? 0 : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      controls[next]?.focus();
    }
  };
  cancel.addEventListener('click', close);
  overlay.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    if (event.target === overlay) close();
  });
  dialog.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (closed || (!editing && !text)) return;
    close();
    options.onSave(text);
  });
  document.addEventListener('keydown', handleKeyDown, true);
  document.body.append(overlay);
  input.focus();
  input.select();
  return close;
}
