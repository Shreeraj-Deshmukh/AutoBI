import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateRetailData } from '@/lib/sampleData';
import { runDemoPipeline } from '@/lib/powerbi/demoPipeline';
import { buildPowerBiProject } from '@/lib/powerbi';
import { SUPPORTED_TYPES } from '@/lib/powerbi/support';

// the AI model, mocked: what it returns is set per test
const chat = vi.fn();
vi.mock('./llm', () => ({ chatJSON: (...a: unknown[]) => chat(...a) }));
const { readMockups, describeMockups, MOCKUP_PROMPT } = await import('./mockupAgent');
const { aiGenerateDesign } = await import('./aiAgents');

const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

describe('reading screenshots with the AI model', () => {
  beforeEach(() => {
    chat.mockReset();
  });

  it('sends the screenshots with the prompt, in page order', async () => {
    chat.mockResolvedValue({ pages: [] });
    await readMockups([IMG, IMG.replace('Rg', 'Rh')]);
    const [system, user, opts] = chat.mock.calls[0];
    expect(system).toBe(MOCKUP_PROMPT);
    expect(user).toMatch(/2 screenshots.*pages 1 to 2 in order/);
    expect(opts.images).toEqual([IMG, IMG.replace('Rg', 'Rh')]);
  });
  it('no screenshots: nothing is sent', async () => {
    await expect(readMockups([])).rejects.toThrow(/at least one/);
    expect(chat).not.toHaveBeenCalled();
  });
  it('a reply with no readable visuals is an error, so the requirement box is left alone', async () => {
    chat.mockResolvedValue({ pages: [{ name: 'Home', visuals: [{ type: 'image' }] }] });
    await expect(describeMockups([IMG])).rejects.toThrow(/No dashboard visuals/);
  });
  it('a model error is passed on', async () => {
    chat.mockImplementation(async () => {
      throw new Error('Azure AI Foundry returned 400: image input is not supported');
    });
    await expect(describeMockups([IMG])).rejects.toThrow(/image input/);
  });
});

describe('an AI design that copies screenshot visuals AutoBI cannot build', () => {
  const d = generateRetailData();
  const r = runDemoPipeline('Retail', 'Track net sales and transactions by region, channel and category, monthly. Filter by region and channel.', [
    { name: 'stores', rows: d.stores },
    { name: 'products', rows: d.products },
    { name: 'sales', rows: d.sales },
  ]);
  const m = r.f.measures.map((x) => x.name);
  const sum = m.find((n) => /net amount/i.test(n)) ?? m[0];

  it('keeps only what the export supports, and the export is built', async () => {
    chat.mockReset();
    chat.mockResolvedValue({
      pages: [
        {
          name: 'Overview',
          sections: [
            { name: 'Headline', components: m.slice(0, 3).map((n) => ({ type: 'kpi', title: n, measures: [n] })) },
            {
              name: 'Drivers',
              components: [
                { type: 'map', title: 'Sales by City', measures: [sum], dimension: 'City' },
                { type: 'gauge', title: 'Sales vs Target', measures: [sum] },
                { type: 'treemap', title: 'Sales by Product', measures: [sum], dimension: 'Product_Name' },
                { type: 'bar', title: 'Sales by Region', measures: [sum], dimension: 'Region' },
                { type: 'line', title: 'Sales Trend', measures: [sum] },
                { type: 'kpi', title: 'Customer Satisfaction', measures: ['Customer Satisfaction Score'] },
              ],
            },
          ],
        },
      ],
      filters: ['Region', 'Channel'],
    });
    const design = await aiGenerateDesign(r.u, r.f, r.spec, r.build.spec);
    const comps = design.pages.flatMap((p) => p.components);
    expect(comps.map((c) => c.title)).toEqual(expect.arrayContaining(['Sales by Region', 'Sales Trend']));
    expect(comps.map((c) => c.title)).not.toEqual(expect.arrayContaining(['Sales by City', 'Sales vs Target', 'Sales by Product', 'Customer Satisfaction']));
    for (const c of comps) {
      expect(SUPPORTED_TYPES).toContain(c.type);
      expect(c.measureIds.length).toBeGreaterThan(0);
    }
    const pbi = buildPowerBiProject({ name: 'Retail', profiles: r.u.profiles, relationships: r.u.relationships, foundation: r.f, spec: design, rowsOf: r.rowsOf, anchor: r.engine.anchor, minDate: r.engine.minDate });
    expect(pbi.summary.visuals).toBeGreaterThanOrEqual(comps.length);
  });
});
