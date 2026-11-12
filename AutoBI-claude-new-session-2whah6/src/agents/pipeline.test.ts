import { describe, it, expect } from 'vitest';
import { generateSampleData, generateRetailData, generatePharmaData, generateAccessData, ACCESS_NARRATIVE, PHARMA_NARRATIVE, RETAIL_NARRATIVE, SAMPLE_FILES, SAMPLE_NARRATIVE } from '@/lib/sampleData';
import type { DatasetMeta, Row } from '@/types';
import { applyClarification, extractRequirements } from './requirementAgent';
import { runDataIntelligence } from './dataAgent';
import { reconcileMappings, runFoundation } from './foundationAgent';
import { generateDesign, applyDesignCommand, designStats } from './designAgent';
import { buildDashboard } from './developmentAgent';
import { generateTests } from './testingAgent';
import { runCheck } from './validators';
import { Engine } from '@/lib/engine';
import { buildMeasureFromText } from './kpiBuilder';
import { proposeRelease } from '@/lib/access';
import { seeded } from '@/lib/util';

function run(narrative: string, data: Record<string, Row[]>) {
  const metas: DatasetMeta[] = Object.entries(data).map(([k, rows]) => ({ id: k, name: k, fileName: `${k}.csv`, format: 'csv', rowCount: rows.length, columnCount: Object.keys(rows[0]).length, columns: Object.keys(rows[0]), uploadedAt: '', status: 'uploaded', isSample: false }));
  const rowsOf = (id: string) => data[id];
  let spec = extractRequirements(narrative, { audience: 'Leadership' });
  for (const a of spec.ambiguities) spec = applyClarification(spec, a, a.options[0]);
  const u = runDataIntelligence(metas, rowsOf, spec);
  const f = runFoundation(u, spec);
  const design = generateDesign(u, f, spec);
  const engine = new Engine({ profiles: u.profiles, relationships: u.relationships, measures: f.measures, rowsOf });
  const build = buildDashboard(design, 1, u, f, engine);
  const tests = generateTests(build, u, f, spec);
  const results = tests.filter((t) => t.check).map((t) => ({ t, r: runCheck(t.check!, { spec: design, u, measures: f.measures, rowsOf, engine }) }));
  return { spec, u, f, design, build, tests, results, engine };
}

describe('HCP sample scenario', () => {
  const d = generateSampleData();
  const data = Object.fromEntries(SAMPLE_FILES.map((s) => [s.key, d[s.key]]));
  const r = run(SAMPLE_NARRATIVE, data);

  it('extracts the expected requirements', () => {
    const kpis = r.spec.kpis.map((k) => k.text);
    expect(kpis).toEqual(expect.arrayContaining(['Total calls', 'Total emails sent', 'Emails delivered', 'Emails opened', 'Email open rate', 'Calls by segment', 'Calls by account tier']));
    expect(r.spec.filters.map((x) => x.text)).toEqual(expect.arrayContaining(['Region', 'Territory', 'Call Type', 'Reporting Period']));
    expect(r.spec.pages.map((x) => x.text)).toEqual(['Executive Overview', 'Call Analytics', 'Email Engagement', 'Account-Level Performance']);
  });
  it('understands what each dataset represents', () => {
    expect(r.u.profiles.map((p) => p.label).sort()).toEqual(['Account Master', 'Call Activity', 'Campaign Master', 'Email Activity']);
    expect(r.u.relationships).toHaveLength(3);
    expect(r.u.mappings.find((m) => m.requirement === 'Calls by account tier')?.status).toBe('join_required');
    expect(r.u.mappings.find((m) => m.requirement === 'Email open rate')?.status).toBe('calculation_required');
  });
  it('builds a dashboard where every component validates', () => {
    expect(designStats(r.design).pages).toBe(4);
    expect(r.build.validations.every((v) => v.ok)).toBe(true);
  });
  it('tests pass except the two seeded data-quality defects', () => {
    const failed = r.results.filter((x) => x.r.status === 'Failed');
    expect(failed.map((x) => x.t.category).sort()).toEqual(['Data Integrity', 'HCP Matching']);
    expect(r.results.filter((x) => x.r.status === 'Passed').length).toBeGreaterThan(80);
  });
  it('applies natural-language design changes', () => {
    const a = applyDesignCommand(r.design, 'Remove the territory filter', { u: r.u, f: r.f });
    expect(a.changed).toBe(true);
    expect(a.spec.filters.some((x) => x.label === 'Territory')).toBe(false);
    const b = applyDesignCommand(r.design, 'Replace the pie chart with a bar chart', { u: r.u, f: r.f });
    expect(b.spec.pages.flatMap((p) => p.components).some((c) => c.type === 'donut')).toBe(false);
  });
});

