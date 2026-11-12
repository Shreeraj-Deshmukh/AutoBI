import type { ComponentType, DashComponent, DashPage, DashboardSpec, DataUnderstanding, DatasetProfile, FieldRef, FilterDef, Foundation, MeasureDef, RequirementSpec, TimeGrain } from '@/types';
import { ref, splitRef } from '@/lib/engine';
import { findField, tokens } from '@/lib/semantic';
import { humanize, plural, uid } from '@/lib/util';
import { fieldLabel, visibleProfiles } from '@/lib/fieldLabels';
import { conditionsOf } from '@/lib/conditions';
import { reachable } from './dataAgent';

/** Dashboard Design Agent: generates and edits a configuration-driven wireframe. */

const comp = (c: Omit<DashComponent, 'id' | 'description'> & { description?: string }): DashComponent => ({ id: uid('cmp'), description: '', ...c });

export const CHART_LABELS: Record<ComponentType, string> = {
  kpi: 'KPI card',
  bar: 'Column chart',
  hbar: 'Bar chart',
  stacked: 'Stacked column',
  line: 'Line chart',
  area: 'Area chart',
  donut: 'Donut chart',
  table: 'Table',
  funnel: 'Funnel',
};

interface Ctx {
  u: DataUnderstanding;
  f: Foundation;
  spec: RequirementSpec | null;
  label: (id: string) => string;
}

function measuresOf(f: Foundation, datasetId: string) {
  const own = f.measures.filter((m) => m.datasetId === datasetId);
  const ratios = f.measures.filter((m) => m.kind === 'ratio' && own.some((o) => o.id === m.numeratorId));
  const count = own.find((m) => m.kind === 'count' && !m.condition);
  // a volume measure (TRx, revenue, units…) is a better headline than a row count
  const volume = own.find((m) => m.kind === 'sum' && /(trx|revenue|amount|sales|units|quantity|value|net|volume|spend)/i.test(m.field ?? ''));
  return { total: volume ?? count, count, conditional: own.filter((m) => m.kind === 'count' && m.condition), reached: own.find((m) => m.kind === 'countDistinct'), sums: own.filter((m) => m.kind === 'sum'), rates: ratios.filter((r) => r.format === 'percent'), avgs: ratios.filter((r) => r.format !== 'percent') };
}

// Labels and visibility follow the reporting foundation's field mapping.
let activeFoundation: Foundation | null = null;
function dimLabel(field: FieldRef) {
  return fieldLabel(activeFoundation, field);
}

/** Resolve a business phrase (e.g. "Account tier") to a field reachable from `fact`. */
function resolveDim(text: string, ctx: Ctx, fact?: string): FieldRef | null {
  const reach = ctx.u.profiles.filter((p) => !fact || reachable(ctx.u.relationships, fact, p.datasetId));
  const f = findField(text, reach, { roles: ['dimension', 'status', 'attribute'], prefer: fact });
  return f ? ref(f.datasetId, f.column) : null;
}

function ownDims(p: DatasetProfile, max = 12) {
  return p.columns.filter((c) => (c.role === 'dimension' || c.role === 'status') && c.distinct >= 2 && c.distinct <= max).map((c) => ref(p.datasetId, c.name));
}

