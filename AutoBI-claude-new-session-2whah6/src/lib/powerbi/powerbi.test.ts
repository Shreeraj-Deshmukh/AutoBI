import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import { inflateSync, unzipSync } from 'fflate';
import { generateAccessData, generateRetailData, generateSampleData, ACCESS_NARRATIVE, RETAIL_NARRATIVE, SAMPLE_FILES, SAMPLE_NARRATIVE } from '@/lib/sampleData';
import { Engine, emptyFilters } from '@/lib/engine';
import type { MeasureDef, Row } from '@/types';
import { runDemoPipeline } from './demoPipeline';
import { chooseActive, decodeEmbedded } from './model';
import { buildPowerBiProject, longestPath, zipExport, type PowerBiExport } from './index';
import type { DashboardSpec } from '@/types';
import { FEATURES } from '@/config/features';
import { applyDesignCommand } from '@/agents/designAgent';
import { buildFrmLayout } from '@/agents/frmTemplate';
import { periodFilterDef } from '@/lib/periodFilter';

// ── Microsoft's PBIR / PBIP JSON schemas (vendored, see __tests__/schemas/README.md)
const SCHEMAS = path.resolve(__dirname, '__tests__/schemas');
const ajv = new Ajv({ strict: false, allErrors: true });
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk(SCHEMAS).filter((x) => x.endsWith('.json'))) {
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  delete s.$id;
  ajv.addSchema(s, `https://developer.microsoft.com/json-schemas/${path.relative(SCHEMAS, f).split(path.sep).join('/')}`);
}

function schemaErrors(x: PowerBiExport): string[] {
  const errors: string[] = [];
  for (const [p, content] of Object.entries(x.files)) {
    if (!/\.(json|pbip|pbir|pbism|platform)$/.test(p) || p.includes('StaticResources')) continue;
    const doc = JSON.parse(content);
    const validate = ajv.getSchema(doc.$schema);
    if (!validate) errors.push(`${p}: no schema for ${doc.$schema}`);
    else if (!validate(doc)) errors.push(`${p}: ${ajv.errorsText(validate.errors)}`);
  }
  return errors;
}

/** DAX references that do not resolve to a model table/column or measure. */
function unresolvedDax(x: PowerBiExport): string[] {
  const m = x.model;
  const measures = new Set(m.tables.flatMap((t) => t.measures.map((k) => k.name.toLowerCase())));
  const cols = new Set(m.tables.flatMap((t) => t.columns.map((c) => `${t.name}|${c.name}`.toLowerCase())));
  const bad: string[] = [];
  for (const t of m.tables)
    for (const k of t.measures) {
      const qualified = [...k.expression.matchAll(/'((?:[^']|'')+)'\[((?:[^\]]|\]\])+)\]/g)];
      for (const q of qualified) if (!cols.has(`${q[1].replace(/''/g, "'")}|${q[2].replace(/]]/g, ']')}`.toLowerCase())) bad.push(`${k.name}: ${q[0]}`);
      const bare = k.expression.replace(/'((?:[^']|'')+)'\[((?:[^\]]|\]\])+)\]/g, '').matchAll(/\[((?:[^\]]|\]\])+)\]/g);
      for (const b of bare) if (!b[1].startsWith('@') && !measures.has(b[1].replace(/]]/g, ']').toLowerCase())) bad.push(`${k.name}: ${b[0]}`);
    }
  return bad;
}

// these suites export the full FRM report (every filter); the demo storyline with held-back filters is tested at the end
FEATURES.frmHeldBackFilters = [];

const visualTypes = (x: PowerBiExport) => Object.entries(x.files).filter(([p]) => p.endsWith('visual.json')).map(([, c]) => JSON.parse(c).visual.visualType as string);

