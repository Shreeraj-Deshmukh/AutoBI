import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateAccessData, ACCESS_NARRATIVE } from '@/lib/sampleData';
import { runDemoPipeline } from '@/lib/powerbi/demoPipeline';
import { hasPeriodFilter } from '@/lib/periodFilter';

// the model's reply: a page of its own, plus the filters it would like (Payer among them)
const chat = vi.fn();
vi.mock('./llm', () => ({ chatJSON: (...a: unknown[]) => chat(...a) }));
const { aiDesignEdit, aiGenerateDesign } = await import('./aiAgents');

describe('FRM demo storyline with an AI model connected', () => {
  const d = generateAccessData();
  const r = runDemoPipeline('Sanofi FRM', ACCESS_NARRATIVE, [
    { name: 'sp_patient_journey', rows: d.journey },
    { name: 'payer_plan_pbm', rows: d.plans },
    { name: 'hcps', rows: d.hcps },
    { name: 'frm_territories', rows: d.territories },
    { name: 'frm_cases', rows: d.cases },
    { name: 'product_master', rows: d.products },
  ]);
  const m = r.f.measures.filter((x) => x.kind === 'count').slice(0, 2).map((x) => x.name);
  beforeEach(() => {
    chat.mockReset();
    chat.mockResolvedValue({ pages: [{ name: 'Patient Access', sections: [{ name: 'Headline', components: m.map((n) => ({ type: 'kpi', title: n, measures: [n] })) }] }], filters: ['Payer', 'Case_Type', 'Specialty'] });
  });

  it('the AI design keeps the FRM filter panel: no Payer and no Time Period to start with', async () => {
    const design = await aiGenerateDesign(r.u, r.f, r.spec, r.build.spec);
    expect(design.pages.map((p) => p.name)).toContain('Patient Access');
    expect(design.filters.map((x) => x.label)).toEqual(r.build.spec.filters.map((x) => x.label));
    expect(design.filters.map((x) => x.label)).not.toContain('Payer');
    expect(hasPeriodFilter(design)).toBe(false);
  });

  it('the demo prompts are applied directly (same result with or without a model)', async () => {
    const a = await aiDesignEdit(r.build.spec, 'Add a payer filter', { u: r.u, f: r.f });
    const b = await aiDesignEdit(a.spec, 'Add a time period filter', { u: r.u, f: r.f });
    expect(chat).not.toHaveBeenCalled();
    expect(b.changed).toBe(true);
    expect(b.spec.filters.map((x) => x.label)).toEqual(['Reporting Period', 'Region', 'FRM Territory', 'Sales Territory', 'Market', 'Product', 'Account', 'PBM Name', 'Payer']);
  });
});
