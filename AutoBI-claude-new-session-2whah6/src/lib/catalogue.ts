import type { CatalogueCoverage, ColumnProfile, DataUnderstanding, DatasetProfile, MeasureCondition, MeasureDef, MeasureFormat } from '@/types';
import { KPI_CATALOGUE } from '@/config/kpiCatalogue';
import { conditionsOf } from './conditions';
import { uid } from './util';

/**
 * Binds the ProcDNA KPI catalogue to uploaded data.
 *
 * Each recipe says how a catalogue metric (or a measure of the ProcDNA FRM report)
 * is computed from columns that case-management / SP-hub extracts typically carry.
 * Columns and values are matched by name pattern, so the binding works on any data
 * with similar fields — and a metric whose columns are absent is reported as
 * "needs data" with the source the catalogue names (e.g. CRM activity logs).
 */

type Table = 'case' | 'journey';

interface Where {
  col: RegExp;
  op: MeasureCondition['op'];
  /** eq / neq: pattern for the matching column values; gt / gte / lt / lte: threshold */
  value?: RegExp | number;
}

interface Recipe {
  /** Catalogue metric name (source "catalogue") or measure name. */
  name: string;
  source: 'catalogue' | 'report' | 'helper';
  table: Table;
  kind: 'count' | 'countDistinct' | 'avg' | 'median' | 'ratio';
  /** numeric column for avg / median (default: the primary key for counts) */
  field?: RegExp;
  where?: Where[];
  num?: string;
  den?: string;
  format: MeasureFormat;
  description?: string;
}

/** Catalogue metrics answered by another recipe (same computation on this data). */
const ALIASES: Record<string, { of: string; note: string }> = {
  'Cases Assigned to FRM (count)': { of: 'Total Cases Received', note: 'Every case in the FRM case log is FRM-assigned.' },
  'Cases Closed by FRM (count)': { of: 'Total Cases Closed', note: 'Every case in the FRM case log is FRM-assigned.' },
  'FRM Cycle Time (days)': { of: 'Average Case Resolution Time (days)', note: 'Cases are assigned to the FRM when opened, so cycle time equals resolution time.' },
  'FRM Case Escalation Rate (%)': { of: 'Case Escalation Rate (%)', note: 'Every case in the FRM case log is FRM-assigned.' },
  'Average Time to First Response (hrs)': { of: 'FRM Response Time (days)', note: 'The case log records the first FRM action as a date, so response time is measured in days, not hours.' },
  'Time to Therapy Start (days)': { of: 'Time to First Fill (days)', note: 'Referral to therapy start; the SP journey has no separate first-fill date.' },
  'Denial Rate by Payer (%)': { of: 'PA Denial Rate (%)', note: 'PA Denial Rate sliced by Payer.' },
  'Denials by Reason (count)': { of: 'PA Denials', note: 'PA Denials sliced by Access Barrier (denial reason).' },
};

