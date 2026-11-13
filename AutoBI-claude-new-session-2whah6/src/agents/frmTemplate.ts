import type { DashComponent, DashPage, DashboardSpec, DataUnderstanding, DatasetProfile, FieldRef, FilterDef, Foundation, MeasureDef } from '@/types';
import { ref } from '@/lib/engine';
import { catalogueTables } from '@/lib/catalogue';
import { fieldLabel, visibleProfiles } from '@/lib/fieldLabels';
import { uid } from '@/lib/util';
import { reachable } from './dataAgent';
import { FEATURES } from '@/config/features';

/**
 * ProcDNA FRM report template (Field Reimbursement Management + FRM Performance),
 * laid out after the ProcDNA FRM report design (Figma "Reporting Dashboard Designs").
 *
 * Page 1 is the FRM's workbench: Cases / Time to Resolution / Resolution Rate by Case Type /
 * Time to First Fill cards, Priority Prescribers with flags, Open Case Aging and the Case Overview
 * list (Overall Cases / Escalated Cases). Page 2 compares geographies for managers: a highest /
 * lowest scorecard, case volume by geography and product (open / escalated / closed), first
 * response time and closure rate by month and product, and case load against resolution time.
 * Page 2 follows the "Geo Level" selector (region or territory).
 *
 * Built only from catalogue-bound measures and fields that exist in the data,
 * so every component it emits can be validated against the source rows.
 */

export interface FrmLayout {
  pages: DashPage[];
  filters: FilterDef[];
  /** Dataset of the FRM case log (generic per-activity pages skip it). */
  caseDatasetId: string;
  geoLevels?: DashboardSpec['geoLevels'];
}

const comp = (c: Omit<DashComponent, 'id' | 'description'> & { description?: string }): DashComponent => ({ id: uid('cmp'), description: '', ...c });

