// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openCanvasLabelEditor, type CanvasLabelEditorOptions } from './canvasLabelEditor';

const closers: Array<() => void> = [];
function open(options: CanvasLabelEditorOptions) {
  const close = openCanvasLabelEditor(options);
  closers.push(close);
  const dialog = document.querySelector<HTMLFormElement>('[role="dialog"]');
  const input = document.querySelector<HTMLInputElement>('input[name="label-name"]');
  const save = document.querySelector<HTMLButtonElement>('button[type="submit"]');
  const cancel = document.querySelector<HTMLButtonElement>('button[type="button"]');
  if (!dialog || !input || !save || !cancel) throw new Error('Missing label editor');
  return { close, dialog, input, save, cancel };
}
function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function key(value: string, shiftKey = false) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }));
}
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  document.body.replaceChildren();
});

describe('canvas label editor', () => {
  it('focuses the labeled input and saves trimmed text without a native browser prompt', () => {
    const onSave = vi.fn();
    const { input, save } = open({ title: 'Add label', onSave });
    expect(document.activeElement).toBe(input);
    expect(document.querySelector('label')?.htmlFor).toBe(input.id);
    type(input, '  Removal package  ');
    save.click();
    expect(onSave).toHaveBeenCalledWith('Removal package');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('does not create an empty label', () => {
    const onSave = vi.fn();
    const { input, save, dialog } = open({ title: 'Add label', onSave });
    type(input, '   ');
    expect(save.disabled).toBe(true);
    dialog.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSave).not.toHaveBeenCalled();
    expect(dialog.isConnected).toBe(true);
  });

  it('explains label-only deletion and permits an empty edit', () => {
    const onSave = vi.fn();
    const { input, save, dialog } = open({ title: 'Edit label', initialText: 'Draw', onSave });
    expect(dialog.textContent).toContain('Your cards stay');
    type(input, '');
    expect(save.textContent).toBe('Remove label');
    expect(save.disabled).toBe(false);
    save.click();
    expect(onSave).toHaveBeenCalledWith('');
  });

  it('cancels with Escape and restores focus while cleaning up only once', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const onSave = vi.fn();
    const onClose = vi.fn();
    const { close } = open({ title: 'Edit label', initialText: 'Draw', onSave, onClose });
    key('Escape');
    expect(document.activeElement).toBe(opener);
    expect(onSave).not.toHaveBeenCalled();
    close();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('traps keyboard focus and skips a disabled Save button', () => {
    const { input, cancel, save } = open({ title: 'Add label', onSave: vi.fn() });
    key('Tab');
    expect(document.activeElement).toBe(cancel);
    key('Tab');
    expect(document.activeElement).toBe(input);
    type(input, 'Draw');
    key('Tab', true);
    expect(document.activeElement).toBe(save);
    key('Tab');
    expect(document.activeElement).toBe(input);
  });

  it('blocks canvas keyboard shortcuts only while the editor is open', () => {
    const canvasShortcut = vi.fn();
    window.addEventListener('keydown', canvasShortcut);
    const { cancel } = open({ title: 'Add label', onSave: vi.fn() });
    key(' ');
    expect(canvasShortcut).not.toHaveBeenCalled();
    cancel.click();
    key(' ');
    expect(canvasShortcut).toHaveBeenCalledOnce();
    window.removeEventListener('keydown', canvasShortcut);
  });
});