const CLOSED = /^closed$/i;
/** Open backlog: "Open", plus open cases worked under escalation ("Escalated") or awaiting input ("Pending"). */
const OPEN = /^(open|escalated|pending)$/i;
const RECIPES: Recipe[] = [
  // ── case log
  { name: 'Total Cases Received', source: 'catalogue', table: 'case', kind: 'count', format: 'number' },
  { name: 'Total Cases Closed', source: 'catalogue', table: 'case', kind: 'count', where: [{ col: /^case_?status$/i, op: 'eq', value: CLOSED }], format: 'number' },
  { name: 'Open Case Backlog', source: 'catalogue', table: 'case', kind: 'count', where: [{ col: /^case_?status$/i, op: 'eq', value: OPEN }], format: 'number' },
  { name: 'Case Closure Rate (%)', source: 'report', table: 'case', kind: 'ratio', num: 'Total Cases Closed', den: 'Total Cases Received', format: 'percent', description: 'Share of cases opened in the period that are closed (ProcDNA FRM report).' },
  { name: 'Average Case Resolution Time (days)', source: 'catalogue', table: 'case', kind: 'avg', field: /^(days_to_resolution|resolution_days|days_to_close)$/i, format: 'decimal' },
  { name: 'Median Case Resolution Time (days)', source: 'catalogue', table: 'case', kind: 'median', field: /^(days_to_resolution|resolution_days|days_to_close)$/i, format: 'decimal' },
  { name: 'Escalated Cases', source: 'report', table: 'case', kind: 'count', where: [{ col: /^escalation_?(flag|status)?$|^escalated$/i, op: 'eq', value: /^(escalated|yes|y|true)$/i }], format: 'number', description: 'Cases escalated to higher-tier support.' },
  { name: 'Case Escalation Rate (%)', source: 'catalogue', table: 'case', kind: 'ratio', num: 'Escalated Cases', den: 'Total Cases Received', format: 'percent' },
  { name: 'FRM Response Time (days)', source: 'catalogue', table: 'case', kind: 'avg', field: /^(frm_)?(first_)?response_(days|time)$/i, format: 'decimal' },
  { name: 'FRM Case Backlog (count)', source: 'catalogue', table: 'case', kind: 'count', where: [{ col: /^case_?status$/i, op: 'eq', value: OPEN }, { col: /^days_open$/i, op: 'gt', value: 14 }], format: 'number', description: 'Open cases older than the 14-day SLA.' },
  { name: 'Appeals Turnaround Time (days)', source: 'catalogue', table: 'case', kind: 'avg', field: /^(days_to_resolution|resolution_days)$/i, where: [{ col: /^case_?type$/i, op: 'eq', value: /appeal/i }], format: 'decimal' },
  { name: 'Closed Appeals', source: 'helper', table: 'case', kind: 'count', where: [{ col: /^case_?type$/i, op: 'eq', value: /appeal/i }, { col: /^case_?status$/i, op: 'eq', value: CLOSED }], format: 'number' },
  { name: 'Successful Appeals', source: 'helper', table: 'case', kind: 'count', where: [{ col: /^case_?type$/i, op: 'eq', value: /appeal/i }, { col: /^resolution_?(type|outcome)$/i, op: 'eq', value: /^(access secured|successful|approved)$/i }], format: 'number' },
  { name: 'Appeal Success Rate (%)', source: 'catalogue', table: 'case', kind: 'ratio', num: 'Successful Appeals', den: 'Closed Appeals', format: 'percent' },
  // ── SP patient journey
  { name: 'Time to First Fill (days)', source: 'catalogue', table: 'journey', kind: 'avg', field: /^days_to_(therapy|first_?fill)$/i, format: 'decimal' },
  { name: 'Median Time to First Fill (days)', source: 'report', table: 'journey', kind: 'median', field: /^days_to_(therapy|first_?fill)$/i, format: 'decimal', description: 'Median days from referral to therapy start (ProcDNA FRM report).' },
  { name: 'PA Decisions', source: 'helper', table: 'journey', kind: 'count', where: [{ col: /^pa_?outcome$/i, op: 'notnull' }], format: 'number' },
  { name: 'PA Approvals', source: 'helper', table: 'journey', kind: 'count', where: [{ col: /^pa_?outcome$/i, op: 'eq', value: /^approved/i }], format: 'number' },
  { name: 'PA Approval Rate (%)', source: 'catalogue', table: 'journey', kind: 'ratio', num: 'PA Approvals', den: 'PA Decisions', format: 'percent' },
  { name: 'PA Denials', source: 'helper', table: 'journey', kind: 'count', where: [{ col: /^pa_?outcome$/i, op: 'eq', value: /^denied$/i }], format: 'number' },
  { name: 'PA Denial Rate (%)', source: 'catalogue', table: 'journey', kind: 'ratio', num: 'PA Denials', den: 'PA Decisions', format: 'percent' },
  { name: 'Overturned Denials', source: 'helper', table: 'journey', kind: 'count', where: [{ col: /^pa_?outcome$/i, op: 'eq', value: /on appeal/i }], format: 'number' },
  { name: 'Denied or Appealed PAs', source: 'helper', table: 'journey', kind: 'count', where: [{ col: /^pa_?outcome$/i, op: 'eq', value: /^denied$|on appeal/i }], format: 'number' },
  { name: 'Denial Overturn Rate (FRM) (%)', source: 'catalogue', table: 'journey', kind: 'ratio', num: 'Overturned Denials', den: 'Denied or Appealed PAs', format: 'percent' },
  { name: 'Copay-Enrolled Patients', source: 'helper', table: 'journey', kind: 'count', where: [{ col: /^copay_?(program|status)$/i, op: 'eq', value: /^enrolled$/i }], format: 'number' },
  { name: 'Copay-Eligible Patients', source: 'helper', table: 'journey', kind: 'count', where: [{ col: /^copay_?(program|status)$/i, op: 'neq', value: /ineligible/i }, { col: /^copay_?(program|status)$/i, op: 'notnull' }], format: 'number' },
  { name: 'Copay Assistance Utilization (%)', source: 'catalogue', table: 'journey', kind: 'ratio', num: 'Copay-Enrolled Patients', den: 'Copay-Eligible Patients', format: 'percent' },
];

