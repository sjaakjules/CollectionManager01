// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openCanvasLabelEditor, type CanvasLabelEditorOptions } from './canvasLabelEditor';

const closers: Array<() => void> = [];
function open(options: Omit<CanvasLabelEditorOptions, 'position'>) {
  const editor = openCanvasLabelEditor({ ...options, position: { x: 120, y: 80, fontSize: 14 } });
  closers.push(editor.close);
  const input = document.querySelector<HTMLInputElement>('input[name="label-name"]');
  if (!input) throw new Error('Missing inline label editor');
  return { ...editor, input };
}
function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function key(value: string, isComposing = false) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: value, isComposing, bubbles: true, cancelable: true }));
}
afterEach(() => {
  closers.splice(0).forEach(close => close());
  document.body.replaceChildren();
});

describe('inline canvas label editor', () => {
  it('places a native caret at the canvas point and commits trimmed text on an outside click', () => {
    const onSave = vi.fn();
    const { input } = open({ title: 'New label', onSave });
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-label')).toBe('New label');
    expect(input.style.left).toBe('120px');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    type(input, '  Removal package  ');
    const nextAction = vi.fn();
    document.body.addEventListener('pointerdown', nextAction, { once: true });
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith('Removal package');
    expect(nextAction).toHaveBeenCalledOnce();
    expect(input.isConnected).toBe(false);
  });

  it('discards empty drafts and does not delete an existing label when cleared', () => {
    const onSave = vi.fn();
    const first = open({ title: 'New label', onSave });
    type(first.input, '  ');
    first.input.blur();
    expect(first.input.isConnected).toBe(false);
    const existing = open({ title: 'Edit label', initialText: 'Draw', onSave });
    type(existing.input, '');
    key('Enter');
    expect(existing.input.isConnected).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('starts editing at the end, follows camera changes, and saves on blur once', () => {
    const onSave = vi.fn();
    const { input, reposition, commit } = open({ title: 'Edit label', initialText: 'Draw', onSave });
    expect(input.selectionStart).toBe(4);
    expect(input.selectionEnd).toBe(4);
    type(input, 'Draw spells');
    reposition({ x: 300, y: 160, fontSize: 20 });
    expect(input.style.left).toBe('300px');
    expect(input.style.top).toBe('160px');
    expect(input.value).toBe('Draw spells');
    input.blur();
    commit();
    expect(onSave).toHaveBeenCalledExactlyOnceWith('Draw spells');
  });

  it('cancels with Escape, restores focus and cleans up once', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const onSave = vi.fn(); const onClose = vi.fn();
    const { close, input } = open({ title: 'Edit label', initialText: 'Draw', onSave, onClose });
    type(input, 'Discard this');
    key('Escape');
    expect(document.activeElement).toBe(opener);
    expect(onSave).not.toHaveBeenCalled();
    close();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps IME Enter available for Japanese composition', () => {
    const onSave = vi.fn();
    const { input } = open({ title: 'New label', onSave });
    type(input, '魔法');
    key('Enter', true);
    expect(input.isConnected).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    key('Enter');
    expect(onSave).toHaveBeenCalledExactlyOnceWith('魔法');
  });

  it('blocks canvas shortcuts while typing, then restores them', () => {
    const shortcut = vi.fn();
    window.addEventListener('keydown', shortcut);
    const { close } = open({ title: 'New label', onSave: vi.fn() });
    key(' '); key('Delete');
    expect(shortcut).not.toHaveBeenCalled();
    close(); key(' ');
    expect(shortcut).toHaveBeenCalledOnce();
    window.removeEventListener('keydown', shortcut);
  });

  it('does not save unchanged text or a draft closed by canvas teardown', () => {
    const onSave = vi.fn();
    open({ title: 'Edit label', initialText: 'Draw', onSave }).commit();
    const editor = open({ title: 'New label', onSave });
    type(editor.input, 'Unfinished'); editor.close();
    expect(onSave).not.toHaveBeenCalled();
  });
});