describe('a different domain (retail sales) works without HCP assumptions', () => {
  const rnd = seeded(7);
  const stores: Row[] = Array.from({ length: 30 }, (_, i) => ({ Store_ID: `S${100 + i}`, Store_Name: `Store ${i + 1}`, Region: rnd.pick(['North', 'South', 'East', 'West']), Format: rnd.pick(['Mall', 'High Street', 'Outlet']) }));
  const sales: Row[] = Array.from({ length: 1500 }, (_, i) => ({ Sale_ID: `T${i + 1}`, Store_ID: rnd.pick(stores).Store_ID, Sale_Date: `2026-${String(rnd.int(1, 9)).padStart(2, '0')}-${String(rnd.int(1, 28)).padStart(2, '0')}`, Product_Category: rnd.pick(['Apparel', 'Footwear', 'Accessories', 'Beauty']), Channel: rnd.pick(['In-store', 'Online']), Amount: rnd.int(5, 400), Payment_Status: rnd.weighted([['Completed', 90], ['Refunded', 10]] as const) }));
  const r = run('Track sales revenue by region and by product category over time, monthly. Filter by channel and region.', { stores, sales });

  it('infers datasets, relationship and measures', () => {
    expect(r.u.profiles.find((p) => p.datasetId === 'sales')?.label).toBe('Sale Activity');
    expect(r.u.relationships[0]).toMatchObject({ fromDataset: 'sales', toDataset: 'stores', unmatched: 0 });
    expect(r.f.measures.map((m) => m.name)).toEqual(expect.arrayContaining(['Total Sales', 'Total Amount', 'Completed Sales']));
  });
  it('generates a working dashboard and all automated tests pass', () => {
    expect(r.build.validations.every((v) => v.ok)).toBe(true);
    expect(r.design.filters.map((f) => f.label)).toEqual(expect.arrayContaining(['Channel', 'Region']));
    const notPassed = r.results.filter((x) => x.r.status !== 'Passed');
    expect(notPassed.map((x) => `${x.t.id} ${x.r.actual}`)).toEqual([]);
  });
});

describe('retail demo kit (downloadable synthetic data)', () => {
  const d = generateRetailData();
  const r = run(RETAIL_NARRATIVE, { stores: d.stores, products: d.products, sales: d.sales });
  it('understands the three datasets and builds a valid dashboard', () => {
    expect(r.u.profiles.map((p) => p.label).sort()).toEqual(['Product Master', 'Store Master', 'Transaction Activity']);
    expect(r.u.relationships).toHaveLength(2);
    expect(r.f.measures.map((m) => m.name)).toEqual(expect.arrayContaining(['Total Net Amount', 'Completed Transactions']));
    expect(r.build.validations.every((v) => v.ok)).toBe(true);
  });
  it('only the seeded unknown-product issue fails', () => {
    const failed = r.results.filter((x) => x.r.status === 'Failed');
    expect(failed.length).toBe(1);
    expect(failed[0].r.actual).toMatch(/Product_ID/);
  });
});

describe('AI-style KPI wording maps to the right dataset', () => {
  it('"Net sales" and "Sales by region" map to the transaction data', () => {
    const d = generateRetailData();
    const r = run('Track net sales and transactions by region and by category, filter by channel.', { stores: d.stores, products: d.products, sales: d.sales });
    const m = (name: string) => r.u.mappings.find((x) => x.requirement.toLowerCase() === name.toLowerCase());
    expect(m('Net sales')?.status ?? m('Total sales')?.status).not.toBe('missing');
    expect(r.u.mappings.filter((x) => x.kind === 'kpi' && x.status === 'missing')).toEqual([]);
  });
});