export function buildFrmLayout(u0: DataUnderstanding, f: Foundation): FrmLayout | null {
  const u = { ...u0, profiles: visibleProfiles(u0.profiles, f) };
  const { case: cases, journey } = catalogueTables(u.profiles);
  if (!cases) return null;
  const cat = (name: string): MeasureDef | undefined => f.measures.find((m) => m.catalogueRef === name);
  const total = cat('Total Cases Received');
  const open = cat('Open Case Backlog');
  const closed = cat('Total Cases Closed');
  if (!total || !open || !closed) return null;
  const closure = cat('Case Closure Rate (%)');
  const avgRes = cat('Average Case Resolution Time (days)');
  const medRes = cat('Median Case Resolution Time (days)');
  const ttff = cat('Time to First Fill (days)');
  const medTtff = cat('Median Time to First Fill (days)');
  const response = cat('FRM Response Time (days)');
  const escalated = cat('Escalated Cases');

  // fields: the case log's own columns, and attributes reachable through relationships (HCP, payer, territory, product)
  const reach = u.profiles.filter((p) => reachable(u.relationships, cases.datasetId, p.datasetId));
  const own = (re: RegExp): FieldRef | undefined => {
    const c = cases.columns.find((x) => re.test(x.name));
    return c ? ref(cases.datasetId, c.name) : undefined;
  };
  const find = (re: RegExp, pool: DatasetProfile[] = reach): FieldRef | undefined => {
    for (const p of pool) {
      const c = p.columns.find((x) => re.test(x.name));
      if (c) return ref(p.datasetId, c.name);
    }
    return undefined;
  };
  const caseType = own(/^case_?type$/i);
  const caseStatus = own(/^case_?status$/i);
  const aging = own(/^aging_?bucket$/i);
  const escFlag = own(/^escalation_?(flag|status)$|^escalated$/i);
  const hcpName = find(/^(hcp|prescriber|physician)_?name$/i);
  const institution = find(/^(institution|account_?name|hco_?name)$/i);
  const territory = find(/^territory_?name$/i) ?? find(/^(frm_)?territory$/i);
  const salesTerritory = find(/^sales_?territory(_?name)?$/i);
  const region = find(/^region$/i);
  const frm = find(/^frm_?name$/i);
  const payer = find(/^payer(_name)?$/i);
  const pbm = find(/^pbm(_name)?$/i);
  const product = find(/^product_?name$/i) ?? find(/^(product|brand)$/i);
  const market = find(/^market$/i);
  const stage = journey && reachable(u.relationships, cases.datasetId, journey.datasetId) ? find(/^current_?stage$/i, [journey]) : undefined;
  // page 2 geography: the selector starts at the broadest level so the charts stay readable without filters
  const geo = region ?? territory;
  const g = geo ? fieldLabel(f, geo).replace(/ Name$/, '') : '';

  // ── Page 1: Field Reimbursement Management (the FRM's workbench)
  const S1 = 'Case Summary';
  const S2 = 'Priority & Aging';
  const S3 = 'Case List';
  const p1: DashComponent[] = [];
  p1.push(comp({ type: 'kpiGroup', title: 'Cases', measureIds: [total.id, open.id, closed.id, ...(closure ? [closure.id] : [])], labels: ['Total', 'Open', 'Closed', ...(closure ? ['Closure Rate'] : [])], width: 4, section: S1, description: 'Cases opened in the selected period and where they stand.' }));
  if (avgRes) p1.push(comp({ type: 'kpiGroup', title: 'Time to Resolution (Days)', measureIds: [avgRes.id, ...(medRes ? [medRes.id] : [])], labels: ['Average', ...(medRes ? ['Median'] : [])], width: 3, section: S1, description: 'Days from case open to close, closed cases only.' }));
  if (closure && caseType) p1.push(comp({ type: 'kpiGroup', title: 'Resolution Rate by Case Type', measureIds: [closure.id], dimension: caseType, width: 6, section: S1, description: 'Closure rate for each case type.' }));
  if (ttff) p1.push(comp({ type: 'kpiGroup', title: 'Time to First Fill (Days)', measureIds: [ttff.id, ...(medTtff ? [medTtff.id] : [])], labels: ['Average', ...(medTtff ? ['Median'] : [])], width: 3, section: S1, description: 'Days from referral to therapy start.' }));
  if (hcpName) p1.push(comp({ type: 'table', title: 'Priority Prescribers', measureIds: [open.id], dimension: hcpName, tableColumns: [], threshold: { op: 'gt', value: 0 }, flags: {}, width: 6, section: S2, description: 'Prescribers with pending cases; two flags for the top 10%, one flag for the next 25%.' }));
  if (aging) p1.push(comp({ type: 'hbar', title: 'Open Case Aging', measureIds: [open.id], dimension: aging, width: 6, section: S2, description: 'Open cases by days since the case was opened.' }));
  const cols = [
    ref(cases.datasetId, cases.primaryKey ?? cases.columns[0].name),
    own(/^case_?(open|initiation)_?date$/i),
    caseType,
    frm,
    own(/^patient_?id$/i),
    product,
    own(/^psp$/i),
    own(/^self_?enrolled$/i),
    hcpName,
    caseStatus,
    own(/^priority$/i),
    payer,
    stage,
    own(/^days_?open$/i),
    own(/^case_?details?$|^issue/i),
  ].filter((x): x is FieldRef => !!x);
  const escCol = escFlag ? cases.columns.find((c) => `${cases.datasetId}::${c.name}` === escFlag) : undefined;
  const escValue = escCol?.topValues.find((v) => /^(escalated|yes|y|true)$/i.test(v.value))?.value;
  p1.push(comp({ type: 'records', title: 'Case Overview', measureIds: [total.id], tableColumns: cols, sortBy: own(/^case_?(open|initiation)_?date$/i), toggle: escCol && escValue ? { label: 'Escalated Cases', allLabel: 'Overall Cases', filter: [{ field: escCol.name, op: 'eq', values: [escValue] }] } : undefined, width: 12, section: S3, description: 'Every case opened in the period, newest first. Click a case to see the patient journey.' }));

  // ── Page 2: FRM Performance (geography deep dive for managers and executives)
  const T1 = 'Scorecard';
  const T2 = 'Deep Dive';
  const p2: DashComponent[] = [];
  if (geo) {
    p2.push(comp({ type: 'extremes', title: `# Cases by ${g}`, measureIds: [total.id], dimension: geo, width: 4, section: T1 }));
    if (closure) p2.push(comp({ type: 'extremes', title: `Closure Rate by ${g} (%)`, measureIds: [closure.id], dimension: geo, width: 4, section: T1 }));
    if (avgRes) p2.push(comp({ type: 'extremes', title: 'Avg Resolution Time (Days)', measureIds: [avgRes.id], dimension: geo, lowIsBest: true, width: 4, section: T1 }));
    p2.push(comp({ type: 'extremes', title: `Open Cases by ${g}`, measureIds: [open.id], dimension: geo, width: 4, section: T1 }));
    if (escalated) p2.push(comp({ type: 'extremes', title: `Escalated Cases by ${g}`, measureIds: [escalated.id], dimension: geo, width: 4, section: T1 }));
    if (hcpName) p2.push(comp({ type: 'extremes', title: 'Top Recurring Prescriber', measureIds: [total.id], dimension: hcpName, topOnly: institution, width: 4, section: T1 }));
    if (caseStatus) p2.push(comp({ type: 'stacked', title: 'Case Volume by Geography', measureIds: [total.id], dimension: geo, subDimension: product, series: caseStatus, width: 6, section: T2, description: `Cases by ${g.toLowerCase()}${product ? ' and product' : ''}: open, escalated and closed.` }));
    if (response) p2.push(comp({ type: 'stacked', title: 'First Response Time (Days)', measureIds: [response.id], timeGrain: 'month', subDimension: product, series: geo, width: 6, section: T2, description: 'Average days from case open to the first FRM action, by month opened.' }));
    if (avgRes) p2.push(comp({ type: 'scatter', title: 'Case Load vs Resolution Time', measureIds: [avgRes.id, total.id], dimension: geo, series: product, width: 4, section: T2, description: `Each point is a ${g.toLowerCase()}${product ? ' and product' : ''}: average resolution days (x) against cases (y).` }));
    if (closure) p2.push(comp({ type: 'bar', title: 'Case Closure Rate', measureIds: [closure.id], timeGrain: 'month', subDimension: product, series: geo, width: 8, section: T2, description: 'Share of each month’s cases that are closed today; recent months are still being worked.' }));
  }

  const pages: DashPage[] = [
    { id: uid('pg'), name: 'Field Reimbursement Management', description: 'The FRM workbench: case summary, priority prescribers, open-case aging and the case overview.', components: p1, template: 'frm' },
    { id: uid('pg'), name: 'FRM Performance', description: 'Geography deep dive for FRM managers and leadership: where cases back up, close slowly or escalate.', components: p2, template: 'frm' },
  ];
  // filter panel of the ProcDNA FRM report
  const filters: FilterDef[] = [];
  // demo storyline: some filters are held back for the presenter to add with the design assistant
  const held = (label: string) => FEATURES.frmHeldBackFilters.some((h) => h.toLowerCase() === label.toLowerCase() || (h.toLowerCase() === 'pbm' && label === 'PBM Name'));
  const F = (field: FieldRef | undefined, label?: string) => field && !held(label ?? '') && !filters.some((x) => x.field === field) && filters.push({ id: uid('flt'), label: label ?? fieldLabel(f, field), type: 'multi', field });
  F(region, 'Region');
  F(territory, 'FRM Territory');
  F(salesTerritory, 'Sales Territory');
  F(market, 'Market');
  F(product, 'Product');
  F(institution, 'Account');
  F(pbm, 'PBM Name');
  F(payer, 'Payer');
  const levels = [region, territory].filter((x): x is FieldRef => !!x);
  return { pages, filters, caseDatasetId: cases.datasetId, geoLevels: levels.length > 1 && geo ? { fields: levels, default: geo, pages: [pages[1].id] } : undefined };
}