export function generateDesign(u0: DataUnderstanding, f: Foundation, spec: RequirementSpec | null): DashboardSpec {
  activeFoundation = f;
  const u: DataUnderstanding = { ...u0, profiles: visibleProfiles(u0.profiles, f) };
  const label = (id: string) => u.profiles.find((p) => p.datasetId === id)?.label ?? id;
  const ctx: Ctx = { u, f, spec, label };
  const grain: TimeGrain = spec?.timeGrain ?? 'week';
  const comparison = spec ? spec.comparison || spec.ambiguities.every((a) => a.field !== 'comparison' || !a.answer?.toLowerCase().startsWith('no')) : true;
  const acts = u.profiles.filter((p) => p.kind === 'activity');
  const masters = u.profiles.filter((p) => p.kind === 'master');
  const pages: DashPage[] = [];

  // requested breakdowns ("Calls by segment")
  const breakdowns: { m: MeasureDef; dim: FieldRef; text: string }[] = [];
  for (const k of spec?.kpis ?? []) {
    const [metric, dimText] = k.text.split(/\s+by\s+/i);
    if (!dimText) continue;
    const mt = tokens(metric);
    const ds = acts.find((a) => tokens(a.entity).some((t) => mt.includes(t))) ?? acts[0];
    if (!ds) continue;
    const total = measuresOf(f, ds.datasetId).total;
    const dim = resolveDim(dimText, ctx, ds.datasetId);
    if (total && dim) breakdowns.push({ m: total, dim, text: `${total.kind === 'sum' ? total.name.replace(/^Total /, '') : humanize(plural(ds.entity))} by ${dimLabel(dim)}` });
  }

  // ── Executive overview
  const exec: DashComponent[] = [];
  const headline: MeasureDef[] = [];
  for (const a of acts) {
    const ms = measuresOf(f, a.datasetId);
    if (ms.total) headline.push(ms.total);
    headline.push(...ms.conditional, ...ms.rates.slice(-1));
  }
  const kpis = headline.slice(0, 6);
  for (const m of kpis) exec.push(comp({ type: 'kpi', title: m.name, measureIds: [m.id], comparison, width: kpis.length >= 5 ? 3 : 4 }));
  // align KPI row widths to 12 columns
  if (kpis.length === 5) exec.slice(0, 5).forEach((c, i) => (c.width = i < 2 ? 3 : 3));
  for (const b of breakdowns.slice(0, 2)) exec.push(comp({ type: 'bar', title: b.text, measureIds: [b.m.id], dimension: b.dim, width: 6, description: `Requirement: ${b.text}` }));
  const engagementAct = acts.find((a) => measuresOf(f, a.datasetId).conditional.length) ?? acts[0];
  if (engagementAct) {
    const ms = measuresOf(f, engagementAct.datasetId);
    const ids = [ms.total, ...ms.conditional].filter(Boolean).map((m) => m!.id);
    exec.push(comp({ type: 'line', title: `${engagementAct.entity} Engagement Trend`, measureIds: ids, timeGrain: grain, width: 12, description: `${humanize(grain)}ly trend of ${engagementAct.entity.toLowerCase()} volumes.` }));
  }
  const funnelPage = buildFunnelPage(ctx, grain, comparison);
  if (funnelPage) pages.push(funnelPage);
  else pages.push({ id: uid('pg'), name: 'Executive Overview', description: 'Headline KPIs with period comparison and key breakdowns.', components: exec });

  // ── One analytics page per activity dataset
  for (const a of acts) {
    const ms = measuresOf(f, a.datasetId);
    if (!ms.total) continue;
    const cs: DashComponent[] = [];
    const statusLike = ms.conditional.length > 0;
    const kpiSet = statusLike ? [ms.total, ...ms.conditional, ...ms.rates] : ([...new Set([ms.total, ...ms.sums, ms.reached, ...ms.avgs])].filter(Boolean) as MeasureDef[]);
    const kw = kpiSet.length >= 5 ? (kpiSet.length === 5 ? 3 : 3) : kpiSet.length === 4 ? 3 : 4;
    for (const m of kpiSet.slice(0, 6)) cs.push(comp({ type: 'kpi', title: m.name, measureIds: [m.id], comparison, width: kw as 3 | 4 }));
    if (statusLike) {
      cs.push(comp({ type: 'line', title: `${a.entity} Status Trend`, measureIds: [ms.total.id, ...ms.conditional.map((m) => m.id)], timeGrain: grain, width: 8 }));
      if (ms.rates.length) cs.push(comp({ type: 'line', title: `${ms.rates[ms.rates.length - 1].name} Trend`, measureIds: [ms.rates[ms.rates.length - 1].id], timeGrain: grain, width: 4 }));
    } else {
      cs.push(comp({ type: 'area', title: `${ms.total.kind === 'sum' ? ms.total.name : `Total ${plural(a.entity)}`} Over Time`, measureIds: [ms.total.id], timeGrain: grain, width: 12 }));
    }
    // requested breakdowns for this dataset first, then reachable master dims named in requirements, then own dims
    const dims: FieldRef[] = [];
    for (const b of breakdowns.filter((b) => b.m.id === ms.total!.id)) if (!dims.includes(b.dim)) dims.push(b.dim);
    for (const d of [...(spec?.dimensions ?? []), ...(spec?.filters ?? [])]) {
      if (/period|date/i.test(d.text)) continue;
      const r = resolveDim(d.text, ctx, a.datasetId);
      if (r && !dims.includes(r)) dims.push(r);
    }
    for (const d of ownDims(a)) if (!dims.includes(d)) dims.push(d);
    const card = (d: FieldRef) => u.profiles.find((p) => p.datasetId === splitRef(d).datasetId)?.columns.find((c) => c.name === splitRef(d).column)?.distinct ?? 99;
    const own = dims.filter((d) => splitRef(d).datasetId === a.datasetId && card(d) <= 12);
    const donutDim = own.find((d) => (a.columns.find((c) => c.name === splitRef(d).column)?.distinct ?? 99) <= 5 && !breakdowns.some((b) => b.dim === d));
    let used = 0;
    for (const d of dims) {
      if (d === donutDim || used >= 4) continue;
      const card = u.profiles.find((p) => p.datasetId === splitRef(d).datasetId)?.columns.find((c) => c.name === splitRef(d).column)?.distinct ?? 10;
      if (card > 25 || splitRef(d).column === a.dateField) continue;
      const m = statusLike && ms.rates.length && used % 2 === 1 ? ms.rates[ms.rates.length - 1] : ms.total;
      cs.push(comp({ type: card > 8 ? 'hbar' : 'bar', title: `${m.name.replace(/^Total /, '')} by ${dimLabel(d)}`, measureIds: [m.id], dimension: d, width: 6, topN: card > 12 ? 12 : undefined }));
      used++;
    }
    if (donutDim) cs.push(comp({ type: 'donut', title: `${dimLabel(donutDim).toLowerCase().startsWith(a.entity.toLowerCase()) ? dimLabel(donutDim) : `${humanize(a.entity)} ${dimLabel(donutDim)}`} Distribution`, measureIds: [ms.total.id], dimension: donutDim, width: 6 }));
    // stacked: first master dim x first own dim
    const masterDim = dims.find((d) => splitRef(d).datasetId !== a.datasetId && card(d) <= 12);
    const seriesDim = own.find((d) => d !== donutDim) ?? donutDim;
    if (masterDim && seriesDim) cs.push(comp({ type: 'stacked', title: `${ms.total.kind === 'sum' ? ms.total.name.replace(/^Total /, '') : plural(a.entity)} by ${dimLabel(masterDim)} and ${dimLabel(seriesDim)}`, measureIds: [ms.total.id], dimension: masterDim, series: seriesDim, width: 12 }));
    // related reference tables (e.g. campaign performance)
    for (const r of u.relationships.filter((r) => r.fromDataset === a.datasetId)) {
      const tgt = u.profiles.find((p) => p.datasetId === r.toDataset)!;
      const nameCol = tgt.columns.find((c) => /name/i.test(c.name)) ?? tgt.columns.find((c) => c.role === 'attribute');
      if (!nameCol || tgt.rowCount > 60) continue;
      const attrs = tgt.columns.filter((c) => c.role === 'dimension').slice(0, 2).map((c) => ref(tgt.datasetId, c.name));
      cs.push(comp({ type: 'table', title: `${tgt.entity} Performance`, measureIds: [ms.total.id, ...ms.conditional.map((m) => m.id), ...ms.rates.map((m) => m.id)], dimension: ref(tgt.datasetId, nameCol.name), tableColumns: attrs, width: 12 }));
    }
    const pageName = statusLike ? `${a.entity} Engagement` : `${a.entity} Analytics`;
    pages.push({ id: uid('pg'), name: pageName, description: `Detailed analysis of ${a.label}.`, components: cs });
  }

  // ── Entity-level performance (master with name attribute)
  for (const mst of masters) {
    const linked = acts.filter((a) => reachable(u.relationships, a.datasetId, mst.datasetId));
    const nameCol = mst.columns.find((c) => /name/i.test(c.name) && c.role === 'attribute') ?? mst.columns.find((c) => c.role === 'attribute');
    if (!linked.length || !nameCol || mst.rowCount <= 60) continue;
    const measureIds: string[] = [];
    for (const a of linked) {
      const ms = measuresOf(f, a.datasetId);
      if (ms.total) measureIds.push(ms.total.id);
      measureIds.push(...ms.conditional.map((m) => m.id));
    }
    const attrs = mst.columns.filter((c) => c.role === 'dimension').slice(0, 5).map((c) => ref(mst.datasetId, c.name));
    const first = measuresOf(f, linked[0].datasetId).total!;
    const cs: DashComponent[] = [
      comp({ type: 'kpi', title: f.measures.find((m) => m.datasetId === mst.datasetId && m.kind === 'count')?.name ?? `Total ${plural(mst.entity)}`, measureIds: [f.measures.find((m) => m.datasetId === mst.datasetId && m.kind === 'count')?.id ?? first.id], width: 4 }),
      ...linked.map((a) => measuresOf(f, a.datasetId).reached).filter(Boolean).slice(0, 2).map((m) => comp({ type: 'kpi', title: m!.name, measureIds: [m!.id], comparison, width: 4 })),
      comp({ type: 'hbar', title: `Top 10 ${plural(mst.entity)} by ${first.name.replace(/^Total /, '')}`, measureIds: [first.id], dimension: ref(mst.datasetId, nameCol.name), topN: 10, width: 12 }),
      comp({ type: 'table', title: `${mst.entity}-Level Performance`, measureIds, dimension: ref(mst.datasetId, nameCol.name), tableColumns: attrs, width: 12, description: 'Searchable, sortable account-level table. Click a row to cross-filter the dashboard.' }),
    ];
    pages.push({ id: uid('pg'), name: `${mst.entity}-Level Performance`, description: `Performance of each ${mst.entity.toLowerCase()} across activity channels.`, components: cs });
  }

  // ── Filters
  const filters: FilterDef[] = [{ id: uid('flt'), label: 'Reporting Period', type: 'period' }];
  const filterTexts = (spec?.filters ?? []).map((x) => x.text).filter((t) => !/period|date|time/i.test(t));
  for (const t of filterTexts) {
    const r = resolveDim(t, ctx);
    if (r && !filters.some((x) => x.field === r)) filters.push({ id: uid('flt'), label: dimLabel(r), type: 'multi', field: r });
  }
  if (filters.length < 3) {
    for (const p of [...masters, ...acts]) for (const d of ownDims(p, 30).slice(0, 2)) if (filters.length < 5 && !filters.some((x) => x.field === d)) filters.push({ id: uid('flt'), label: dimLabel(d), type: 'multi', field: d });
  }
  const preset = grain === 'week' ? 'r13w' : grain === 'month' ? 'last6m' : 'last12m';
  return { pages, filters, defaultPeriod: preset, timeGrain: grain };
}