/** Recipes that only exist as building blocks of catalogue ratios (not offered as headline KPIs). */
export const isCatalogueHelper = (m: { catalogueRef?: string }) => !!m.catalogueRef && RECIPES.some((r) => r.name === m.catalogueRef && r.source === 'helper');

/** Measure name shown in reporting: the catalogue name without its unit suffix ("PA Approval Rate (%)" → "PA Approval Rate"). */
export const displayName = (n: string) => n.replace(/\s*\((%|days|count|hrs|mins|usd)\)\s*$/i, '').trim();

const has = (p: DatasetProfile, re: RegExp) => p.columns.some((c) => re.test(c.name));

/** Dataset playing each role: the FRM case log and the SP patient journey. */
export function catalogueTables(profiles: DatasetProfile[]): Partial<Record<Table, DatasetProfile>> {
  const acts = profiles.filter((p) => p.kind === 'activity');
  return {
    case: acts.find((p) => has(p, /^case_?type$/i) && has(p, /^case_?status$/i)),
    journey: acts.find((p) => has(p, /^pa_?outcome$/i) && has(p, /^current_?stage$/i)),
  };
}

function resolveWhere(p: DatasetProfile, w: Where): MeasureCondition | null {
  const col: ColumnProfile | undefined = p.columns.find((c) => w.col.test(c.name));
  if (!col) return null;
  if (w.op === 'notnull') return { field: col.name, op: 'notnull', values: [] };
  if (typeof w.value === 'number') return col.role === 'measure' || col.type === 'integer' || col.type === 'number' ? { field: col.name, op: w.op, values: [String(w.value)] } : null;
  const values = col.topValues.map((v) => v.value).filter((v) => (w.value as RegExp).test(v));
  return values.length ? { field: col.name, op: w.op, values } : null;
}

export interface CatalogueBinding {
  measures: MeasureDef[];
  coverage: CatalogueCoverage[];
}

/**
 * Build catalogue-aligned measures for the data. Identical existing measures are reused
 * (and given the catalogue name when they were generic), so nothing is defined twice.
 */
