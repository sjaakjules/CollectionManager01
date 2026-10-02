// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckActionDialog } from './DeckActionDialog';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('deck action confirmation', () => {
  it.each(['reset', 'remove'] as const)('defaults %s to Cancel and only proceeds on explicit confirmation', async (action) => {
    const onConfirm = vi.fn(); const onCancel = vi.fn();
    await act(async () => root.render(<DeckActionDialog action={action} deckName="My deck" onConfirm={onConfirm} onCancel={onCancel} />));
    expect(document.activeElement?.textContent).toBe('Cancel');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('My deck');
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onCancel).toHaveBeenCalledOnce(); expect(onConfirm).not.toHaveBeenCalled();
    const buttons = container.querySelectorAll('button');
    await act(async () => buttons[0]?.click());
    expect(onConfirm).not.toHaveBeenCalled();
    await act(async () => buttons[1]?.click());
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
