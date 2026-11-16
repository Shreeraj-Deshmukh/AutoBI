import { describe, it, expect } from 'vitest';
import { generateAccessData, generateRetailData, generateSampleData, ACCESS_NARRATIVE, RETAIL_NARRATIVE, SAMPLE_FILES, SAMPLE_NARRATIVE } from '@/lib/sampleData';
import type { DashComponent, DashboardSpec, Row } from '@/types';
import { runDemoPipeline } from './demoPipeline';
import { conformSpec, powerBiVisual, SUPPORTED_TYPES } from './support';
import type { PowerBiExport } from './index';

/** Power BI visual types of each exported page, in page order, without the page furniture (banner, titles, slicers). */
function exportedPerPage(x: PowerBiExport): string[][] {
  const pagesFile = Object.keys(x.files).find((p) => p.endsWith('pages/pages.json'))!;
  const order: string[] = JSON.parse(x.files[pagesFile]).pageOrder;
  const furniture = ['textbox', 'slicer', 'image', 'pageNavigator', 'shape'];
  return order.map((name) =>
    Object.entries(x.files)
      .filter(([p]) => p.includes(`/pages/${name}/visuals/`) && p.endsWith('visual.json'))
      .map(([, c]) => JSON.parse(c).visual.visualType as string)
      .filter((t) => !furniture.includes(t))
      .sort(),
  );
}
const expectedPerPage = (spec: DashboardSpec) => spec.pages.map((p) => p.components.map((c) => powerBiVisual(c)?.visualType ?? `none:${c.type}`).sort());

describe('Power BI limits: the export builds exactly the visual the support list names', () => {
  const kits = {
    'Sanofi FRM': () => {
      const d = generateAccessData();
      return runDemoPipeline('Sanofi FRM', ACCESS_NARRATIVE, [
        { name: 'sp_patient_journey', rows: d.journey },
        { name: 'payer_plan_pbm', rows: d.plans },
        { name: 'hcps', rows: d.hcps },
        { name: 'frm_territories', rows: d.territories },
        { name: 'frm_cases', rows: d.cases },
        { name: 'product_master', rows: d.products },
      ]);
    },
    'HCP Engagement': () => {
      const d = generateSampleData();
      return runDemoPipeline('HCP Engagement', SAMPLE_NARRATIVE, SAMPLE_FILES.map((s) => ({ name: s.key, rows: d[s.key] as Row[] })));
    },
    Retail: () => {
      const d = generateRetailData();
      return runDemoPipeline('Retail', RETAIL_NARRATIVE, [{ name: 'stores', rows: d.stores }, { name: 'products', rows: d.products }, { name: 'sales', rows: d.sales }]);
    },
  };
  for (const [name, run] of Object.entries(kits)) {
    it(name, () => {
      const r = run();
      // the design is within the limits as generated: nothing left to adjust
      expect(conformSpec(r.design, { foundation: r.f }).notes).toEqual([]);
      expect(r.build.spec.pages.flatMap((p) => p.components).every((c) => SUPPORTED_TYPES.includes(c.type))).toBe(true);
      expect(exportedPerPage(r.pbi)).toEqual(expectedPerPage(r.build.spec));
    });
  }
});

describe('Power BI limits: closest match for a component outside them', () => {
  const base = (c: Partial<DashComponent>): DashComponent => ({ id: 'c1', type: 'bar', title: 'Visual', description: '', measureIds: ['m1'], width: 6, ...c });
  const foundation = { fieldMaps: [], measures: [{ id: 'm1', name: 'Avg Days', kind: 'avg' }, { id: 'm2', name: 'Cases', kind: 'count' }] } as unknown as Parameters<typeof conformSpec>[1]['foundation'];
  const conform = (c: DashComponent) => {
    const r = conformSpec({ pages: [{ id: 'p', name: 'P', description: '', components: [c] }], filters: [], defaultPeriod: 'all', timeGrain: 'month' }, { foundation });
    return { c: r.spec.pages[0].components[0], notes: r.notes };
  };

  it('a stacked average becomes side-by-side bars, keeping the split', () => {
    const { c, notes } = conform(base({ type: 'stacked', dimension: 'd::Region', series: 'd::Product' }));
    expect([c.type, c.series]).toEqual(['bar', 'd::Product']);
    expect(notes[0]).toMatch(/side by side/);
  });
  it('a stacked count stays stacked', () => {
    expect(conform(base({ type: 'stacked', measureIds: ['m2'], dimension: 'd::Region', series: 'd::Product' })).notes).toEqual([]);
  });
  it('a drill-down becomes a two-level bar chart', () => {
    const { c } = conform(base({ type: 'drilldown', dimension: 'd::Region', levels: ['d::Region', 'd::Territory', 'd::HCP'] }));
    expect([c.type, c.dimension, c.subDimension, c.levels]).toEqual(['bar', 'd::Region', 'd::Territory', undefined]);
  });
  it('a donut keeps one category; a horizontal bar with two levels becomes a column chart', () => {
    expect(conform(base({ type: 'donut', dimension: 'd::Region', series: 'd::Product' })).c).toMatchObject({ type: 'donut', series: undefined });
    expect(conform(base({ type: 'hbar', dimension: 'd::Region', subDimension: 'd::Product' })).c).toMatchObject({ type: 'bar', subDimension: 'd::Product' });
  });
  it('trend lines drop a series and get the dashboard grain', () => {
    expect(conform(base({ type: 'line', series: 'd::Region' })).c).toMatchObject({ type: 'line', series: undefined, timeGrain: 'month' });
  });
  it('a scatter with one measure becomes a bar chart', () => {
    expect(conform(base({ type: 'scatter', dimension: 'd::Region' })).c.type).toBe('bar');
  });
});
