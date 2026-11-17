import { createDefaultCatalogueLayout, type CatalogueLayoutConfig } from '@/data/catalogueLayout';
import { LayoutEditor } from './LayoutEditor';

export function CatalogueLayoutPanel({ layout, onChange, visibleCount, totalCount }: {
  layout: CatalogueLayoutConfig;
  onChange: (layout: CatalogueLayoutConfig) => void;
  visibleCount: number;
  totalCount: number;
}) {
  return (
    <section className="catalogue-layout-panel" aria-label="Catalogue layout">
      <div className="catalogue-layout-heading">
        <div><strong>Arrange the catalogue</strong><span>{visibleCount} / {totalCount} cards</span></div>
        <button type="button" className="tool-button" onClick={() => onChange(createDefaultCatalogueLayout())}>Reset layout</button>
      </div>
      <LayoutEditor layout={layout} onChange={onChange} />
    </section>
  );
}