describe('field mapping drives labels and visibility', () => {
  const d = generateSampleData();
  const data = Object.fromEntries(SAMPLE_FILES.map((s) => [s.key, d[s.key]]));
  const base = run(SAMPLE_NARRATIVE, data);
  const tierMap = base.f.fieldMaps.find((m) => m.sourceDataset === 'accounts' && m.sourceField === 'Account_Tier')!;
  it('renamed reporting fields become the labels used in design and tests', () => {
    const f = JSON.parse(JSON.stringify(base.f)) as typeof base.f;
    f.fieldMaps.find((m) => m.id === tierMap.id)!.reportingField = 'Customer Tier';
    const spec = generateDesign(base.u, f, base.spec);
    const titles = spec.pages.flatMap((p) => p.components.map((c) => c.title));
    expect(titles).toContain('Calls by Customer Tier');
    expect(titles.some((t) => /Account Tier/.test(t))).toBe(false);
  });
  it('excluded fields are not used by the design and are flagged in the build', () => {
    const f = JSON.parse(JSON.stringify(base.f)) as typeof base.f;
    f.fieldMaps.find((m) => m.sourceDataset === 'accounts' && m.sourceField === 'Territory')!.included = false;
    const spec = generateDesign(base.u, f, base.spec);
    const used = spec.pages.flatMap((p) => p.components.flatMap((c) => [c.dimension, c.series, ...(c.tableColumns ?? [])])).concat(spec.filters.map((x) => x.field));
    expect(used).not.toContain('accounts::Territory');
    const build = buildDashboard(base.design, 1, base.u, f, base.engine);
    expect(build.validations.some((v) => !v.ok && /excluded in Field Mapping/.test(v.message))).toBe(true);
  });
});

describe('pharma brand performance dataset', () => {
  const d = generatePharmaData();
  const r = run(PHARMA_NARRATIVE, { hcp_universe: d.hcps, territory_alignment: d.territories, rx_weekly: d.rx, field_calls: d.calls });
  it('reads like a commercial analytics model', () => {
    expect(r.u.profiles.map((p) => p.label).sort()).toEqual(['Call Activity', 'HCP Master', 'Rx Activity', 'Territory Master']);
    expect(r.u.relationships).toHaveLength(3);
    expect(r.f.measures.map((m) => m.name)).toEqual(expect.arrayContaining(['Total TRx', 'Total NRx', 'Call Completed Rate']));
    const titles = r.design.pages.flatMap((p) => p.components.map((c) => c.title));
    expect(titles).toEqual(expect.arrayContaining(['Total TRx', 'TRx by Region', 'Top 10 HCPs by TRx']));
    expect(r.build.validations.every((v) => v.ok)).toBe(true);
  });
  it('fails only on the seeded data issues', () => {
    const failed = r.results.filter((x) => x.r.status === 'Failed').map((x) => x.r.actual);
    expect(failed).toHaveLength(3); // unknown HCPs + duplicate calls (caught by both the duplicate and the unique-count checks)
    expect(failed.join(' ')).toMatch(/HCP_ID not present/);
    expect(failed.join(' ')).toMatch(/counted twice/);
    expect(failed.join(' ')).toMatch(/duplicate/);
  });
});