export function bindCatalogue(u: Pick<DataUnderstanding, 'profiles'>, existing: MeasureDef[] = []): CatalogueBinding {
  const tables = catalogueTables(u.profiles);
  const byName = new Map<string, MeasureDef>();
  const created: MeasureDef[] = [];
  const same = (a: MeasureDef) =>
    existing.find((e) => e.kind === a.kind && e.datasetId === a.datasetId && (e.field ?? null) === (a.field ?? null) && JSON.stringify(conditionsOf(e)) === JSON.stringify(conditionsOf(a)) && e.numeratorId === a.numeratorId && e.denominatorId === a.denominatorId);
  for (const rc of RECIPES) {
    const p = tables[rc.table];
    if (!p) continue;
    const meta = KPI_CATALOGUE.find((m) => m.name === rc.name);
    const base = { id: uid('m'), name: displayName(rc.name), description: rc.description ?? meta?.definition ?? '', format: rc.format, logic: '', catalogueRef: rc.name, assumptions: [rc.source === 'catalogue' ? `ProcDNA KPI Catalogue: ${meta?.computation ?? rc.name}` : rc.source === 'report' ? 'ProcDNA FRM report measure.' : 'Building block of a catalogue ratio.'] };
    let m: MeasureDef | null = null;
    if (rc.kind === 'ratio') {
      const n = byName.get(rc.num!);
      const d = byName.get(rc.den!);
      if (n && d) m = { ...base, kind: 'ratio', numeratorId: n.id, denominatorId: d.id };
    } else {
      const field = rc.field ? p.columns.find((c) => rc.field!.test(c.name) && (c.type === 'integer' || c.type === 'number'))?.name : p.primaryKey;
      const conds = (rc.where ?? []).map((w) => resolveWhere(p, w));
      if ((rc.field && !field) || conds.some((c) => !c)) continue;
      const all = conds as MeasureCondition[];
      // count people once when the key repeats (e.g. re-referred patients)
      const keyRepeats = rc.kind === 'count' && !!p.primaryKey && (p.columns.find((c) => c.name === p.primaryKey)?.distinct ?? 0) < p.rowCount;
      m = { ...base, kind: keyRepeats && !all.length ? 'countDistinct' : rc.kind, datasetId: p.datasetId, field, condition: all[0], conditions: all.slice(1) };
    }
    if (!m) continue;
    const dup = same(m);
    if (dup) {
      dup.catalogueRef = dup.catalogueRef ?? rc.name;
      if (!dup.requirementRef && !dup.userModified) dup.name = m.name;
      byName.set(rc.name, dup);
      continue;
    }
    created.push(m);
    byName.set(rc.name, m);
  }
  const coverage: CatalogueCoverage[] = KPI_CATALOGUE.map((c) => {
    const m = byName.get(c.name);
    if (m) return { metric: c.name, category: c.category, isKpi: c.isKpi, status: 'computed', measureId: m.id, note: c.computation };
    const alias = ALIASES[c.name];
    const target = alias && byName.get(alias.of);
    if (target) return { metric: c.name, category: c.category, isKpi: c.isKpi, status: 'same_as', measureId: target.id, note: alias.note };
    return { metric: c.name, category: c.category, isKpi: c.isKpi, status: 'needs_data', note: `Needs ${c.dataSource || 'additional data'}${c.vendors ? ` (e.g. ${c.vendors.split(',').slice(0, 2).map((v) => v.trim()).join(', ')})` : ''}.` };
  });
  return { measures: created, coverage };
}

/** Catalogue metric whose name matches a requirement KPI text ("PA approval rate" → "PA Approval Rate (%)"). */
export function catalogueMetricFor(text: string) {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return KPI_CATALOGUE.find((m) => m.name.toLowerCase() === t || displayName(m.name).toLowerCase() === t);
}

/** FRM case-management KPIs the Requirement agent proposes from the catalogue. */
export const FRM_REQUIREMENT_KPIS = [
  'Total Cases Received',
  'Open Case Backlog',
  'Total Cases Closed',
  'Case closure rate',
  'Average Case Resolution Time (days)',
  'Median Case Resolution Time (days)',
  'Time to First Fill (days)',
  'FRM Response Time (days)',
  'FRM Case Backlog (count)',
  'Case Escalation Rate (%)',
  'Appeal Success Rate (%)',
];

/** Compact catalogue context for AI prompts. */
export function catalogueContext(max = 62) {
  return KPI_CATALOGUE.slice(0, max).map((m) => `${m.name}: ${m.definition} [${m.computation}]`).join('\n');
}