// ───────────────────────── Funnel-style overview ─────────────────────────
/**
 * When the requirements define stage-based counts on one dataset (e.g. patients
 * awaiting PA / approved / initiating therapy), lay the overview out as
 * Funnel → Barriers → Action list, the way access and pipeline dashboards are read.
 */
function buildFunnelPage(ctx: Ctx, grain: TimeGrain, comparison: boolean): DashPage | null {
  const { f, u, spec } = ctx;
  if (!spec) return null;
  const order = (m: MeasureDef) => {
    const i = spec.kpis.findIndex((k) => k.text === m.requirementRef);
    return i < 0 ? 99 : i;
  };
  const isCount = (m: MeasureDef) => m.kind === 'count' || m.kind === 'countDistinct';
  const stageCounts = f.measures.filter((m) => m.requirementRef && isCount(m) && conditionsOf(m).some((c) => c.op === 'eq') && !conditionsOf(m).some((c) => c.op === 'notnull'));
  const fieldsUsed = stageCounts.map((m) => conditionsOf(m)[0].field);
  const stageField = fieldsUsed.find((fld) => /stage|step|milestone|phase|funnel/i.test(fld) && fieldsUsed.filter((x) => x === fld).length >= 2);
  if (stageCounts.length < 2 || !stageField) return null;
  const ds = stageCounts[0].datasetId!;
  const prof = u.profiles.find((p) => p.datasetId === ds)!;
  const base = f.measures.find((m) => m.datasetId === ds && isCount(m) && !conditionsOf(m).length && m.requirementRef) ?? f.measures.find((m) => m.datasetId === ds && m.kind === 'countDistinct' && !conditionsOf(m).length && m.field === prof.primaryKey) ?? f.measures.find((m) => m.datasetId === ds && m.kind === 'count' && !conditionsOf(m).length);
  if (!base) return null;
  const funnel = [base, ...stageCounts.filter((m) => m.id !== base.id && !/open|unresolved/i.test(conditionsOf(m)[0].values.join(' '))).sort((a, b) => order(a) - order(b))].slice(0, 6);
  const reqMain = f.measures.filter((m) => m.requirementRef && !/ by /i.test(m.requirementRef) && !m.name.endsWith('numerator') && !m.name.endsWith('denominator')).sort((a, b) => order(a) - order(b));
  const parts = new Set(f.measures.flatMap((m) => [m.numeratorId, m.denominatorId]).filter(Boolean));
  const kpis = [...new Set([base, ...reqMain.filter((m) => !parts.has(m.id) && (m.kind === 'ratio' || m.kind === 'avg' || isCount(m)))])].slice(0, 6);
  const comps: DashComponent[] = [];
  const S1 = /patient/i.test(prof.entity) ? 'Patient Funnel' : `${humanize(prof.entity)} Funnel`;
  for (const m of kpis) comps.push(comp({ type: 'kpi', title: m.name, measureIds: [m.id], comparison, width: 3, section: S1 }));
  comps.push(comp({ type: 'funnel', title: `${humanize(prof.entity)} Funnel`, measureIds: funnel.map((m) => m.id), width: 12, section: S1, description: 'Stage counts for the selected period; percentages are relative to the first stage.' }));

  // barriers: rates by payer / PBM, most common issues, trend
  const S2 = /access|reimburse|authori/i.test(spec.objectives.map((o) => o.text).join(' ')) ? 'Access Barriers' : 'Drivers';
  const rates = reqMain.filter((m) => m.kind === 'ratio');
  const dimFor = (re: RegExp) => {
    for (const d of [...spec.dimensions, ...spec.filters]) if (re.test(d.text)) { const r = resolveDim(d.text, ctx, ds); if (r) return r; }
    return null;
  };
  const pbm = dimFor(/pbm|channel|benefit/i);
  const payer = dimFor(/payer|plan|insurer/i);
  const barrierCol = prof.columns.find((c) => /barrier|issue|reason/i.test(c.name) && c.role === 'dimension');
  const open = f.measures.find((m) => m.datasetId === ds && isCount(m) && conditionsOf(m).some((c) => /open|unresolved/i.test(c.values.join(' '))));
  const finish = funnel.find((m) => /initiat|start|complet|ship|won|convert/i.test(conditionsOf(m)[0]?.values.join(' ') ?? '')) ?? funnel[funnel.length - 1];
  comps.push(comp({ type: 'line', title: `${base.name} vs ${finish.name}`, measureIds: [...new Set([base.id, finish.id])], timeGrain: grain === 'week' ? 'week' : 'month', width: 12, section: S2 }));
  if (rates[0] && pbm) comps.push(comp({ type: 'bar', title: `${rates[0].name} by ${dimLabel(pbm)}`, measureIds: [rates[0].id], dimension: pbm, width: 6, section: S2 }));
  if ((rates[1] ?? rates[0]) && payer) comps.push(comp({ type: 'hbar', title: `${(rates[1] ?? rates[0]).name} by ${dimLabel(payer)}`, measureIds: [(rates[1] ?? rates[0]).id], dimension: payer, width: 6, section: S2 }));
  if (barrierCol) comps.push(comp({ type: 'hbar', title: `Most Common ${humanize(barrierCol.name)}s`, measureIds: [(open ?? base).id], dimension: ref(ds, barrierCol.name), width: 6, section: S2, description: open ? 'Open cases by issue type.' : undefined }));
  const pendingStage = stageCounts.find((m) => /pending|await/i.test(conditionsOf(m)[0].values.join(' ')));
  const stageDim = ref(ds, stageField);
  comps.push(comp({ type: 'donut', title: `Current ${humanize(stageField).replace(/^Current /, '')} Mix`, measureIds: [base.id], dimension: stageDim, width: 6, section: S2 }));

  // action list: entity breakdowns from requirements, delayed records, territories
  const S3 = /\bFRM|field reimbursement/i.test(spec.objectives.concat(spec.filters).map((o) => o.text).join(' ') + (spec.stories ?? []).map((x) => x.text).join(' ')) ? 'FRM Actionability' : 'Action List';
  const reqBy = f.measures.filter((m) => m.requirementRef && / by /i.test(m.requirementRef));
  for (const m of reqBy) {
    const dimText = m.requirementRef!.split(/\s+by\s+/i)[1];
    const dim = resolveDim(dimText, ctx, ds);
    if (dim && !comps.some((c) => c.dimension === dim && c.measureIds[0] === m.id)) comps.push(comp({ type: 'hbar', title: `${dimLabel(dim).replace(/ Name$/, '')}s with the Most ${m.name}`, measureIds: [m.id], dimension: dim, topN: 10, width: 6, section: S3 }));
  }
  const terr = dimFor(/territor|region|district/i);
  if (terr) comps.push(comp({ type: 'bar', title: `${(open ?? base).name} by ${dimLabel(terr)}`, measureIds: [(open ?? base).id], dimension: terr, width: 6, section: S3 }));
  const daysCol = prof.columns.find((c) => c.role === 'measure' && /days.*(stage|current|pending)|(stage|pending).*days/i.test(c.name));
  if (prof.primaryKey && (pendingStage || open)) {
    const attrs = [stageField, barrierCol?.name, daysCol?.name].filter((x): x is string => !!x).map((c) => ref(ds, c));
    const hcpName = resolveDim('HCP', ctx, ds);
    if (hcpName && splitRef(hcpName).datasetId !== ds) attrs.splice(1, 0, hcpName);
    comps.push(comp({ type: 'table', title: `${humanize(plural(prof.entity))} with Open Access Issues`, measureIds: [(open ?? pendingStage)!.id], dimension: ref(ds, prof.primaryKey), tableColumns: attrs, threshold: { op: 'gt', value: 0 }, width: 12, section: S3, description: 'Sorted by days in current stage — longest-waiting first.' }));
  }
  return { id: uid('pg'), name: 'Patient Access Overview'.replace('Patient', humanize(prof.entity)), description: 'Funnel, barriers and the FRM action list.', components: comps };
}

