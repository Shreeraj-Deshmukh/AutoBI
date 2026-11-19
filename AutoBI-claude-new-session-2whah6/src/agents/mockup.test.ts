import { describe, it, expect } from 'vitest';
import { generateRetailData } from '@/lib/sampleData';
import { runDemoPipeline } from '@/lib/powerbi/demoPipeline';
import { SUPPORTED_TYPES } from '@/lib/powerbi/support';
import { mapVisual, mockupToRequirement, type MockupInventory } from './mockupAgent';

/** What a model could report for a two-page retail dashboard: supported visuals, visuals we build differently, one we can't build, and a KPI the data can't support. */
export const RETAIL_MOCKUP: MockupInventory = {
  dashboardTitle: 'Retail Performance',
  pages: [
    {
      name: 'Overview',
      purpose: 'How are sales trending and where do they come from?',
      filters: [{ label: 'Region', kind: 'dropdown' }, { label: 'Channel', kind: 'buttons' }, { label: 'Date', kind: 'date range', values: 'last 12 months' }],
      visuals: [
        { row: 1, type: 'card', title: 'Net Sales', measures: [{ name: 'Net Sales', format: 'currency' }], comparison: 'vs previous month' },
        { row: 1, type: 'card', title: 'Transactions', measures: [{ name: 'Transactions', format: 'count' }] },
        { row: 1, type: 'gauge', title: 'Sales vs Target', measures: [{ name: 'Net Sales', format: 'currency' }], comparison: 'vs target' },
        { row: 1, type: 'card', title: 'Customer Satisfaction Score', measures: [{ name: 'Customer Satisfaction Score', format: 'number' }] },
        { row: 2, type: 'line and clustered column chart', title: 'Net Sales and Transactions by Month', measures: [{ name: 'Net Sales' }, { name: 'Transactions' }], category: 'Month', timeGrain: 'month' },
        { row: 2, type: 'filled map', title: 'Net Sales by City', measures: [{ name: 'Net Sales' }], category: 'City' },
        { row: 3, type: 'clustered bar chart', title: 'Top Stores', measures: [{ name: 'Net Sales' }], category: 'Store', topN: 10 },
        { row: 3, type: 'donut chart', title: 'Sales by Channel', measures: [{ name: 'Net Sales' }], category: 'Channel' },
        { row: 4, type: 'Q&A', title: 'Ask a question' },
        { row: 4, type: 'text box', notes: 'Net Sales excludes refunds.' },
      ],
    },
    {
      name: 'Products',
      visuals: [
        { row: 1, type: 'matrix', title: 'Sales by Category and Brand', measures: [{ name: 'Net Sales' }, { name: 'Quantity' }], category: 'Category', columns: ['Category', 'Brand', 'Net Sales', 'Quantity'] },
        { row: 2, type: 'treemap', title: 'Sales by Product', measures: [{ name: 'Net Sales' }], category: 'Product' },
        { row: 2, type: 'stacked column chart', title: 'Sales by Category and Channel', measures: [{ name: 'Net Sales' }], category: 'Category', series: 'Channel' },
      ],
    },
  ],
  definitions: [{ text: 'Refund rate = refunded transactions ÷ all transactions', basis: 'implied' }],
  questions: ['Which date does the period filter use?'],
};

describe('screenshot visual types → what AutoBI builds (fixed table)', () => {
  it.each([
    ['card', 'kpi'],
    ['multi-row card', 'kpi'],
    ['KPI', 'kpi'],
    ['gauge', 'kpi'],
    ['clustered column chart', 'bar'],
    ['clustered bar chart', 'hbar'],
    ['stacked column chart', 'stacked'],
    ['100% stacked bar chart', 'stacked'],
    ['line chart', 'line'],
    ['area chart', 'area'],
    ['stacked area chart', 'area'],
    ['line and clustered column chart', 'combo'],
    ['donut chart', 'donut'],
    ['pie chart', 'donut'],
    ['table', 'table'],
    ['matrix', 'table'],
    ['funnel', 'funnel'],
    ['scatter chart', 'scatter'],
    ['map', 'hbar'],
    ['filled map', 'hbar'],
    ['shape map', 'hbar'],
    ['bubble map', 'hbar'],
    ['treemap', 'hbar'],
    ['waterfall chart', 'bar'],
    ['ribbon chart', 'bar'],
    ['decomposition tree', 'bar'],
    ['slicer', 'filter'],
    ['text box', 'note'],
    ['Q&A', null],
    ['smart narrative', null],
    ['custom visual', null],
    ['image', null],
    ['button', null],
    ['sankey diagram', null],
    ['unreadable', null],
    [undefined, null],
  ])('%s → %s', (type, kind) => {
    expect(mapVisual(type).kind).toBe(kind);
  });
  it('every visual built differently or not built says why', () => {
    for (const t of ['gauge', 'map', 'treemap', 'waterfall chart', 'pie chart', 'matrix', 'line and clustered column chart', 'Q&A', 'sankey diagram']) expect(mapVisual(t).change).toBeTruthy();
    for (const t of ['card', 'line chart', 'clustered column chart', 'table']) expect(mapVisual(t).change).toBeUndefined();
  });
});

