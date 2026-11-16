import { describe, it, expect } from 'vitest';
import { generateAccessData, ACCESS_NARRATIVE } from '@/lib/sampleData';
import { extractRequirements, applyClarification } from './requirementAgent';
import { runDataIntelligence } from './dataAgent';
import { runFoundation } from './foundationAgent';
import { applyDesignCommand, generateDesign } from './designAgent';
import { buildDashboard } from './developmentAgent';
import { Engine } from '@/lib/engine';
import { buildPowerBiProject } from '@/lib/powerbi/index';
import { subjectWords, supportedRequirements } from '@/lib/obtainable';
import type { DatasetMeta, Row } from '@/types';

/**
 * FRM demo: requirements the data cannot support are reported as missing, never built from a near-match, and
 * listed as warnings in Design Studio / Development and in the Power BI README.
 */
const KPIS = ['Net Promoter Score (patient satisfaction)', 'Average copay amount per patient', 'FRM field visits per HCP', 'Net revenue by product', 'Average patient age', 'Cost per resolved case', 'Prescription (TRx) volume by HCP', 'Call center average handle time'];
const FILTERS = ['Patient age group', 'Patient gender', 'Sales rep', 'Hospital bed size'];
const DIMENSIONS = ['Cases by patient ethnicity', 'Cases by insurance member ID'];
const AVAILABLE = ['State', 'Specialty', 'Account type', 'Formulary status', 'Copay program', 'Specialty pharmacy', 'Where patient is stuck'];

describe('unobtainable FRM requirements', () => {
  const d = generateAccessData();
  const tables: Record<string, Row[]> = { sp_patient_journey: d.journey, payer_plan_pbm: d.plans, hcps: d.hcps, frm_territories: d.territories, frm_cases: d.cases, product_master: d.products };
  const metas: DatasetMeta[] = Object.entries(tables).map(([id, rows]) => ({ id, name: id, fileName: `${id}.csv`, format: 'csv', rowCount: rows.length, columnCount: Object.keys(rows[0]).length, columns: Object.keys(rows[0]), uploadedAt: '', status: 'uploaded', isSample: false }));
  const rowsOf = (id: string) => tables[id] ?? [];
  let spec = extractRequirements(ACCESS_NARRATIVE, { audience: 'Leadership' });
  for (const a of spec.ambiguities) spec = applyClarification(spec, a, a.options[0]);
  const item = (text: string) => ({ id: text, text, source: 'user' as const });
  spec = { ...spec, kpis: [...spec.kpis, ...KPIS.map(item)], filters: [...spec.filters, ...[...FILTERS, ...AVAILABLE].map(item)], dimensions: [...spec.dimensions, ...DIMENSIONS.map(item)] };
  const u = runDataIntelligence(metas, rowsOf, spec);
  const req = supportedRequirements(spec, u.mappings);
  const f = runFoundation(u, req);
  const design = generateDesign(u, f, req);
  const engine = new Engine({ profiles: u.profiles, relationships: u.relationships, measures: f.measures, rowsOf });
  const build = buildDashboard(design, 1, u, f, engine);
  const pbi = buildPowerBiProject({ name: 'FRM', profiles: u.profiles, relationships: u.relationships, foundation: f, spec: build.spec, rowsOf, anchor: engine.anchor, minDate: engine.minDate });
  const unob = [...KPIS, ...FILTERS, ...DIMENSIONS];

  it('each one is mapped as missing, with the reason', () => {
    for (const t of unob) expect(u.mappings.filter((m) => m.requirement === t).map((m) => m.status), t).toEqual(expect.arrayContaining(['missing']));
    for (const t of unob) expect(u.mappings.filter((m) => m.requirement === t).every((m) => m.status === 'missing'), t).toBe(true);
  });

  it('fields the data has are not flagged', () => {
    for (const t of AVAILABLE) expect(u.mappings.find((m) => m.requirement === t)?.status, t).not.toBe('missing');
    // "where the patient is stuck" is the journey's current stage
    expect(u.mappings.find((m) => m.requirement === 'Where patient is stuck')?.fields.join()).toMatch(/stage/i);
    // the brief's own requirements all stay
    for (const k of extractRequirements(ACCESS_NARRATIVE, { audience: 'Leadership' }).kpis) expect(u.mappings.find((m) => m.requirement === k.text)?.status, k.text).not.toBe('missing');
  });

  it('no KPI, visual or filter is built from them', () => {
    expect(f.measures.filter((m) => m.requirementRef && unob.includes(m.requirementRef)).map((m) => m.name)).toEqual([]);
    const titles = build.spec.pages.flatMap((p) => p.components.map((c) => c.title));
    for (const t of unob) {
      const ws = subjectWords(t);
      expect(titles.filter((x) => ws.every((w) => subjectWords(x).includes(w))), t).toEqual([]);
    }
    expect(build.spec.filters.map((x) => x.label.toLowerCase())).not.toEqual(expect.arrayContaining(['patient gender', 'sales rep']));
  });

  it('they are listed as warnings in development and in the Power BI README', () => {
    for (const t of unob) expect(build.warnings.some((w) => w.startsWith(`Not in the dashboard — "${t}"`)), t).toBe(true);
    for (const t of unob) expect(pbi.files['README.txt'], t).toContain(t);
  });

  it('the design assistant says the data does not have it instead of adding a near-match', () => {
    const ctx = { u, f };
    for (const cmd of ['Add a patient gender filter', 'Add a sales rep filter', 'Add KPI Average patient age', 'Add KPI average copay amount', 'Add KPI FRM field visits', 'Add bar chart Total Cases Received by patient gender']) {
      const res = applyDesignCommand(design, cmd, ctx);
      expect(res.changed, cmd).toBe(false);
      expect(res.reply, cmd).toMatch(/can't/);
    }
    // what the data has still works
    expect(applyDesignCommand(design, 'Add a state filter', ctx).changed).toBe(true);
    expect(applyDesignCommand(design, 'Add KPI Total Cases Received', ctx).changed).toBe(true);
  });

  it('the FRM brief no longer turns "sales territory" into a sales KPI', () => {
    expect(spec.kpis.map((k) => k.text.toLowerCase())).not.toContain('total sales');
  });
});
