import { useRef, useState, type PointerEvent } from 'react';
import {
  CATALOGUE_FIELD_LABELS, CATALOGUE_LAYOUT_FIELDS, LAYOUT_COLUMNS_MAX, LAYOUT_COLUMNS_MIN, LAYOUT_DIRECTIONS,
  getLayoutStepAxis, insertCatalogueLayoutStep, resolveLayoutSteps, type CatalogueLayoutConfig, type CatalogueLayoutField,
  type CatalogueLayoutStep,
} from '@/data/catalogueLayout';
import '@/styles/layout-editor.css';

export interface LayoutEditorProps {
  layout: CatalogueLayoutConfig;
  onChange: (layout: CatalogueLayoutConfig) => void;
  ariaLabel?: string;
  onReset?: () => void;
  allowClean?: boolean;
}

interface LayoutDrag {
  field: CatalogueLayoutField;
  originX: number;
  originY: number;
  pointerId: number;
  active: boolean;
}

export function LayoutEditor({ layout: savedLayout, onChange, ariaLabel = 'Card layout', onReset, allowClean = false }: LayoutEditorProps) {
  const layout = { ...savedLayout, steps: resolveLayoutSteps(savedLayout.steps) };
  const automaticWidth = layout.columnMode === 'auto';
  const canChangeWidth = !allowClean || layout.clean === true || layout.steps.some(step => step.mode === 'group');
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [draggingField, setDraggingField] = useState<CatalogueLayoutField | null>(null);
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<LayoutDrag | null>(null);
  const recentDrag = useRef<{ field: CatalogueLayoutField; time: number } | null>(null);

  const change = (next: CatalogueLayoutConfig, message: string) => {
    onChange(next);
    setAnnouncement(message);
  };
  const updateStep = (field: CatalogueLayoutField, changes: Partial<Omit<CatalogueLayoutStep, 'field'>>) => {
    const steps = layout.steps.map((step) => step.field === field ? { ...step, ...changes } : step);
    change({ ...layout, steps }, `${CATALOGUE_FIELD_LABELS[field]} layout updated`);
  };
  const removeClean = () => {
    const next = { ...layout };
    delete next.clean;
    change(next, 'Clean removed');
  };
  const insert = (field: CatalogueLayoutField, index: number) => {
    const next = insertCatalogueLayoutStep(layout, field, index);
    if (next.steps.every((step, i) => step === layout.steps[i])) return;
    change(next, `${CATALOGUE_FIELD_LABELS[field]} placed in layout`);
  };

  const hitInsertion = (x: number, y: number): number | null => {
    for (const element of panel.current?.querySelectorAll<HTMLElement>('[data-layout-insert-index]') ?? []) {
      const rect = element.getBoundingClientRect();
      if (x >= rect.left - 6 && x <= rect.right + 6 && y >= rect.top - 6 && y <= rect.bottom + 6) {
        return Number(element.dataset.layoutInsertIndex);
      }
    }
    for (const element of panel.current?.querySelectorAll<HTMLElement>('[data-layout-node-index]') ?? []) {
      const rect = element.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return Number(element.dataset.layoutNodeIndex) + (x >= rect.left + rect.width / 2 ? 1 : 0);
      }
    }
    return null;
  };
  const finishDrag = (pointerId: number) => {
    const current = drag.current;
    if (current?.pointerId !== pointerId) return null;
    drag.current = null;
    setDraggingField(null);
    setDropIndex(null);
    return current;
  };
  const pointerHandlers = (field: CatalogueLayoutField) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || drag.current) return;
      const targetButton = event.target instanceof Element ? event.target.closest('button') : null;
      if (targetButton && targetButton !== event.currentTarget) return;
      event.stopPropagation();
      drag.current = { field, originX: event.clientX, originY: event.clientY, pointerId: event.pointerId, active: false };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.stopPropagation();
      if (!current.active && Math.hypot(event.clientX - current.originX, event.clientY - current.originY) < 6) return;
      event.preventDefault();
      current.active = true;
      setDraggingField(current.field);
      setDropIndex(hitInsertion(event.clientX, event.clientY));
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const current = finishDrag(event.pointerId);
      if (!current) return;
      event.stopPropagation();
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (!current.active) return;
      event.preventDefault();
      recentDrag.current = { field: current.field, time: performance.now() };
      const index = hitInsertion(event.clientX, event.clientY);
      if (index !== null) insert(current.field, index);
    },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => { finishDrag(event.pointerId); },
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => { finishDrag(event.pointerId); },
  });
  const justDragged = (field: CatalogueLayoutField) => (
    recentDrag.current?.field === field && performance.now() - recentDrag.current.time < 400
  );
  const connector = (index: number) => (
    <div
      className={`layout-editor-connector ${dropIndex === index ? 'drop-active' : ''}`}
      aria-hidden="true"
      data-layout-insert-index={index}
    >{dropIndex === index || !layout.steps.length ? '+' : '→'}</div>
  );

  return (
    <section ref={panel} className="layout-editor" aria-label={ariaLabel}>
      <div className="layout-editor-palette" role="group" aria-label="Available layout steps">
        {allowClean && !layout.clean && (
          <button type="button" className="tool-button" title="Stack matching copies before arranging the selection"
            onClick={() => change({ ...layout, clean: true }, 'Clean added')}>+ Clean</button>
        )}
        {CATALOGUE_LAYOUT_FIELDS.filter((field) => !layout.steps.some((step) => step.field === field)).map((field) => (
          <button
            key={field} type="button" className="tool-button layout-editor-palette-step"
            {...pointerHandlers(field)}
            onClick={(event) => { if (event.detail === 0 || !justDragged(field)) insert(field, layout.steps.length); }}
            title="Click to append, or drag between steps"
          >+ {CATALOGUE_FIELD_LABELS[field]}</button>
        ))}
      </div>

      <div className="layout-editor-flow" role="group" aria-label="Layout operation order">
        {allowClean && layout.clean && (
          <div className="layout-editor-flow-item">
            <div className="layout-editor-node clean">
              <span className="layout-editor-node-title" title="Stack matching copies before arranging the selection">Clean</span>
              <button type="button" className="layout-editor-remove" aria-label="Remove Clean step" onClick={removeClean}>×</button>
            </div>
          </div>
        )}
        {layout.steps.map((step, index) => {
          const name = CATALOGUE_FIELD_LABELS[step.field];
          const directionIndex = LAYOUT_DIRECTIONS.findIndex((option) => option.direction === step.direction && option.axis === getLayoutStepAxis(step));
          const direction = LAYOUT_DIRECTIONS[directionIndex] ?? LAYOUT_DIRECTIONS[0];
          const next = LAYOUT_DIRECTIONS[(directionIndex + 1) % LAYOUT_DIRECTIONS.length] ?? LAYOUT_DIRECTIONS[0];
          const nextMode = step.mode === 'group' ? 'sort' : 'group';
          const toggleMode = () => updateStep(step.field, { mode: nextMode });
          return (
            <div className="layout-editor-flow-item" key={step.field}>
              {connector(index)}
              <div
                className={`layout-editor-node ${step.mode} ${draggingField === step.field ? 'is-dragging' : ''}`}
                data-layout-node-index={index} {...pointerHandlers(step.field)}
              >
                <button
                  type="button" className="layout-editor-node-title" {...pointerHandlers(step.field)}
                  onClick={(event) => { if (event.detail === 0) toggleMode(); }}
                  onDoubleClick={() => { if (!justDragged(step.field)) toggleMode(); }}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const earlier = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
                    insert(step.field, index + (earlier ? -1 : 2));
                  }}
                  title="Drag or use arrow keys to reorder. Double-click to switch Group / Sort."
                >{name}</button>
                <button
                  type="button" className="layout-editor-remove"
                  aria-label={`Remove ${name} step`}
                  onClick={() => change({ ...layout, steps: layout.steps.filter((entry) => entry.field !== step.field) }, `${name} removed`)}
                >×</button>
                <div className="layout-editor-node-options">
                  <button type="button" onClick={toggleMode} aria-label={`Change ${name} from ${step.mode} to ${nextMode}`}>{step.mode === 'group' ? 'Group' : 'Sort'}</button>
                  <button
                    type="button" className="layout-editor-direction"
                    onClick={() => updateStep(step.field, { direction: next.direction, axis: next.axis })}
                    aria-label={`${name} direction, ${direction.label}. Switch to ${next.label.toLowerCase()}`}
                    title={direction.label}
                  >{direction.arrow}</button>
                </div>
              </div>
            </div>
          );
        })}
        {connector(layout.steps.length)}
      </div>

      <div className="layout-editor-footer">
        <div className="layout-editor-width-controls" title={canChangeWidth ? 'Maximum columns per group' : 'Add a Group or Clean step to change spacing'}>
          <label className="layout-editor-width">
            Group width
            <input
              type="range" min={LAYOUT_COLUMNS_MIN} max={LAYOUT_COLUMNS_MAX} value={layout.columns}
              aria-label="Maximum columns per group"
              aria-valuetext={automaticWidth ? 'Automatic' : `${layout.columns} ${layout.columns === 1 ? 'column' : 'columns'} maximum`}
              disabled={!canChangeWidth}
              onChange={(event) => onChange({ ...layout, columns: Number(event.target.value), columnMode: 'limit' })}
            />
            <output>{automaticWidth ? 'Auto' : `Max ${layout.columns}`}</output>
          </label>
          {!automaticWidth && (
            <button type="button" className="tool-button layout-editor-auto" aria-label="Use automatic group width"
              disabled={!canChangeWidth} onClick={() => onChange({ ...layout, columnMode: 'auto' })}>Auto</button>
          )}
        </div>
        {onReset && <button type="button" className="tool-button" onClick={onReset}>Reset layout</button>}
      </div>
      <span className="layout-editor-announcement" role="status">{announcement}</span>
    </section>
  );
}