// ───────────────────────── Design change requests ─────────────────────────

export interface DesignEditResult {
  spec: DashboardSpec;
  reply: string;
  changed: boolean;
}

const TYPE_WORDS: [RegExp, ComponentType][] = [
  [/\b(pie|donut|doughnut)\b/, 'donut'],
  [/\bstacked\b/, 'stacked'],
  [/\b(horizontal bar|bar chart horizontal|hbar)\b/, 'hbar'],
  [/\b(bar|column)\b/, 'bar'],
  [/\barea\b/, 'area'],
  [/\b(line|trend)\b/, 'line'],
  [/\btable\b/, 'table'],
];
const typeFrom = (s: string) => TYPE_WORDS.find(([re]) => re.test(s))?.[1];

function findComponents(spec: DashboardSpec, phrase: string) {
  const want = tokens(phrase).filter((t) => !['the', 'chart', 'analysis', 'visual', 'visualization', 'a', 'to', 'graph'].includes(t));
  const all = spec.pages.flatMap((p) => p.components.map((c) => ({ page: p, c })));
  const typ = typeFrom(phrase);
  return all
    .map((x) => ({ ...x, s: tokens(x.c.title).filter((t) => want.includes(t)).length + (typ && x.c.type === typ ? 1.5 : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
}

function findPage(spec: DashboardSpec, phrase: string) {
  const want = tokens(phrase);
  return spec.pages.map((p) => ({ p, s: tokens(p.name).filter((t) => want.includes(t)).length })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0]?.p;
}

export function applyDesignCommand(input: DashboardSpec, command: string, ctx0: { u: DataUnderstanding; f: Foundation; activePageId?: string }): DesignEditResult {
  activeFoundation = ctx0.f;
  const ctx = { ...ctx0, u: { ...ctx0.u, profiles: visibleProfiles(ctx0.u.profiles, ctx0.f) } };
  const spec: DashboardSpec = JSON.parse(JSON.stringify(input));
  const cmd = command.trim();
  const low = cmd.toLowerCase();
  const active = spec.pages.find((p) => p.id === ctx.activePageId) ?? spec.pages[0];
  const no = (reply: string): DesignEditResult => ({ spec: input, reply, changed: false });

  // move X to Y
  let m = /move (.+?) (?:to|into|onto) (?:the )?(.+?)(?: page)?$/i.exec(cmd);
  if (m) {
    const target = findPage(spec, m[2]);
    const hits = findComponents(spec, m[1]);
    if (!target) return no(`I couldn't find a page matching "${m[2]}". Pages: ${spec.pages.map((p) => p.name).join(', ')}.`);
    if (!hits.length) return no(`I couldn't find a visual matching "${m[1]}".`);
    const top = hits.filter((h) => h.s === hits[0].s && h.page.id !== target.id);
    const moving = top.length ? top : hits.slice(0, 1);
    for (const h of moving) {
      h.page.components = h.page.components.filter((c) => c.id !== h.c.id);
      const pg = spec.pages.find((p) => p.id === target.id)!;
      if (!pg.components.some((c) => c.title === h.c.title)) pg.components.push({ ...h.c, width: h.c.type === 'kpi' ? h.c.width : 6 });
    }
    // re-pick target after mutation
    return { spec, changed: true, reply: `Moved ${moving.map((h) => `"${h.c.title}"`).join(', ')} to ${target.name}.` };
  }

  // remove/add filter
  m = /(remove|delete|drop) (?:the )?(.+?) (?:filter|slicer)/i.exec(cmd);
  if (m) {
    const want = tokens(m[2]);
    const f = spec.filters.find((x) => tokens(x.label).some((t) => want.includes(t)));
    if (!f) return no(`There is no filter matching "${m[2]}". Current filters: ${spec.filters.map((x) => x.label).join(', ')}.`);
    spec.filters = spec.filters.filter((x) => x.id !== f.id);
    return { spec, changed: true, reply: `Removed the ${f.label} filter.` };
  }
  m = /add (?:an? )?(.+?) (?:filter|slicer)/i.exec(cmd);
  if (m) {
    const fm = findField(m[1], ctx.u.profiles, { roles: ['dimension', 'status', 'attribute', 'foreign_key'] });
    if (!fm) return no(`I couldn't find a field for "${m[1]}" in the data, so I can't add that filter.`);
    const r = ref(fm.datasetId, fm.column);
    if (spec.filters.some((x) => x.field === r)) return no(`A ${dimLabel(r)} filter already exists.`);
    spec.filters.push({ id: uid('flt'), label: dimLabel(r), type: 'multi', field: r });
    return { spec, changed: true, reply: `Added a ${dimLabel(r)} filter (from ${fm.profile.label}.${fm.column}).` };
  }

  // replace/change chart type
  m = /(?:replace|swap) (?:the )?(.+?) with (?:an? )?(.+)$/i.exec(cmd) ?? /(?:change|convert|switch|make) (?:the )?(.+?) (?:to|into) (?:an? )?(.+)$/i.exec(cmd);
  if (m) {
    const t = typeFrom(m[2].toLowerCase());
    if (t && t !== 'kpi') {
      const hits = findComponents(spec, m[1]).filter((h) => h.c.type !== 'kpi');
      const scoped = hits.filter((h) => h.s === hits[0]?.s);
      if (!scoped.length) return no(`I couldn't find a visual matching "${m[1]}".`);
      for (const h of scoped) {
        h.c.type = t;
        if ((t === 'line' || t === 'area') && !h.c.timeGrain) h.c.timeGrain = spec.timeGrain;
        if (['bar', 'hbar', 'donut', 'stacked', 'table'].includes(t) && !h.c.dimension) return no(`"${h.c.title}" has no category dimension, so it can't become a ${CHART_LABELS[t]}.`);
        if (t === 'stacked' && !h.c.series) h.c.type = 'bar';
      }
      return { spec, changed: true, reply: `Changed ${scoped.map((h) => `"${h.c.title}"`).join(', ')} to ${CHART_LABELS[t]}.` };
    }
  }

  // rename
  m = /rename (?:the )?(.+?) (?:to|as) ["“]?(.+?)["”]?$/i.exec(cmd);
  if (m) {
    const pg = findPage(spec, m[1]);
    if (pg && /page/i.test(m[1])) {
      pg.name = m[2];
      return { spec, changed: true, reply: `Renamed page to "${m[2]}".` };
    }
    const h = findComponents(spec, m[1])[0];
    if (!h) return no(`I couldn't find "${m[1]}".`);
    h.c.title = m[2];
    return { spec, changed: true, reply: `Renamed "${m[1]}" to "${m[2]}".` };
  }

  // weekly / monthly comparison
  m = /(weekly|monthly|quarterly) (comparison|trend|view)/i.exec(low);
  if (m) {
    const grain = (m[1].replace('ly', '') as TimeGrain) === ('week' as TimeGrain) ? 'week' : m[1].startsWith('month') ? 'month' : 'quarter';
    const exec = spec.pages[0];
    exec.components.filter((c) => c.type === 'kpi').forEach((c) => (c.comparison = true));
    const primary = exec.components.find((c) => c.type === 'kpi');
    if (primary) exec.components.push(comp({ type: 'line', title: `${humanize(grain)}ly ${primary.title} Comparison`, measureIds: primary.measureIds, timeGrain: grain, width: 12, description: `${humanize(grain)}ly trend for period-over-period comparison.` }));
    spec.defaultPeriod = grain === 'week' ? 'last4w' : grain === 'month' ? 'last6m' : 'last12m';
    return { spec, changed: true, reply: `Added a ${grain}ly comparison: KPI cards on ${exec.name} now show current vs previous period, a ${grain}ly trend line was added, and the default period is now ${spec.defaultPeriod === 'last4w' ? 'the last 4 weeks' : spec.defaultPeriod}.` };
  }

  // threshold visuals: "Show HCPs with more than 5 patients delayed in PA"
  m = /^(?:show|add|list|highlight|identify|flag)?\s*(?:the\s+|a\s+|an\s+)?(.+?)\s+(?:with|where|having|that have)\s+(more than|over|greater than|at least|>=|>)\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(.+?)(?:\s+(?:to|on) (?:the )?(.+?)(?: page)?)?$/i.exec(cmd);
  if (m) {
    const n = /^\d+$/.test(m[3]) ? Number(m[3]) : ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'].indexOf(m[3].toLowerCase()) + 1;
    const fm = findField(m[1].replace(/s$/i, ''), ctx.u.profiles, { roles: ['dimension', 'status', 'attribute'] });
    if (!fm) return no(`I couldn't find a field for "${m[1]}".`);
    const want = tokens(m[4]);
    const delay = /delay|late|stuck|extended|overdue|waiting|long/i.test(m[4]);
    const ranked = ctx.f.measures
      .filter((x) => x.kind !== 'ratio')
      .map((x) => ({ x, s: tokens(x.name).filter((t) => want.includes(t)).length + (delay && conditionsOf(x).some((c) => c.op === 'gt' || c.op === 'gte') ? 2 : 0) }))
      .sort((a, b) => b.s - a.s);
    if (!ranked[0] || ranked[0].s < 1) return no(`There's no KPI for "${m[4]}" yet. Define it first in Reporting Foundation → KPI Definitions (e.g. "patients with PA pending for more than 14 days").`);
    const dim = ref(fm.datasetId, fm.column);
    const page = (m[5] && findPage(spec, m[5])) || active;
    const lastSection = [...page.components].reverse().find((c) => c.section)?.section;
    const title = `${dimLabel(dim).replace(/ Name$/, '')}s with More Than ${n} ${ranked[0].x.name}`;
    page.components.push(comp({ type: 'hbar', title, measureIds: [ranked[0].x.id], dimension: dim, threshold: { op: /at least|>=/.test(m[2]) ? 'gte' : 'gt', value: n }, width: 12, section: lastSection, description: `Only ${dimLabel(dim).replace(/ Name$/, '')}s where ${ranked[0].x.name} ${/at least|>=/.test(m[2]) ? '≥' : '>'} ${n}.` }));
    return { spec, changed: true, reply: `Added "${title}" to ${page.name}${lastSection ? ` (${lastSection})` : ''}, using ${ranked[0].x.name} with a threshold of ${n}.` };
  }

  // add page
  m = /add (?:a |new )?page (?:called |named )?["“]?(.+?)["”]?$/i.exec(cmd);
  if (m) {
    spec.pages.push({ id: uid('pg'), name: m[1], description: 'User-added page.', components: [] });
    return { spec, changed: true, reply: `Added page "${m[1]}". Add KPIs or charts from the component palette.` };
  }

  // add kpi / chart for a measure
  m = /add (?:a |an )?(kpi|card|chart|bar chart|line chart|donut|table)?\s*(?:for|of|showing)?\s*(.+?)(?: by (.+?))?(?: to (?:the )?(.+?)(?: page)?)?$/i.exec(cmd);
  if (m && /^add/i.test(cmd)) {
    const measure = ctx.f.measures.map((x) => ({ x, s: tokens(x.name).filter((t) => tokens(m![2]).includes(t)).length })).sort((a, b) => b.s - a.s)[0];
    if (!measure || measure.s === 0) return no(`I couldn't find a KPI definition matching "${m[2]}". Define it in the Reporting Foundation first.`);
    const page = (m[4] && findPage(spec, m[4])) || active;
    let type: ComponentType = m[1] ? (m[1].includes('line') ? 'line' : m[1].includes('donut') ? 'donut' : m[1].includes('table') ? 'table' : m[1].includes('bar') || m[1] === 'chart' ? 'bar' : 'kpi') : 'kpi';
    let dim: FieldRef | undefined;
    if (m[3]) {
      const fm = findField(m[3], ctx.u.profiles, { roles: ['dimension', 'status', 'attribute', 'foreign_key'] });
      if (!fm) return no(`No field matches "${m[3]}".`);
      dim = ref(fm.datasetId, fm.column);
      if (type === 'kpi') type = 'bar';
    }
    if (['bar', 'donut', 'table'].includes(type) && !dim) type = 'line';
    page.components.push(comp({ type, title: dim ? `${measure.x.name} by ${dimLabel(dim)}` : measure.x.name, measureIds: [measure.x.id], dimension: dim, timeGrain: type === 'line' ? spec.timeGrain : undefined, comparison: type === 'kpi', width: type === 'kpi' ? 3 : 6 }));
    return { spec, changed: true, reply: `Added ${CHART_LABELS[type]} "${measure.x.name}${dim ? ` by ${dimLabel(dim)}` : ''}" to ${page.name}.` };
  }

  // remove component
  m = /(?:remove|delete|drop) (?:the )?(.+)$/i.exec(cmd);
  if (m) {
    const pg = /page/i.test(m[1]) ? findPage(spec, m[1]) : null;
    if (pg) {
      if (spec.pages.length === 1) return no('A dashboard needs at least one page.');
      spec.pages = spec.pages.filter((p) => p.id !== pg.id);
      return { spec, changed: true, reply: `Removed page "${pg.name}".` };
    }
    const h = findComponents(spec, m[1])[0];
    if (!h) return no(`I couldn't find "${m[1]}".`);
    h.page.components = h.page.components.filter((c) => c.id !== h.c.id);
    return { spec, changed: true, reply: `Removed "${h.c.title}" from ${h.page.name}.` };
  }

  // full width / half width
  m = /make (?:the )?(.+?) (full|half)[- ]width/i.exec(cmd);
  if (m) {
    const h = findComponents(spec, m[1])[0];
    if (!h) return no(`I couldn't find "${m[1]}".`);
    h.c.width = m[2] === 'full' ? 12 : 6;
    return { spec, changed: true, reply: `"${h.c.title}" is now ${m[2]} width.` };
  }

  return no('I can apply requests such as: "Move account tier analysis to the executive overview", "Add a weekly comparison", "Remove the state filter", "Add a specialty filter", "Replace the pie chart with a bar chart", "Rename Call Engagement Trend to Activity Trend", "Add page Regional Deep Dive", "Add KPI Accounts Reached".');
}

export function designStats(spec: DashboardSpec) {
  const all = spec.pages.flatMap((p) => p.components);
  return { pages: spec.pages.length, kpis: all.filter((c) => c.type === 'kpi').length, charts: all.filter((c) => !['kpi', 'table'].includes(c.type)).length, tables: all.filter((c) => c.type === 'table').length, filters: spec.filters.length };
}