describe('Sanofi FRM patient funnel storyline', () => {
  const d = generateAccessData();
  const data = { sp_patient_journey: d.journey, payer_plan_pbm: d.plans, hcps: d.hcps, frm_territories: d.territories };
  const r = run(ACCESS_NARRATIVE, data);
  const rowsOf = (id: string) => (data as Record<string, Row[]>)[id];
  const ctx = (spec = r.design, measures = r.f.measures, engine = r.engine, release?: ReturnType<typeof proposeRelease>) => ({ spec, u: r.u, measures, rowsOf, engine, release: release ?? undefined });

  it('step 1 – requirement becomes a specification with stories and KPIs', () => {
    expect(r.spec.stories.length).toBeGreaterThan(3);
    expect(r.spec.kpis.map((k) => k.text)).toEqual(expect.arrayContaining(['Patients awaiting PA', 'PA approval rate', 'Average time to therapy initiation', 'Patient drop-off rate']));
    expect(r.spec.filters.map((k) => k.text)).toEqual(expect.arrayContaining(['Territory', 'HCP', 'Payer']));
  });
  it('step 3 – data model and measures follow the business definitions', () => {
    expect(r.u.relationships.map((x) => `${x.fromDataset}>${x.toDataset}`).sort()).toEqual(['hcps>frm_territories', 'sp_patient_journey>hcps', 'sp_patient_journey>payer_plan_pbm']);
    const m = (n: string) => r.f.measures.find((x) => x.name === n)!;
    expect(m('Patients Awaiting PA').condition).toMatchObject({ field: 'Current_Stage', values: ['PA Pending'] });
    expect(m('PA Approval Rate').kind).toBe('ratio');
    const v = r.engine.value(m('PA Approval Rate').id, { period: 'all', selections: {} }, null)!;
    expect(v).toBeGreaterThan(40);
    expect(v).toBeLessThan(85);
    expect(m('Average Time To Therapy Initiation').kind).toBe('avg');
  });
  it('step 2 – design has the funnel, barriers and FRM action sections', () => {
    const page = r.design.pages[0];
    expect([...new Set(page.components.map((c) => c.section))]).toEqual(['Patient Funnel', 'Access Barriers', 'FRM Actionability']);
    expect(page.components.some((c) => c.type === 'funnel' && c.measureIds.length >= 3)).toBe(true);
    expect(r.build.validations.every((v) => v.ok)).toBe(true);
  });
  it('step 4 – live change: HCPs with more than five patients delayed in PA', () => {
    const built = buildMeasureFromText('Patients with PA pending for more than 14 days', r.u, r.f.measures)!;
    expect([built.main.condition, ...(built.main.conditions ?? [])]).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'Current_Stage', values: ['PA Pending'] }), expect.objectContaining({ field: 'Days_in_Current_Stage', op: 'gt', values: ['14'] })]));
    const f2 = { ...r.f, measures: [...r.f.measures, built.main] };
    const edit = applyDesignCommand(r.design, 'Show HCPs with more than 5 patients with PA pending for more than 14 days', { u: r.u, f: f2 });
    expect(edit.changed).toBe(true);
    const c = edit.spec.pages[0].components.at(-1)!;
    expect(c.threshold).toEqual({ op: 'gt', value: 5 });
    expect(c.section).toBe('FRM Actionability');
    const e2 = new Engine({ profiles: r.u.profiles, relationships: r.u.relationships, measures: f2.measures, rowsOf });
    const hcps = e2.group(built.main.id, c.dimension!, { period: 'all', selections: {} }, { threshold: c.threshold });
    expect(hcps.length).toBeGreaterThan(0);
    expect(hcps.every((h) => h.value > 5)).toBe(true);
  });
  it('step 5 – planned failure: total patients double-counts re-referrals, fixed with COUNT DISTINCT', () => {
    const t = r.tests.find((x) => x.check?.kind === 'unique_count')!;
    expect(runCheck(t.check!, ctx()).status).toBe('Failed');
    const measures = r.f.measures.map((m) => (m.id === (t.check as { measureId: string }).measureId ? { ...m, kind: 'countDistinct' as const } : m));
    const e2 = new Engine({ profiles: r.u.profiles, relationships: r.u.relationships, measures, rowsOf });
    expect(runCheck(t.check!, ctx(r.design, measures, e2)).status).toBe('Passed');
  });
  it('step 5/6 – FRM row-level security', () => {
    const rel = proposeRelease(r.u, rowsOf)!;
    expect(rel.users.filter((x) => x.values.length)).toHaveLength(12);
    // the feature is switched off in the app, but its validator must keep working
    expect(runCheck({ kind: 'rls' }, ctx(r.design, r.f.measures, r.engine, rel)).status).toBe('Passed');
  });
});

