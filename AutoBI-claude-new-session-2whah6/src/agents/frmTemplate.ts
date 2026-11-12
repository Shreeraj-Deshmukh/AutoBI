import type { DashComponent, DashPage, DataUnderstanding, DatasetProfile, FieldRef, FilterDef, Foundation, MeasureDef } from '@/types';
import { ref } from '@/lib/engine';
import { catalogueTables } from '@/lib/catalogue';
import { fieldLabel, visibleProfiles } from '@/lib/fieldLabels';
import { uid } from '@/lib/util';
import { reachable } from './dataAgent';

/**
 * ProcDNA FRM report template (Field Reimbursement Management + FRM Performance).
 *
 * FRMs work cases, not aggregates: the first page is the FRM's own workbench
 * (case summary, priority prescribers, open-case aging and the case list with
 * where each patient is stuck); the second is the manager / executive view
 * comparing territories and drilling through the case journey.
 *
 * Built only from catalogue-bound measures and fields that exist in the data,
 * so every component it emits can be validated against the source rows.
 */

export interface FrmLayout {
  pages: DashPage[];
  filters: FilterDef[];
  /** Dataset of the FRM case log (generic per-activity pages skip it). */
  caseDatasetId: string;
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

  // fields: the case log's own columns, and attributes reachable through relationships (HCP, payer, territory, FRM)
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
  const territory = find(/^territory_?name$/i) ?? find(/^(sales_)?territory$/i);
  const region = find(/^region$/i);
  const frm = find(/^frm_?name$/i);
  const payer = find(/^payer(_name)?$/i);
  const pbm = find(/^pbm(_name)?$/i);
  const stage = journey && reachable(u.relationships, cases.datasetId, journey.datasetId) ? find(/^current_?stage$/i, [journey]) : undefined;
  const label = (r: FieldRef) => fieldLabel(f, r).replace(/ Name$/, '');

  // ── Page 1: Field Reimbursement Management (the FRM's workbench)
  const S1 = 'Case Summary';
  const S2 = 'Priority & Aging';
  const S3 = 'Case List';
  const p1: DashComponent[] = [];
  p1.push(comp({ type: 'kpiGroup', title: 'Cases', measureIds: [total.id, open.id, closed.id, ...(closure ? [closure.id] : [])], labels: ['Total', 'Open', 'Closed', ...(closure ? ['Closure Rate'] : [])], width: 4, section: S1, description: 'Cases opened in the selected period and where they stand.' }));
  if (avgRes) p1.push(comp({ type: 'kpiGroup', title: 'Time to Resolution (Days)', measureIds: [avgRes.id, ...(medRes ? [medRes.id] : [])], labels: ['Average', ...(medRes ? ['Median'] : [])], width: 3, section: S1, description: 'Days from case open to close, closed cases only.' }));
  if (closure && caseType) p1.push(comp({ type: 'kpiGroup', title: 'Resolution Rate by Case Type', measureIds: [closure.id], dimension: caseType, width: 6, section: S1, description: 'Closure rate for each case type.' }));
  if (ttff) p1.push(comp({ type: 'kpiGroup', title: 'Time to First Fill (Days)', measureIds: [ttff.id, ...(medTtff ? [medTtff.id] : [])], labels: ['Average', ...(medTtff ? ['Median'] : [])], width: 3, section: S1, description: 'Days from referral to therapy start.' }));
  if (hcpName) p1.push(comp({ type: 'table', title: 'Priority Prescribers', measureIds: [open.id], dimension: hcpName, tableColumns: [institution, territory].filter((x): x is FieldRef => !!x), threshold: { op: 'gt', value: 0 }, flags: {}, width: 6, section: S2, description: 'Prescribers with pending cases; two flags for the top 10%, one flag for the next 25%.' }));
  if (aging) p1.push(comp({ type: 'hbar', title: 'Open Case Aging', measureIds: [open.id], dimension: aging, width: 6, section: S2, description: 'Open cases by days since the case was opened.' }));
  const cols = [
    ref(cases.datasetId, cases.primaryKey ?? cases.columns[0].name),
    own(/^patient_?id$/i),
    own(/^case_?open_?date$/i),
    caseType,
    own(/^priority$/i),
    hcpName,
    payer,
    stage,
    own(/^days_?open$/i),
    own(/^escalation_?date$/i),
    own(/^days_?since_?escalation$/i),
    own(/^case_?details?$|^issue/i),
  ].filter((x): x is FieldRef => !!x);
  const escCol = escFlag ? cases.columns.find((c) => `${cases.datasetId}::${c.name}` === escFlag) : undefined;
  const escValue = escCol?.topValues.find((v) => /^(escalated|yes|y|true)$/i.test(v.value))?.value;
  p1.push(comp({ type: 'records', title: 'Open Cases', measureIds: [open.id], tableColumns: cols, sortBy: own(/^days_?open$/i), toggle: escCol && escValue ? { label: 'Escalated only', filter: [{ field: escCol.name, op: 'eq', values: [escValue] }] } : undefined, width: 12, section: S3, description: 'Every open case, longest-waiting first. Click a case to see the patient journey.' }));