describe('Power BI export – Sanofi FRM kit', () => {
  const d = generateAccessData();
  const tables = [
    { name: 'sp_patient_journey', rows: d.journey },
    { name: 'payer_plan_pbm', rows: d.plans },
    { name: 'hcps', rows: d.hcps },
    { name: 'frm_territories', rows: d.territories },
    { name: 'frm_cases', rows: d.cases },
    { name: 'product_master', rows: d.products },
  ];
  const r = runDemoPipeline('Sanofi FRM', ACCESS_NARRATIVE, tables);
  const x = r.pbi;

  it('writes a complete PBIP project', () => {
    const files = Object.keys(x.files);
    expect(files).toEqual(expect.arrayContaining(['Sanofi_FRM.pbip', 'Sanofi_FRM.Report/definition.pbir', 'Sanofi_FRM.Report/definition/report.json', 'Sanofi_FRM.Report/definition/pages/pages.json', 'Sanofi_FRM.SemanticModel/definition.pbism', 'Sanofi_FRM.SemanticModel/definition/model.tmdl', 'Sanofi_FRM.SemanticModel/definition/relationships.tmdl', 'README.txt']));
    // 6 data tables + Dim_Date + Reporting Period + the Geo Level field parameter
    expect(x.summary).toMatchObject({ tables: 9, pages: r.build.spec.pages.length });
    expect(JSON.parse(x.files['Sanofi_FRM.Report/definition.pbir']).datasetReference.byPath.path).toBe('../Sanofi_FRM.SemanticModel');
  });

  it('every report file matches Microsoft\'s published schema', () => {
    expect(schemaErrors(x)).toEqual([]);
  });

  it('stays well inside Windows\' 260-character path limit', () => {
    // Desktop reports files beyond the limit as "not found"; leave ~140 characters for the unzip location
    expect(longestPath(x)).toBeLessThanOrEqual(120);
  });

  it('every component becomes a visual, using built-in Power BI visual types only', () => {
    const components = r.build.spec.pages.flatMap((p) => p.components);
    const types = visualTypes(x);
    expect(x.warnings.filter((w) => /skipped/.test(w))).toEqual([]);
    expect(types.filter((t) => !['textbox', 'slicer', 'image'].includes(t))).toHaveLength(components.length);
    // one client logo per page
    expect(types.filter((t) => t === 'image')).toHaveLength(r.build.spec.pages.length);
    expect(x.files['Sanofi_FRM.Report/StaticResources/RegisteredResources/ClientLogo.svg']).toMatch(/^<\?xml[\s\S]*<svg/);
    const builtIn = ['card', 'multiRowCard', 'pivotTable', 'clusteredColumnChart', 'clusteredBarChart', 'columnChart', 'donutChart', 'lineChart', 'areaChart', 'scatterChart', 'tableEx', 'decompositionTreeVisual', 'slicer', 'textbox', 'image'];
    expect(types.filter((t) => !builtIn.includes(t))).toEqual([]);
  });

  it('measures follow the Celestra definitions and every DAX reference resolves', () => {
    expect(unresolvedDax(x)).toEqual([]);
    const m = (catalogueRef: string) => {
      const def = r.f.measures.find((k) => k.catalogueRef === catalogueRef)!;
      const out = x.model.measureOf.get(def.id)!;
      return x.model.table(out.table)!.measures.find((k) => k.name === out.name)!;
    };
    expect(m('Open Case Backlog').expression).toMatch(/^CALCULATE\(COUNTA\('Fact_Case_Activity'\[Case ID\]\), KEEPFILTERS\('Fact_Case_Activity'\[Case Status\] IN \{("Open", "Escalated"|"Escalated", "Open")\}\), USERELATIONSHIP\('Dim_Date'\[Date\], 'Fact_Case_Activity'\[Case Open Date\]\)\)$/);
    expect(m('Case Closure Rate (%)').expression).toMatch(/^DIVIDE\(\[.+\], \[.+\]\)$/);
    expect(m('Case Closure Rate (%)').formatString).toBe('0.0%');
    expect(m('Median Case Resolution Time (days)').expression).toMatch(/MEDIAN\(/);
  });

  it('embeds every row, decodable exactly as Power Query will decode it', () => {
    const cases = x.model.tables.find((t) => t.datasetId === 'frm_cases')!;
    const rows = decodeEmbedded(cases.source, inflateSync);
    expect(rows).toHaveLength(d.cases.length);
    const idCol = cases.columns.findIndex((c) => c.source === 'Case_ID');
    expect(rows.map((row) => row[idCol])).toEqual(d.cases.map((c) => String(c.Case_ID)));
    // aging buckets get a numeric sort key so charts keep the engine's order
    const aging = cases.columns.find((c) => c.source === 'Aging_Bucket')!;
    expect(aging.sortByColumn).toBe('Aging Bucket Order');
  });

  it('keeps one active path between tables, without changing any number the dashboard shows', () => {
    const active = new Set(x.model.relationships.filter((k) => k.isActive && k.relationshipId).map((k) => k.relationshipId));
    const pruned = new Engine({ profiles: r.u.profiles, relationships: r.u.relationships.filter((k) => active.has(k.id)), measures: r.f.measures, rowsOf: r.rowsOf });
    const f = emptyFilters('all');
    for (const c of r.build.spec.pages.flatMap((p) => p.components)) {
      for (const mid of c.measureIds) {
        expect(pruned.value(mid, f, null)).toEqual(r.engine.value(mid, f, null));
        for (const dim of [c.dimension, ...(c.levels ?? [])].filter((v): v is string => !!v)) expect(pruned.group(mid, dim, f)).toEqual(r.engine.group(mid, dim, f));
      }
    }
  });

  it('defaults the period slicer to the dashboard default and syncs slicers across pages', () => {
    const slicers = Object.entries(x.files).filter(([p, c]) => p.endsWith('visual.json') && JSON.parse(c).visual.visualType === 'slicer').map(([, c]) => JSON.parse(c).visual);
    const period = slicers.find((s) => s.query.queryState.Values.projections[0].field.Column.Property === 'Reporting Period');
    expect(JSON.stringify(period.objects.general)).toContain("'Year to date'");
    expect(slicers.every((s) => s.syncGroup?.groupName)).toBe(true);
  });

  it('maps the ProcDNA FRM charts: two-level axis, series, and the Geo Level field parameter', () => {
    const visuals = Object.entries(x.files).filter(([p]) => p.endsWith('visual.json')).map(([, c]) => JSON.parse(c).visual);
    const titled = (t: string) => visuals.find((v) => JSON.stringify(v.visualContainerObjects?.title ?? '').includes(t) || JSON.stringify(v.visualContainerObjects?.title ?? '').includes(t.replace(/ /g, '')))!;
    // field parameter table with NAMEOF references
    const geo = x.model.tables.find((t) => t.kind === 'parameter')!;
    expect(geo.name).toBe('Geo Level');
    expect(geo.source).toMatch(/NAMEOF\('Dim_Territory'\[Region\]\)/);
    expect(x.files['Sanofi_FRM.SemanticModel/definition/tables/Geo Level.tmdl']).toMatch(/extendedProperty ParameterMetadata[\s\S]*partition 'Geo Level' = calculated/);
    // case volume: Region (from the parameter) › Product, series Case Status, both levels shown
    const vol = titled('Case Volume by Geography');
    expect(vol.visualType).toBe('columnChart');
    expect(vol.query.queryState.Category.projections.map((p: { queryRef: string }) => p.queryRef)).toEqual(['Dim_Territory.Region', 'Dim_Product.Product Name']);
    expect(vol.query.queryState.Category.fieldParameters[0]).toMatchObject({ index: 0, length: 1 });
    expect(vol.query.queryState.Series.projections[0].queryRef).toBe('Fact_Case_Activity.Case Status');
    expect(vol.expansionStates[0].levels).toHaveLength(2);
    // closure rate: month › product, one bar per geography (the parameter)
    const closure = titled('Case Closure Rate');
    expect(closure.visualType).toBe('clusteredColumnChart');
    expect(closure.query.queryState.Category.projections[0].queryRef).toBe('Dim_Date.Month');
    expect(closure.query.queryState.Series.fieldParameters).toHaveLength(1);
    // geo level slicer on the performance page only, defaulting to Region
    const geoSlicers = visuals.filter((v) => v.visualType === 'slicer' && v.query.queryState.Values.projections[0].queryRef === 'Geo Level.Geo Level');
    expect(geoSlicers).toHaveLength(1);
    // the default selection is stored on the parameter's fields column, as the NAMEOF() text of Region
    expect(JSON.stringify(geoSlicers[0].objects.general)).toContain('"Property":"Geo Level Fields"');
    expect(JSON.stringify(geoSlicers[0].objects.general)).toContain("Dim_Territory''[Region]");
  });

  it('shows every case type of "Resolution Rate by Case Type" side by side, and labels the date slicer', () => {
    const visuals = Object.entries(x.files).filter(([p]) => p.endsWith('visual.json')).map(([, c]) => JSON.parse(c).visual);
    const rate = visuals.find((v) => JSON.stringify(v.visualContainerObjects?.title ?? '').includes('Resolution Rate by Case Type'))!;
    expect(rate.visualType).toBe('pivotTable');
    expect(rate.query.queryState.Columns.projections[0].queryRef).toBe('Fact_Case_Activity.Case Type');
    const dates = visuals.find((v) => v.visualType === 'slicer' && v.query.queryState.Values.projections[0].queryRef === 'Dim_Date.Date')!;
    expect(JSON.stringify(dates.objects.header)).toContain("'Custom Date'");
  });

  it('zips to a single download', () => {
    const files = unzipSync(zipExport(x));
    expect(Object.keys(files)).toContain('Sanofi_FRM.pbip');
    expect(Object.keys(files)).toHaveLength(Object.keys(x.files).length);
  });
});

describe('FRM demo storyline: Payer and Time Period held back, added with the design assistant', () => {
  FEATURES.frmHeldBackFilters = ['period', 'payer'];
  const d = generateAccessData();
  const r = runDemoPipeline('Sanofi FRM', ACCESS_NARRATIVE, [
    { name: 'sp_patient_journey', rows: d.journey },
    { name: 'payer_plan_pbm', rows: d.plans },
    { name: 'hcps', rows: d.hcps },
    { name: 'frm_territories', rows: d.territories },
    { name: 'frm_cases', rows: d.cases },
    { name: 'product_master', rows: d.products },
  ]);
  FEATURES.frmHeldBackFilters = [];
  const exportOf = (spec: DashboardSpec) => buildPowerBiProject({ name: 'Sanofi FRM', profiles: r.u.profiles, relationships: r.u.relationships, foundation: r.f, rowsOf: r.rowsOf, anchor: r.engine.anchor, minDate: r.engine.minDate, spec });
  const slicerHeaders = (x: PowerBiExport) => Object.entries(x.files).filter(([p, c]) => p.endsWith('visual.json') && JSON.parse(c).visual.visualType === 'slicer').map(([, c]) => JSON.parse(c).visual.objects.header?.[0]?.properties?.text?.expr?.Literal?.Value as string);

  it('the first export has neither filter', () => {
    const headers = slicerHeaders(r.pbi);
    expect(headers).not.toContain("'Payer'");
    expect(headers).not.toContain("'Time Period'");
    expect(headers).not.toContain("'Custom Date'");
    expect(schemaErrors(r.pbi)).toEqual([]);
  });

  it('after "Add a payer filter" and "Add a time period filter" the export is exactly the full FRM report', () => {
    let spec = r.build.spec;
    for (const cmd of ['Add a payer filter', 'Add a time period filter']) spec = applyDesignCommand(spec, cmd, { u: r.u, f: r.f }).spec;
    // the same pages, with the template's full filter panel (Time Period first, then every FRM filter)
    const full: DashboardSpec = { ...r.build.spec, filters: [periodFilterDef(), ...buildFrmLayout(r.u, r.f)!.filters] };
    const a = exportOf(spec);
    const b = exportOf(full);
    expect(Object.keys(a.files).sort()).toEqual(Object.keys(b.files).sort());
    for (const p of Object.keys(b.files)) expect(a.files[p], p).toBe(b.files[p]);
    expect(slicerHeaders(a)).toEqual(expect.arrayContaining(["'Time Period'", "'Custom Date'", "'Payer'"]));
  });
});

describe('Power BI export – other demo kits', () => {
  it('HCP engagement kit exports cleanly', () => {
    const d = generateSampleData();
    const r = runDemoPipeline('HCP Engagement', SAMPLE_NARRATIVE, SAMPLE_FILES.map((s) => ({ name: s.key, rows: d[s.key] as Row[] })));
    expect(schemaErrors(r.pbi)).toEqual([]);
    expect(unresolvedDax(r.pbi)).toEqual([]);
    expect(r.pbi.warnings.filter((w) => /skipped|not exported/.test(w))).toEqual([]);
    expect(visualTypes(r.pbi)).toEqual(expect.arrayContaining(['card', 'lineChart', 'tableEx']));
  });
  it('retail kit exports cleanly', () => {
    const d = generateRetailData();
    const r = runDemoPipeline('Retail', RETAIL_NARRATIVE, [{ name: 'stores', rows: d.stores }, { name: 'products', rows: d.products }, { name: 'sales', rows: d.sales }]);
    expect(schemaErrors(r.pbi)).toEqual([]);
    expect(unresolvedDax(r.pbi)).toEqual([]);
    expect(r.pbi.warnings.filter((w) => /skipped|not exported/.test(w))).toEqual([]);
  });
});

describe('relationship selection', () => {
  const ids = (s: Set<string>) => [...s].sort();
  it('makes a shortcut inactive when a chain already connects the tables', () => {
    expect(ids(chooseActive([{ id: 'c>j', from: 'cases', to: 'journey' }, { id: 'j>h', from: 'journey', to: 'hcp' }, { id: 'c>h', from: 'cases', to: 'hcp' }]))).toEqual(['c>j', 'j>h']);
  });
  it('keeps one of two parallel links', () => {
    expect(chooseActive([{ id: 'a', from: 'f', to: 'd' }, { id: 'b', from: 'f', to: 'd' }]).size).toBe(1);
  });
  it('breaks a diamond (two paths between the same tables)', () => {
    const active = chooseActive([{ id: '1', from: 'a', to: 'b' }, { id: '2', from: 'b', to: 'd' }, { id: '3', from: 'a', to: 'c' }, { id: '4', from: 'c', to: 'd' }]);
    expect(active.size).toBe(3);
  });
  it('keeps a star schema with two facts fully active', () => {
    expect(chooseActive([{ id: '1', from: 'f1', to: 'd1' }, { id: '2', from: 'f1', to: 'd2' }, { id: '3', from: 'f2', to: 'd1' }, { id: '4', from: 'f2', to: 'd2' }]).size).toBe(4);
  });
});

describe('measure translation', () => {
  const base: Pick<MeasureDef, 'id' | 'name' | 'description' | 'format' | 'logic' | 'assumptions'> = { id: 'x', name: 'X', description: '', format: 'number', logic: '', assumptions: [] };
  const rows: Row[] = [{ ID: 'a', Status: 'Open', Days: 3, Flag: true }, { ID: 'b', Status: 'Closed', Days: 20, Flag: false }];
  const run = (m: MeasureDef) => {
    const r = runDemoPipeline('T', 'Track cases.', [{ name: 'cases', rows }]);
    const f = { ...r.f, measures: [m] };
    return import('./model').then(({ buildModel }) => {
      const model = buildModel({ name: 'T', profiles: r.u.profiles, relationships: r.u.relationships, foundation: f, rowsOf: r.rowsOf, anchor: r.engine.anchor, minDate: r.engine.minDate });
      // the table name comes from the inferred entity; normalise it to T
      const t = model.tables.find((k) => k.datasetId === 'cases')!;
      return model.tables.flatMap((k) => k.measures)[0]?.expression.split(`'${t.name}'`).join("'T'");
    });
  };
  it('counts, conditions and comparisons map to CALCULATE with KEEPFILTERS', async () => {
    expect(await run({ ...base, kind: 'count', datasetId: 'cases', field: 'ID', condition: { field: 'Status', op: 'eq', values: ['Open'] } })).toBe(`CALCULATE(COUNTA('T'[ID]), KEEPFILTERS('T'[Status] = "Open"))`);
    expect(await run({ ...base, kind: 'count', datasetId: 'cases', conditions: [{ field: 'Days', op: 'lt', values: ['14'] }, { field: 'Status', op: 'neq', values: ['Open', 'Pending'] }] })).toBe(`CALCULATE(COUNTROWS('T'), KEEPFILTERS(NOT ISBLANK('T'[Days]) && 'T'[Days] < 14), KEEPFILTERS(NOT 'T'[Status] IN {"Open", "Pending"}))`);
    expect(await run({ ...base, kind: 'countDistinct', datasetId: 'cases', field: 'Status' })).toBe(`DISTINCTCOUNTNOBLANK('T'[Status])`);
    expect(await run({ ...base, kind: 'sum', datasetId: 'cases', field: 'Days', condition: { field: 'Flag', op: 'eq', values: ['true'] } })).toBe(`CALCULATE(SUM('T'[Days]), KEEPFILTERS('T'[Flag] = TRUE()))`);
  });
});