describe('Sanofi FRM case view (ProcDNA FRM report + KPI catalogue)', () => {
  const d = generateAccessData();
  const data: Record<string, Row[]> = { sp_patient_journey: d.journey, payer_plan_pbm: d.plans, hcps: d.hcps, frm_territories: d.territories, frm_cases: d.cases };
  const r = run(ACCESS_NARRATIVE, data);
  const rowsOf = (id: string) => data[id];
  const page = (name: string) => r.design.pages.find((p) => p.name === name)!;
  const cat = (name: string) => r.f.measures.find((m) => m.catalogueRef === name)!;
  const all = { period: 'all' as const, selections: {} };

  it('requirements carry the catalogue KPIs and the FRM pages', () => {
    expect(r.spec.kpis.map((k) => k.text)).toEqual(expect.arrayContaining(['Total Cases Received', 'Open Case Backlog', 'Case closure rate', 'Median Case Resolution Time (days)', 'FRM Response Time (days)']));
    expect(r.spec.pages.slice(0, 2).map((p) => p.text)).toEqual(['Field Reimbursement Management', 'FRM Performance']);
    expect(r.u.mappings.filter((m) => m.kind === 'kpi' && m.status === 'missing')).toEqual([]);
  });
  it('the case log joins to patients, HCPs (→ territories) and plans', () => {
    expect(r.u.profiles.find((p) => p.datasetId === 'frm_cases')).toMatchObject({ label: 'Case Activity', kind: 'activity', primaryKey: 'Case_ID', dateField: 'Case_Open_Date' });
    expect(r.u.relationships.filter((x) => x.fromDataset === 'frm_cases').map((x) => x.toDataset).sort()).toEqual(['hcps', 'payer_plan_pbm', 'sp_patient_journey']);
  });
  it('catalogue KPIs follow the catalogue computation and the data', () => {
    const v = (n: string) => r.engine.value(cat(n).id, all, null)!;
    const closed = d.cases.filter((c) => c.Case_Status === 'Closed');
    expect(v('Total Cases Received')).toBe(d.cases.length);
    expect(v('Open Case Backlog')).toBe(d.cases.filter((c) => c.Case_Status === 'Open').length);
    expect(v('Case Closure Rate (%)')).toBeCloseTo((closed.length / d.cases.length) * 100, 6);
    const res = closed.map((c) => c.Days_to_Resolution as number).sort((a, b) => a - b);
    expect(v('Median Case Resolution Time (days)')).toBe(res.length % 2 ? res[res.length >> 1] : (res[res.length / 2 - 1] + res[res.length / 2]) / 2);
    expect(cat('Median Case Resolution Time (days)').kind).toBe('median');
    const cov = r.f.catalogue!;
    expect(cov).toHaveLength(62);
    expect(cov.filter((c) => c.status === 'computed').length).toBeGreaterThanOrEqual(14);
    expect(cov.find((c) => c.metric === 'FRM Program NPS')!.status).toBe('needs_data');
    expect(cov.find((c) => c.metric === 'FRM Cycle Time (days)')!.status).toBe('same_as');
  });
  it('design leads with the FRM workbench and the FRM performance pages', () => {
    expect(r.design.pages.slice(0, 2).map((p) => p.name)).toEqual(['Field Reimbursement Management', 'FRM Performance']);
    expect(r.design.defaultPeriod).toBe('ytd');
    const p1 = page('Field Reimbursement Management');
    expect([...new Set(p1.components.map((c) => c.section))]).toEqual(['Case Summary', 'Priority & Aging', 'Case List']);
    expect(p1.components.map((c) => c.type)).toEqual(['kpiGroup', 'kpiGroup', 'kpiGroup', 'kpiGroup', 'table', 'hbar', 'records']);
    const list = p1.components.find((c) => c.type === 'records')!;
    expect(list.tableColumns!.map((x) => x.split('::')[1])).toEqual(expect.arrayContaining(['Case_ID', 'Patient_ID', 'HCP_Name', 'Payer', 'Current_Stage', 'Days_Open', 'Case_Details']));
    const p2 = page('FRM Performance');
    expect(p2.components.filter((c) => c.type === 'extremes')).toHaveLength(6);
    expect(p2.components.find((c) => c.type === 'drilldown')!.levels!.map((x) => x.split('::')[1])).toEqual(['Region', 'Territory_Name', 'Case_Type', 'Case_Status']);
    expect(r.design.filters.map((x) => x.field?.split('::')[1])).toEqual(expect.arrayContaining(['Region', 'Territory_Name', 'FRM_Name', 'HCP_Name', 'Payer', 'PBM', 'Case_Type']));
    expect(r.build.validations.every((v) => v.ok)).toBe(true);
  });
  it('the case list holds every open case, with where the patient is stuck', () => {
    const list = page('Field Reimbursement Management').components.find((c) => c.type === 'records')!;
    const rows = r.engine.records(list.measureIds[0], all);
    expect(rows).toHaveLength(d.cases.filter((c) => c.Case_Status === 'Open').length);
    expect(rows.every((w) => w.v['frm_cases::Case_Status'] === 'Open' && w.v['sp_patient_journey::Current_Stage'] != null)).toBe(true);
    const esc = r.engine.records(list.measureIds[0], all, list.toggle!.filter);
    expect(esc.length).toBeGreaterThan(0);
    expect(esc.every((w) => w.v['frm_cases::Escalation_Flag'] === 'Escalated')).toBe(true);
  });
  it('aging buckets are ordered and the territory scorecard is consistent', () => {
    const aging = r.engine.group(cat('Open Case Backlog').id, 'frm_cases::Aging_Bucket', all).map((g) => g.key);
    expect(aging).toEqual(['0-7 days', '8-14 days', '15-21 days', '22-30 days', '30+ days']);
    const byTerr = r.engine.group(cat('Total Cases Received').id, 'frm_territories::Territory_Name', all);
    expect(byTerr).toHaveLength(12);
    expect(byTerr.reduce((s, g) => s + g.value, 0)).toBe(d.cases.length);
  });
  it('automated tests pass except the seeded data issues', () => {
    const notPassed = r.results.filter((x) => x.r.status !== 'Passed').map((x) => x.r.actual);
    expect(notPassed).toHaveLength(3);
    expect(notPassed.filter((a) => /Plan_ID not present/.test(a))).toHaveLength(2); // journey + cases of those patients
    expect(notPassed.join(' ')).toMatch(/counted twice/);
    for (const kind of ['records', 'extremes', 'catalogue'] as const) expect(r.results.filter((x) => x.t.check?.kind === kind).every((x) => x.r.status === 'Passed')).toBe(true);
    expect(r.results.filter((x) => x.t.category === 'Catalogue Alignment').length).toBeGreaterThan(5);
  });
  it('editing a catalogue KPI away from its definition fails catalogue alignment', () => {
    const t = r.tests.find((x) => x.check?.kind === 'catalogue' && (x.check as { measureId: string }).measureId === cat('Open Case Backlog').id)!;
    const measures = r.f.measures.map((m) => (m.catalogueRef === 'Open Case Backlog' ? { ...m, condition: { field: 'Case_Status', op: 'eq' as const, values: ['Closed'] } } : m));
    const e2 = new Engine({ profiles: r.u.profiles, relationships: r.u.relationships, measures, rowsOf });
    expect(runCheck(t.check!, { spec: r.design, u: r.u, measures, rowsOf, engine: e2 }).status).toBe('Failed');
  });
  it('the corrected payer file resolves both Plan_ID failures', () => {
    const plans = [...d.plans, { Plan_ID: 'PL-9999', Plan_Name: 'Highmark BCBS PPO', Payer: 'BCBS (regional plans)', Channel: 'Commercial', PBM: 'Prime Therapeutics', Formulary_Status: 'Covered with PA' }];
    const r2 = run(ACCESS_NARRATIVE, { ...data, payer_plan_pbm: plans });
    expect(r2.results.filter((x) => x.r.status !== 'Passed').map((x) => x.r.actual).join(' ')).not.toMatch(/Plan_ID not present/);
  });
});

