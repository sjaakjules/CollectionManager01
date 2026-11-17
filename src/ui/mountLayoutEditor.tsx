import { createRoot } from 'react-dom/client';
import { LayoutEditor, type LayoutEditorProps } from './LayoutEditor';

export interface MountedLayoutEditor {
  update: (props: LayoutEditorProps) => void;
  destroy: () => void;
}

/** Mount the same controls in a DOM overlay opened by the canvas. */
export function mountLayoutEditor(container: HTMLElement, props: LayoutEditorProps): MountedLayoutEditor {
  const root = createRoot(container);
  let destroyed = false;
  const update = (next: LayoutEditorProps) => {
    if (!destroyed) root.render(<LayoutEditor {...next} />);
  };
  update(props);
  return {
    update,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      // The canvas can release its overlay from a React effect cleanup.
      queueMicrotask(() => root.unmount());
    },
  };
}
