import { describe, it, expect } from 'vitest';
import { generateAccessData, ACCESS_NARRATIVE } from '@/lib/sampleData';
import { runDemoPipeline } from '@/lib/powerbi/demoPipeline';
import { applyDesignCommand } from './designAgent';
import { resolvePeriod } from '@/lib/dates';

/** Things a presenter can run into during the FRM demo. */
describe('FRM demo edge cases', () => {
  const d = generateAccessData();
  const r = runDemoPipeline('Sanofi FRM', ACCESS_NARRATIVE, [
    { name: 'sp_patient_journey', rows: d.journey },
    { name: 'payer_plan_pbm', rows: d.plans },
    { name: 'hcps', rows: d.hcps },
    { name: 'frm_territories', rows: d.territories },
    { name: 'frm_cases', rows: d.cases },
    { name: 'product_master', rows: d.products },
  ]);
  const ctx = { u: r.u, f: r.f };
  const titles = (spec: typeof r.design, page: number) => spec.pages[page].components.map((c) => c.title);

  it('moving a scorecard by its exact title moves that card only', () => {
    const res = applyDesignCommand(r.design, 'Move # Cases by Region to Field Reimbursement Management', ctx);
    expect(res.changed).toBe(true);
    expect(titles(res.spec, 0)).toContain('# Cases by Region');
    expect(titles(res.spec, 1)).toEqual(expect.arrayContaining(['Open Cases by Region', 'Escalated Cases by Region']));
  });

  it('"Make Open Case Aging full width" leaves no half-empty row', () => {
    const res = applyDesignCommand(r.design, 'Make Open Case Aging full width', ctx);
    const p1 = res.spec.pages[0].components;
    expect(p1.find((c) => c.title === 'Open Case Aging')!.width).toBe(12);
    expect(p1.find((c) => c.title === 'Priority Prescribers')!.width).toBe(12);
    expect(res.reply).toMatch(/Priority Prescribers.*full width too/);
  });

  it('an average over no cases is blank, not 0', () => {
    const avg = r.f.measures.find((m) => m.kind === 'avg')!;
    const future = { period: 'custom' as const, custom: { start: '2030-01-01', end: '2030-12-31' }, selections: {} };
    expect(r.engine.value(avg.id, future, r.engine.resolve(future).current)).toBeNull();
  });

  it('a custom range typed the wrong way round is read as that range', () => {
    const p = resolvePeriod('custom', Date.UTC(2026, 9, 30), Date.UTC(2025, 0, 1), { start: '2026-10-01', end: '2026-02-01' })!;
    expect(p.start).toBeLessThan(p.end);
  });

  it('the comparison reply names the period in words', () => {
    const res = applyDesignCommand(r.design, 'Add a monthly comparison', ctx);
    expect(res.reply).not.toMatch(/last6m/);
    expect(res.reply).toMatch(/Add a time period filter/);
  });
});