  // ── Page 2: FRM Performance (territory deep dive for managers and executives)
  const geo = territory ?? region;
  const T1 = 'Territory Scorecard';
  const T2 = 'Territory Deep Dive';
  const T3 = 'Case Journey';
  const p2: DashComponent[] = [];
  if (geo) {
    const g = label(geo);
    p2.push(comp({ type: 'extremes', title: `# Cases by ${g}`, measureIds: [total.id], dimension: geo, width: 3, section: T1 }));
    if (closure) p2.push(comp({ type: 'extremes', title: `Closure Rate by ${g}`, measureIds: [closure.id], dimension: geo, width: 3, section: T1 }));
    if (avgRes) p2.push(comp({ type: 'extremes', title: 'Avg Resolution Time (Days)', measureIds: [avgRes.id], dimension: geo, lowIsBest: true, width: 3, section: T1 }));
    p2.push(comp({ type: 'extremes', title: `Open Cases by ${g}`, measureIds: [open.id], dimension: geo, width: 3, section: T1 }));
    if (escalated) p2.push(comp({ type: 'extremes', title: `Escalated Cases by ${g}`, measureIds: [escalated.id], dimension: geo, width: 3, section: T1 }));
    if (hcpName) p2.push(comp({ type: 'extremes', title: 'Top Recurring Prescriber', measureIds: [total.id], dimension: hcpName, topOnly: institution, width: 3, section: T1 }));
    if (caseStatus) p2.push(comp({ type: 'stacked', title: `Case Volume by ${g}`, measureIds: [total.id], dimension: geo, series: caseStatus, width: 6, section: T2 }));
    if (closure) p2.push(comp({ type: 'bar', title: `Case Closure Rate by ${g}`, measureIds: [closure.id], dimension: geo, width: 6, section: T2 }));
    if (response) p2.push(comp({ type: 'bar', title: `FRM Response Time by ${g} (Days)`, measureIds: [response.id], dimension: geo, width: 6, section: T2, description: 'Average days from case open to the first FRM action.' }));
    if (response) p2.push(comp({ type: 'scatter', title: 'Case Load vs FRM Response Time', measureIds: [response.id, total.id], dimension: geo, width: 6, section: T2, description: `Each point is a ${g.toLowerCase()}: response time (x) against case volume (y).` }));
  }
  if (closure) p2.push(comp({ type: 'line', title: 'Case Closure Rate by Month Opened', measureIds: [closure.id], timeGrain: 'month', width: 6, section: T2, description: 'Share of each month’s cases that are closed today; recent months are still being worked.' }));
  p2.push(comp({ type: 'line', title: 'Cases Opened vs Still Open', measureIds: [total.id, open.id], timeGrain: 'month', width: 6, section: T2, description: 'By month the case was opened.' }));
  const levels = [region, territory, caseType, caseStatus].filter((x): x is FieldRef => !!x);
  if (levels.length >= 2) p2.push(comp({ type: 'drilldown', title: 'Case Journey – Hierarchical Drilldown', measureIds: [total.id], dimension: levels[0], levels, width: 12, section: T3, description: 'Click a bar to open the next level: where exactly are cases getting stuck?' }));

  const pages: DashPage[] = [
    { id: uid('pg'), name: 'Field Reimbursement Management', description: 'The FRM workbench: case summary, priority prescribers, open-case aging and the case list.', components: p1, template: 'frm' },
    { id: uid('pg'), name: 'FRM Performance', description: 'Territory deep dive for FRM managers and leadership: where cases back up, close slowly or escalate.', components: p2, template: 'frm' },
  ];
  const filters: FilterDef[] = [];
  const F = (field: FieldRef | undefined) => field && !filters.some((x) => x.field === field) && filters.push({ id: uid('flt'), label: fieldLabel(f, field), type: 'multi', field });
  F(region);
  F(territory);
  F(frm);
  F(hcpName);
  F(payer);
  F(pbm);
  F(caseType);
  return { pages, filters, caseDatasetId: cases.datasetId };
}