describe('inventory → requirement text', () => {
  const d = mockupToRequirement(RETAIL_MOCKUP);
  it('describes each page, its visuals and the filters', () => {
    expect(d.pages).toBe(2);
    expect(d.text).toContain('Rebuild the "Retail Performance" dashboard shown in the screenshots (2 pages).');
    expect(d.text).toContain('Page "Overview": How are sales trending and where do they come from?');
    expect(d.text).toContain('- KPI cards: Net Sales (currency), Transactions and Customer Satisfaction Score, compared with the previous period.');
    expect(d.text).toContain('"Top Stores": horizontal bar chart of the top 10 Store by Net Sales.');
    expect(d.text).toContain('"Sales by Category and Channel": stacked bar chart of Net Sales by Category, split by Channel.');
    expect(d.text).toContain('Let people filter by Region, Channel and Date.');
    expect(d.text).toContain('- Note on the page: "Net Sales excludes refunds."');
    expect(d.text).toContain('- Page filters: Region, Channel and Date.');
    expect(d.text).toContain('- Refund rate = refunded transactions ÷ all transactions (implied, not written on the screen; please confirm)');
    expect(d.text).toContain('- Which date does the period filter use?');
  });
  it('lists every visual shown differently, and the one not built', () => {
    expect(d.changed).toEqual([
      '"Sales vs Target" (Overview) is a gauge; it will be a KPI card.',
      '"Net Sales and Transactions by Month" (Overview) combines lines and columns; it will be a line chart and a bar chart.',
      '"Net Sales by City" (Overview) is a map; it will be a horizontal bar chart of the top 10.',
      '"Sales by Category and Brand" (Products) is a matrix; it will be a table.',
      '"Sales by Product" (Products) is a treemap; it will be a horizontal bar chart of the top 10.',
    ]);
    expect(d.notBuilt).toEqual(['"Ask a question" (Overview) is a Q&A visual; AutoBI has no equivalent.']);
    expect(d.text).toContain('Shown differently from the screenshots:');
    expect(d.text).toContain('Not built:');
  });
  it('a combo chart becomes a bar chart and a line chart', () => {
    expect(d.text).toContain('"Net Sales and Transactions by Month": bar chart of Net Sales over time, by month.');
    expect(d.text).toContain('"Net Sales and Transactions by Month (trend)": line chart of Transactions over time, by month.');
  });
  it('a malformed model reply gives text, not an error', () => {
    const odd = [{}, { pages: 'x' }, { pages: [null, 5, { visuals: [null, 7, { type: {} }, { type: 'card' }] }] }, { pages: [{ name: { a: 1 }, visuals: [{ type: 'card', measures: 'Net Sales' }] }] }] as unknown as MockupInventory[];
    for (const inv of odd) expect(() => mockupToRequirement(inv)).not.toThrow();
    expect(mockupToRequirement({}).visuals).toBe(0);
  });
});

describe('a screenshot requirement goes through the whole project and the Power BI export (AI off)', () => {
  const data = generateRetailData();
  const draft = mockupToRequirement(RETAIL_MOCKUP);
  const r = runDemoPipeline('Retail Performance', draft.text, [
    { name: 'stores', rows: data.stores },
    { name: 'products', rows: data.products },
    { name: 'sales', rows: data.sales },
  ]);
  const comps = r.build.spec.pages.flatMap((p) => p.components);

  it('requirements carry the screenshot KPIs and filters', () => {
    const kpis = r.spec.kpis.map((k) => k.text.toLowerCase()).join(' | ');
    // (the rule engine names it "Total sales"; with AI on, the model keeps the screenshot's wording)
    expect(kpis).toMatch(/sales/);
    expect(r.spec.filters.map((f) => f.text.toLowerCase()).join(' | ')).toMatch(/region/);
    // the wording of the text itself is not read as fields
    expect([...r.spec.filters, ...r.spec.dimensions].map((f) => f.text)).not.toEqual(expect.arrayContaining([expect.stringMatching(/this page|labels|screen/i)]));
  });
  it('a KPI the data cannot support is flagged in the Data step, not built empty', () => {
    const m = r.u.mappings.find((x) => /satisfaction/i.test(x.requirement));
    if (m) expect(m.status).toBe('missing');
    expect(comps.some((c) => /satisfaction/i.test(c.title))).toBe(false);
  });
  it('every built visual is one the export supports and has a measure', () => {
    expect(comps.length).toBeGreaterThan(3);
    for (const c of comps) {
      expect(SUPPORTED_TYPES).toContain(c.type);
      expect(c.measureIds.length).toBeGreaterThan(0);
    }
  });
  it('the Power BI export is built', () => {
    expect(r.pbi.summary.visuals).toBeGreaterThan(3);
    expect(Object.keys(r.pbi.files).length).toBeGreaterThan(5);
  });
});
