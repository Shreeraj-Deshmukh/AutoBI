import { describe, it, expect } from 'vitest';
import type { Row } from '@/types';
import { runDemoPipeline } from '@/lib/powerbi/demoPipeline';
import { emptyFilters } from '@/lib/engine';
import { parseDate, toIsoDate } from '@/lib/dates';

/** Monthly launch-tracking workbook: every sheet is dated by a "YYYY-MM" Month column (no day). */
function launchData() {
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  const regions = ['North', 'South', 'East', 'West'];
  const patients: Row[] = months.flatMap((m, i) => regions.map((r, j) => ({ Month: m, Region: r, Market_Patients: 350 + j * 20, Zexcoy_New_Patients: 8 + i * 2 + j, Zexcoy_Discontinued: i, Zexcoy_Active_Patients: 10 + i * 15 + j, NRx: 9 + i * 2 + j, TRx: 12 + i * 16 + j, Zexcoy_Share: (10 + i * 15 + j) / (350 + j * 20) })));
  const payers = ['Commercial', 'Medicare Part D', 'Medicaid', 'VA / Gov', 'Cash / Other'];
  const access: Row[] = months.flatMap((m, i) => payers.map((p, j) => ({ Month: m, Payer: p, Active_Patients: 5 + i * 8 + j, Claims_Submitted: 20 + i + j, Claims_Approved: 12 + i + j, Claims_Rejected: 8, Approval_Rate: (12 + i + j) / (20 + i + j), PA_Required: j < 3 ? 'Y' : 'N', Avg_Days_to_Approval: 9 - i * 0.5, Avg_Patient_Copay_USD: 30 + j * 20 })));
  const hcps: Row[] = Array.from({ length: 30 }, (_, i) => ({ HCP_ID: `HCP${1001 + i}`, HCP_Name: `Dr ${i + 1}`, Specialty: ['Neurology', 'Psychiatry', 'Primary Care'][i % 3], Region: regions[i % 4], Decile: 5 + (i % 6), Target_Tier: `Tier ${(i % 3) + 1}`, First_Rx_Month: months[i % 5], Zexcoy_Patients: 1 + (i % 12), Rep_Calls: 6 + (i % 15), Samples_Dropped: 10 + i, Patients_per_Call: 0.3 }));
  const brands = ['Zexcoy', 'Dravelin', 'Morvexa', 'Generic (Valtroxine)'];
  const share: Row[] = months.flatMap((m, i) => brands.map((b, j) => ({ Month: m, Brand: b, Patients: 100 + i * 40 + j * 90, Market_Total: 1420 + i * 28, Share: 0.25 })));
  return [
    { name: 'launch – Patients_Region', rows: patients },
    { name: 'launch – Payer_Access', rows: access },
    { name: 'launch – HCP_Prescribers', rows: hcps },
    { name: 'launch – Market_Share', rows: share },
  ];
}

describe('period values without a day', () => {
  it('are dated on the first day of the month or quarter', () => {
    const iso = (v: string) => { const d = parseDate(v); return d ? toIsoDate(d.t) : null; };
    expect(iso('2026-05')).toBe('2026-05-01');
    expect(iso('2026/5')).toBe('2026-05-01');
    expect(iso('May 2026')).toBe('2026-05-01');
    expect(iso('Sep-26')).toBe('2026-09-01');
    expect(iso('05/2026')).toBe('2026-05-01');
    expect(iso('2026-Q2')).toBe('2026-04-01');
    expect(iso('Q4 2026')).toBe('2026-10-01');
    expect(iso('2026-13')).toBeNull();
    expect(iso('HCP1001')).toBeNull();
  });
});

describe('monthly launch tracker (Month = "YYYY-MM")', () => {
  const r = runDemoPipeline('Zexcoy Launch', 'Track NRx and TRx over time, monthly, by region. Filter by region and payer.', launchData());
  const prof = (re: RegExp) => r.u.profiles.find((p) => re.test(p.datasetId))!;

  it('reads Month as the date of each monthly table', () => {
    for (const re of [/patients_region/, /payer_access/, /market_share/]) {
      expect(prof(re).dateField).toBe('Month');
      expect(prof(re).kind).toBe('activity');
      expect(prof(re).columns.find((c) => c.name === 'Month')!.role).toBe('date');
    }
  });

  it('does not date the prescriber list by the month of the first prescription', () => {
    expect(prof(/hcp_prescribers/).dateField).toBeUndefined();
    expect(prof(/hcp_prescribers/).kind).not.toBe('activity');
  });

  it('plots NRx and TRx for every month', () => {
    for (const field of ['NRx', 'TRx']) {
      const m = r.f.measures.find((x) => x.kind === 'sum' && x.field === field)!;
      const all = r.engine.series(m.id, 'month', emptyFilters('all'));
      expect(all.map((b) => b.bucket)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
      expect(all.every((b) => b.value > 0)).toBe(true);
      // and the default reporting period is not empty either
      expect(r.engine.series(m.id, 'month', emptyFilters(r.build.spec.defaultPeriod)).length).toBeGreaterThan(0);
    }
  });

  it('builds trend visuals that have data', () => {
    const trends = r.build.spec.pages.flatMap((p) => p.components).filter((c) => c.type === 'line' || c.type === 'area');
    expect(trends.length).toBeGreaterThan(0);
    const failed = r.build.validations.filter((v) => !v.ok && trends.some((t) => t.id === v.componentId));
    expect(failed).toEqual([]);
  });
});