describe('KPI phrasing edge cases seen with a live model', () => {
  const d = generateAccessData();
  const r = run(ACCESS_NARRATIVE, { sp_patient_journey: d.journey, payer_plan_pbm: d.plans, hcps: d.hcps, frm_territories: d.territories });
  it('"dropped off before therapy initiation" means discontinued, not initiated', () => {
    const b = buildMeasureFromText('Patients dropped off before therapy initiation', r.u, r.f.measures)!;
    expect(b.main.condition).toMatchObject({ field: 'Current_Stage', values: ['Discontinued'] });
  });
});

describe('requirement mapping follows the KPIs actually defined', () => {
  it('a KPI the foundation calculates is no longer reported as missing or as a data gap', () => {
    const d = generateAccessData();
    const r = run(ACCESS_NARRATIVE, { sp_patient_journey: d.journey, payer_plan_pbm: d.plans, hcps: d.hcps, frm_territories: d.territories });
    const u = structuredClone(r.u);
    const f = structuredClone(r.f);
    // the rule-based mapping could not ground this KPI, but a model (or the user) defined it later
    u.mappings.push({ id: 'map-x', requirement: 'Reimbursement issue rate', kind: 'kpi', sources: [], fields: [], status: 'missing', note: 'No uploaded dataset represents "Reimbursement issue rate".' });
    f.gaps.push('Reimbursement issue rate — No uploaded dataset represents "Reimbursement issue rate".');
    const base = f.measures.find((m) => m.datasetId === 'sp_patient_journey' && m.kind === 'count' && !m.condition)!;
    const num = { ...base, id: 'm-issue', name: 'Patients With Reimbursement Issue', condition: { field: 'Current_Stage', op: 'eq' as const, values: ['PA Pending'] }, requirementRef: undefined };
    f.measures.push(num, { ...base, id: 'm-rate', name: 'Reimbursement Issue Rate', kind: 'ratio', numeratorId: 'm-issue', denominatorId: base.id, format: 'percent', requirementRef: 'Reimbursement issue rate' });
    reconcileMappings(u, f);
    const mp = u.mappings.find((m) => m.id === 'map-x')!;
    expect(mp.status).toBe('calculation_required');
    expect(mp.fields).toContain('Current_Stage');
    expect(mp.note).toMatch(/Defined in the Reporting Foundation/);
    expect(f.gaps.some((g) => g.startsWith('Reimbursement issue rate'))).toBe(false);
  });
});
