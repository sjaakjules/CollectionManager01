import { useRef, useState, type PointerEvent } from 'react';
import {
  CATALOGUE_FIELD_LABELS, CATALOGUE_LAYOUT_FIELDS, createDefaultCatalogueLayout,
  insertCatalogueLayoutStep, type CatalogueLayoutConfig, type CatalogueLayoutField,
  type CatalogueLayoutStep,
} from '@/data/catalogueLayout';

export function CatalogueLayoutPanel({ layout, onChange, visibleCount, totalCount }: {
  layout: CatalogueLayoutConfig;
  onChange: (layout: CatalogueLayoutConfig) => void;
  visibleCount: number;
  totalCount: number;
}) {
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [draggingField, setDraggingField] = useState<CatalogueLayoutField | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const drag = useRef<{ field: CatalogueLayoutField; x: number; y: number; pointerId: number; active: boolean } | null>(null);
  const suppressClick = useRef<CatalogueLayoutField | null>(null);
  const lastDragTime = useRef(-Infinity);
  const change = (next: CatalogueLayoutConfig, message: string) => {
    onChange(next);
    setAnnouncement(message);
  };
  const update = (field: CatalogueLayoutField, changes: Partial<CatalogueLayoutStep>) => {
    change({ ...layout, steps: layout.steps.map((step) => step.field === field ? { ...step, ...changes } : step) }, `${CATALOGUE_FIELD_LABELS[field]} layout updated`);
  };
  const insert = (field: CatalogueLayoutField, index: number) => {
    change(insertCatalogueLayoutStep(layout, field, index), `${CATALOGUE_FIELD_LABELS[field]} placed in layout`);
    setDropIndex(null);
  };
  const hitConnector = (x: number, y: number): number | null => {
    for (const element of panelRef.current?.querySelectorAll<HTMLElement>('[data-layout-insert-index]') ?? []) {
      const rect = element.getBoundingClientRect();
      if (x >= rect.left - 8 && x <= rect.right + 8 && y >= rect.top - 12 && y <= rect.bottom + 12) {
        return Number(element.dataset.layoutInsertIndex);
      }
    }
    return null;
  };
  const pointerHandlers = (field: CatalogueLayoutField) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (event.currentTarget.classList.contains('catalogue-layout-node') && event.target instanceof Element && event.target.closest('button')) return;
      event.stopPropagation();
      suppressClick.current = null;
      drag.current = { field, x: event.clientX, y: event.clientY, pointerId: event.pointerId, active: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.stopPropagation();
      if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
      event.preventDefault();
      current.active = true;
      setDraggingField(current.field);
      setDropIndex(hitConnector(event.clientX, event.clientY));
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.stopPropagation();
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      setDraggingField(null);
      setDropIndex(null);
      if (!current.active) return;
      event.preventDefault();
      suppressClick.current = current.field;
      lastDragTime.current = performance.now();
      const index = hitConnector(event.clientX, event.clientY);
      if (index !== null) insert(current.field, index);
    },
    onPointerCancel: () => { drag.current = null; setDraggingField(null); setDropIndex(null); },
    onLostPointerCapture: () => { drag.current = null; setDraggingField(null); setDropIndex(null); },
  });
  const connector = (index: number) => (
    <div
      key={`insert-${index}`}
      className={`catalogue-layout-connector ${dropIndex === index ? 'drop-active' : ''}`}
      aria-label={`Insert layout step at position ${index + 1}`}
      data-layout-insert-index={index}
    >{dropIndex === index ? '+' : '→'}</div>
  );
  return (
    <section ref={panelRef} className="catalogue-layout-panel" aria-label="Catalogue layout">
      <div className="catalogue-layout-heading">
        <div><strong>Arrange the catalogue</strong><span>{visibleCount} / {totalCount} cards</span></div>
        <button type="button" className="tool-button" onClick={() => change(createDefaultCatalogueLayout(), 'Default layout restored')}>Reset layout</button>
      </div>
      <p className="bottom-tools-note">Read left to right: groups make nested areas; sorts order cards inside them. Earlier sorts take priority. Your decks keep their own layout.</p>
      <div className="catalogue-layout-flow" aria-label="Layout operation order">
        <span className="catalogue-layout-endpoint">Filtered cards</span>
        {layout.steps.map((step, index) => (
          <div className="catalogue-layout-flow-item" key={step.field}>
            {connector(index)}
            <div className={`catalogue-layout-node ${step.mode} ${draggingField === step.field ? 'is-dragging' : ''}`} {...pointerHandlers(step.field)}>
              <button
                type="button" className="catalogue-layout-node-title" {...pointerHandlers(step.field)}
                onClick={() => { suppressClick.current = null; }}
                onDoubleClick={() => { if (performance.now() - lastDragTime.current > 400) update(step.field, { mode: step.mode === 'group' ? 'sort' : 'group' }); }}
                title="Drag to reorder. Double-click to switch Group / Sort."
              >{CATALOGUE_FIELD_LABELS[step.field]}</button>
              <div className="catalogue-layout-node-options">
                <button type="button" onClick={() => update(step.field, { mode: step.mode === 'group' ? 'sort' : 'group' })} aria-label={`Change ${CATALOGUE_FIELD_LABELS[step.field]} from ${step.mode} to ${step.mode === 'group' ? 'sort' : 'group'}`}>{step.mode === 'group' ? 'Group' : 'Sort'}</button>
                <button type="button" onClick={() => update(step.field, { direction: step.direction === 'asc' ? 'desc' : 'asc' })} aria-label={`${CATALOGUE_FIELD_LABELS[step.field]} ${step.direction === 'asc' ? 'ascending; switch to descending' : 'descending; switch to ascending'}`} title={step.direction === 'asc' ? 'Ascending' : 'Descending'}>{step.direction === 'asc' ? '↑' : '↓'}</button>
              </div>
              <div className="catalogue-layout-node-tools">
                <button type="button" disabled={index === 0} onClick={() => insert(step.field, index - 1)} aria-label={`Move ${CATALOGUE_FIELD_LABELS[step.field]} earlier`}>←</button>
                <button type="button" disabled={index === layout.steps.length - 1} onClick={() => insert(step.field, index + 2)} aria-label={`Move ${CATALOGUE_FIELD_LABELS[step.field]} later`}>→</button>
                <button type="button" onClick={() => change({ ...layout, steps: layout.steps.filter((entry) => entry.field !== step.field) }, `${CATALOGUE_FIELD_LABELS[step.field]} removed`)} aria-label={`Remove ${CATALOGUE_FIELD_LABELS[step.field]} step`}>×</button>
              </div>
            </div>
          </div>
        ))}
        {connector(layout.steps.length)}
        <span className="catalogue-layout-endpoint">Canvas</span>
      </div>
      <div className="catalogue-layout-footer">
        <div className="catalogue-layout-palette" aria-label="Available layout steps">
          <span>Add a step</span>
          {CATALOGUE_LAYOUT_FIELDS.filter((field) => !layout.steps.some((step) => step.field === field)).map((field) => (
            <button key={field} className="tool-button catalogue-layout-palette-step" type="button" {...pointerHandlers(field)} onClick={() => {
              if (suppressClick.current === field) { suppressClick.current = null; return; }
              insert(field, layout.steps.length);
            }} title="Click to append, or drag between steps">+ {CATALOGUE_FIELD_LABELS[field]}</button>
          ))}
          {layout.steps.length === CATALOGUE_LAYOUT_FIELDS.length && <span>All steps are in use</span>}
        </div>
        <label className="catalogue-layout-width">Group width <input type="range" min="4" max="16" value={layout.columns} onChange={(event) => onChange({ ...layout, columns: Number(event.target.value) })} /> <output>{layout.columns} cards</output></label>
      </div>
      <p className="bottom-tools-note">Drag a step between arrows. Double-click its name to switch Group / Sort, or use its buttons. Sites always keep their landscape orientation.</p>
      <span className="catalogue-layout-announcement" role="status" aria-live="polite">{announcement}</span>
    </section>
  );
}
