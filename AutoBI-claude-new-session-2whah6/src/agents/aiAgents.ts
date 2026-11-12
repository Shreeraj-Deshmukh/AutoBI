import type { MeasureCondition, MeasureDef, DashComponent, ComponentType, FilterDef, DashPage } from '@/types';
import { ref as fref } from '@/lib/engine';
import { reachable } from './dataAgent';
import { visibleProfiles, fieldLabel } from '@/lib/fieldLabels';
import type { Clarification, DashboardSpec, DataUnderstanding, Foundation, ProjectInfo, ReqItem, RequirementSection, RequirementSpec } from '@/types';
import { chatJSON } from './llm';
import { applyDesignCommand } from './designAgent';
import { uid } from '@/lib/util';
import { FRM_REQUIREMENT_KPIS } from '@/lib/catalogue';
import { KPI_CATALOGUE } from '@/config/kpiCatalogue';

/**
 * AI-backed agent behaviours (Azure AI Foundry). Each function returns the same
 * structured artifact as its deterministic counterpart, so downstream agents,
 * data mapping and testing stay grounded in the actual data.
 */

const LISTS: RequirementSection[] = ['objectives', 'stories', 'kpis', 'dimensions', 'filters', 'pages', 'visuals', 'datasets', 'rules'];
const strs = (v: unknown, max = 15): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x: string) => x.trim()).slice(0, max) : []);
const items = (v: unknown, source: ReqItem['source'] = 'extracted'): ReqItem[] => strs(v).map((text) => ({ id: uid('req'), text, source }));

const REQ_RULES = `You are the Requirement Intelligence Agent of a BI delivery platform. Extract a reporting dashboard specification.
Rules:
- "stories": 4–8 user stories in the form "As a <persona>, I want to <need> so that <benefit>".
- "kpis": short metric names that name the business state they count (e.g. "Total patients", "Patients awaiting PA", "PA approval rate", "Average time to therapy initiation"). Express requested breakdowns as "<Metric> by <dimension>" (e.g. "Unresolved access cases by HCP").
- "dimensions": business attributes to slice by (e.g. "Region", "Account tier").
- "filters": slicers the user wants; include "Reporting period" when time is involved.
- "pages": 2–5 dashboard page names, first is "Executive Overview".
- "visuals": short visual suggestions (e.g. "Line chart – weekly calls trend").
- "datasets": data the dashboard needs. "rules": business rules and KPI calculation definitions in plain words (e.g. "PA approval rate = approved PA decisions ÷ all PA decisions").
- "questions": at most 3 clarification questions ONLY for genuinely missing, important info. Each: {"field": "timeGrain"|"comparison"|"audience"|"generic", "question": string, "options": [2-4 short options]}.
- "missing": short notes on missing information that can be assumed.
- "timeGrain": "week"|"month"|"quarter"|null if not stated. "comparison": true if period-over-period comparison is requested.
Use the user's wording; do not invent metrics that have nothing to do with the request.`;

const SCHEMA = `{"objectives":[],"stories":[],"kpis":[],"dimensions":[],"filters":[],"pages":[],"visuals":[],"datasets":[],"rules":[],"questions":[],"missing":[],"timeGrain":null,"comparison":false}`;

interface ReqJson {
  [k: string]: unknown;
  questions?: { field?: string; question?: string; options?: unknown }[];
  timeGrain?: string | null;
  comparison?: boolean;
}

function toSpec(j: ReqJson, base: RequirementSpec): RequirementSpec {
  const spec: RequirementSpec = { ...base };
  for (const k of LISTS) {
    const v = items(j[k]);
    if (v.length) spec[k] = v;
  }
  const grain = String(j.timeGrain ?? '').toLowerCase();
  spec.timeGrain = grain.startsWith('week') ? 'week' : grain.startsWith('month') ? 'month' : grain.startsWith('quarter') ? 'quarter' : base.timeGrain;
  spec.comparison = typeof j.comparison === 'boolean' ? j.comparison || base.comparison : base.comparison;
  if (Array.isArray(j.questions)) {
    spec.ambiguities = j.questions.slice(0, 3).filter((q) => q?.question).map((q): Clarification => ({ id: uid('clar'), field: (['timeGrain', 'comparison', 'audience'].includes(String(q.field)) ? q.field : 'generic') as Clarification['field'], question: String(q.question), options: strs(q.options, 4) }));
  }
  const missing = strs(j.missing, 8);
  if (missing.length) spec.missing = missing;
  return spec;
}

/** FRM / case-management briefs are specified against the ProcDNA KPI catalogue. */
const isFrmCaseBrief = (text: string) => /\bFRMs?\b|field reimbursement/i.test(text) && /\bcases?\b/i.test(text);
const FRM_REQ_RULES = `This is a Field Reimbursement Manager (FRM) / case-management dashboard. FRMs work individual access cases: they need the case list (patient, HCP, payer, case type, priority, days open, where the patient is stuck), while managers compare territories.
- Use these ProcDNA KPI Catalogue metric names verbatim for case KPIs where they fit: ${FRM_REQUIREMENT_KPIS.join('; ')}.
- Other catalogue metrics you may use (verbatim): ${KPI_CATALOGUE.filter((m) => m.isKpi).map((m) => m.name).join('; ')}.
- "pages": start with "Field Reimbursement Management" (FRM case workbench) and "FRM Performance" (territory deep dive).`;

export async function aiExtractRequirements(narrative: string, info: ProjectInfo, base: RequirementSpec): Promise<RequirementSpec> {
  const brief = `Project: ${info.name}\nDomain: ${info.domain}\nObjective: ${info.objective}\nAudience: ${info.audience || '(not given)'}\nFrequency: ${info.frequency || '(not given)'}\nPeriod: ${info.period || '(not given)'}\nKey questions: ${info.keyQuestions.join('; ') || '(none)'}`;
  const frm = isFrmCaseBrief(narrative);
  const j = await chatJSON<ReqJson>(`${REQ_RULES}${frm ? `\n${FRM_REQ_RULES}` : ''}\nReturn JSON with exactly these keys: ${SCHEMA}`, `${brief}\n\nRequirement:\n${narrative}`);
  const spec = toSpec(j, base);
  if (!spec.kpis.length) throw new Error('AI returned no KPIs');
  if (frm) {
    // keep the catalogue KPIs and FRM pages the rules derived, in case the model left some out
    const lower = new Set(spec.kpis.map((k) => k.text.toLowerCase()));
    spec.kpis = [...spec.kpis, ...base.kpis.filter((k) => k.source === 'catalogue' && !lower.has(k.text.toLowerCase()))];
    for (const pg of ['FRM Performance', 'Field Reimbursement Management']) if (!spec.pages.some((x) => x.text.toLowerCase() === pg.toLowerCase())) spec.pages = [{ id: uid('req'), text: pg, source: 'catalogue' }, ...spec.pages];
  }
  return spec;
}

export async function aiRespond(spec: RequirementSpec, message: string, info: ProjectInfo): Promise<{ spec: RequirementSpec; reply: string; infoPatch?: Partial<ProjectInfo> }> {
  const current = Object.fromEntries(LISTS.map((k) => [k, spec[k].map((x) => x.text)]));
  const open = spec.ambiguities.filter((a) => !a.answer).map((a) => ({ id: a.id, question: a.question, options: a.options }));
  const j = await chatJSON<ReqJson & { reply?: string; answers?: { id?: string; answer?: string }[]; audience?: string }>(
    `${REQ_RULES}\nYou are in a conversation refining an existing specification. Apply the user's message: answer open questions, add/remove/rename items as asked. Return JSON: {"reply": "<one or two sentences to the user>", "answers": [{"id": "<open question id>", "answer": "<answer>"}], "audience": "<if stated, else empty>", "timeGrain": ..., "comparison": ..., and ONLY the lists that changed, each as the COMPLETE new list (e.g. "filters": [...])}`,
    `Current specification: ${JSON.stringify(current)}\nOpen questions: ${JSON.stringify(open)}\nAudience: ${info.audience || '(unknown)'}\n\nUser message: ${message}`,
  );
  const next: RequirementSpec = { ...spec, ambiguities: spec.ambiguities.map((a) => ({ ...a })) };
  for (const k of LISTS) {
    if (!Array.isArray(j[k])) continue;
    const texts = strs(j[k], 25);
    next[k] = texts.map((t) => spec[k].find((x) => x.text.toLowerCase() === t.toLowerCase()) ?? { id: uid('req'), text: t, source: 'user' as const });
  }
  for (const a of j.answers ?? []) {
    const c = next.ambiguities.find((x) => x.id === a.id);
    if (c && a.answer) c.answer = String(a.answer);
  }
  const grain = String(j.timeGrain ?? '').toLowerCase();
  if (grain.startsWith('week') || grain.startsWith('month') || grain.startsWith('quarter')) next.timeGrain = grain.startsWith('week') ? 'week' : grain.startsWith('month') ? 'month' : 'quarter';
  if (typeof j.comparison === 'boolean') next.comparison = j.comparison;
  const audience = typeof j.audience === 'string' && j.audience.trim() ? j.audience.trim() : undefined;
  return { spec: next, reply: String(j.reply ?? 'Updated the specification.'), infoPatch: audience && !info.audience ? { audience } : undefined };
}

/** Business descriptions for datasets and columns. Only metadata and a few example values are sent, never full rows. */
export async function aiDescribeData(u: DataUnderstanding, domain: string): Promise<DataUnderstanding> {
  const summary = u.profiles.map((p) => ({ id: p.datasetId, name: p.label, kind: p.kind, rows: p.rowCount, primaryKey: p.primaryKey, columns: p.columns.map((c) => ({ name: c.name, type: c.type, role: c.role, distinct: c.distinct, examples: c.topValues.slice(0, 3).map((v) => v.value) })) }));
  const rels = u.relationships.map((r) => `${u.profiles.find((p) => p.datasetId === r.fromDataset)?.label}.${r.fromField} → ${u.profiles.find((p) => p.datasetId === r.toDataset)?.label}.${r.toField}`);
  const j = await chatJSON<{ datasets?: { id?: string; description?: string }[]; columns?: { datasetId?: string; name?: string; definition?: string }[] }>(
    'You are the Data Intelligence Agent. Given profiled dataset metadata, explain in business language what each dataset represents (1–2 sentences, mention its grain and how it relates to the others) and give a short business definition (max 15 words) for every column. Return {"datasets":[{"id","description"}],"columns":[{"datasetId","name","definition"}]}.',
    `Domain: ${domain || 'unknown'}\nRelationships: ${rels.join('; ') || 'none'}\nDatasets: ${JSON.stringify(summary)}`,
    { maxTokens: 3500 },
  );
  const next: DataUnderstanding = JSON.parse(JSON.stringify(u));
  for (const d of j.datasets ?? []) {
    const p = next.profiles.find((x) => x.datasetId === d.id);
    if (p && d.description) p.inference = String(d.description);
  }
  for (const c of j.columns ?? []) {
    const col = next.profiles.find((x) => x.datasetId === c.datasetId)?.columns.find((x) => x.name === c.name);
    if (col && c.definition) col.businessDefinition = String(c.definition);
  }
  return next;
}

const DESIGN_COMMANDS = [
  'Move <visual> to <page>',
  'Remove the <field> filter',
  'Add a <field> filter',
  'Replace <visual> with a <bar|line|area|donut|table|stacked> chart',
  'Rename <visual> to <new title>',
  'Add a weekly comparison | Add a monthly comparison',
  'Add page <name>',
  'Add KPI <measure name> [to <page>]',
  'Add bar chart <measure name> by <field> [to <page>]',
  'Show <field>s with more than <N> <measure name> [to <page>]',
  'Remove <visual>',
  'Make <visual> full width | half width',
];

/** Translate a free-form design request into canonical edit commands, then apply them deterministically. */
export async function aiDesignEdit(spec: DashboardSpec, request: string, ctx: { u: DataUnderstanding; f: Foundation; activePageId?: string }) {
  const visuals = spec.pages.map((p) => `${p.name}: ${p.components.map((c) => `"${c.title}" (${c.type})`).join(', ')}`);
  const fields = ctx.u.profiles.flatMap((p) => p.columns.filter((c) => ['dimension', 'status', 'attribute'].includes(c.role)).map((c) => c.name));
  const j = await chatJSON<{ commands?: unknown }>(
    `You are the Dashboard Design Agent. Translate the user's request into a list of edit commands using ONLY these forms:\n${DESIGN_COMMANDS.join('\n')}\nUse exact visual titles, page names, measure names and field names from the context. Return {"commands": ["..."]}. Return an empty list if the request cannot be done with the available data.`,
    `Pages and visuals:\n${visuals.join('\n')}\nFilters: ${spec.filters.map((f) => f.label).join(', ')}\nMeasures: ${ctx.f.measures.map((m) => m.name).join(', ')}\nFields: ${[...new Set(fields)].join(', ')}\nCurrent page: ${spec.pages.find((p) => p.id === ctx.activePageId)?.name ?? spec.pages[0]?.name}\n\nRequest: ${request}`,
  );
  const commands = strs(j.commands, 8);
  let cur = spec;
  const replies: string[] = [];
  let changed = false;
  for (const c of commands) {
    const r = applyDesignCommand(cur, c, ctx);
    replies.push(r.reply);
    if (r.changed) {
      cur = r.spec;
      changed = true;
    }
  }
  return { spec: cur, changed, reply: commands.length ? replies.join(' ') : "I couldn't map that request to a change supported by the available data." };
}

export async function aiExecutiveSummary(facts: Record<string, unknown>): Promise<string> {
  const j = await chatJSON<{ summary?: string }>(
    'You are the Documentation Agent. Write a concise executive summary (120–180 words, plain prose, no headings) of this reporting project for business stakeholders, using only the facts given. Return {"summary": "..."}.',
    JSON.stringify(facts),
    { maxTokens: 800 },
  );
  if (!j.summary) throw new Error('No summary returned');
  return String(j.summary);
}



// ───────────────────────── Reporting foundation: KPI measures ─────────────────────────

interface MeasureJson {
  name?: string;
  description?: string;
  aggregation?: string;
  dataset?: string;
  field?: string;
  conditions?: { field?: string; op?: string; values?: unknown[] }[];
  numerator?: string;
  denominator?: string;
  format?: string;
  requirement?: string;
}

function dataContext(u: DataUnderstanding) {
  return u.profiles.map((p) => ({ dataset: p.datasetId, label: p.label, kind: p.kind, rows: p.rowCount, primaryKey: p.primaryKey, uniqueKeys: p.columns.find((c) => c.name === p.primaryKey)?.distinct, columns: p.columns.map((c) => ({ name: c.name, type: c.type, role: c.role, ...(c.distinct <= 15 && c.type !== 'date' ? { values: c.topValues.map((v) => v.value) } : {}) })) }));
}

const MEASURE_RULES = `Measures use: aggregation count | countDistinct | sum | avg | median | ratio. "dataset" is a dataset id, "field" a column of it.
"conditions" filter rows (all must hold): op eq | neq (values = exact column values from the data) | gt | gte | lt | lte (values = [number]) | notnull.
A ratio uses "numerator" and "denominator" = names of other measures (existing or in your list) and format "percent".
Count people/patients with countDistinct on their ID if the ID repeats. Durations use avg. Never invent columns or values.`;

/** Validate AI measure JSON against the data; returns measures or throws when nothing usable came back. */
export function materializeMeasures(items: MeasureJson[], u: DataUnderstanding, existing: MeasureDef[]): { measures: MeasureDef[]; rejected: string[] } {
  const out: MeasureDef[] = [];
  const rejected: string[] = [];
  const byName = (n?: string) => [...existing, ...out].find((m) => m.name.toLowerCase() === String(n ?? '').toLowerCase());
  const pending: MeasureJson[] = [];
  for (const it of items) {
    const name = String(it.name ?? '').trim();
    const agg = String(it.aggregation ?? '');
    if (!name || !['count', 'countDistinct', 'sum', 'avg', 'median', 'ratio'].includes(agg)) { rejected.push(`${name || '(unnamed)'}: unsupported aggregation`); continue; }
    if (byName(name)) continue;
    if (agg === 'ratio') { pending.push(it); continue; }
    const p = u.profiles.find((x) => x.datasetId === it.dataset || x.label.toLowerCase() === String(it.dataset ?? '').toLowerCase());
    if (!p) { rejected.push(`${name}: unknown dataset ${it.dataset}`); continue; }
    const col = (n?: string) => p.columns.find((c) => c.name.toLowerCase() === String(n ?? '').toLowerCase());
    const field = it.field ? col(it.field) : undefined;
    if (it.field && !field) { rejected.push(`${name}: unknown field ${it.field}`); continue; }
    if ((agg === 'sum' || agg === 'avg' || agg === 'median') && field?.role !== 'measure' && field?.type !== 'integer' && field?.type !== 'number') { rejected.push(`${name}: ${it.field} is not numeric`); continue; }
    const conds: MeasureCondition[] = [];
    let bad = '';
    for (const c of it.conditions ?? []) {
      const cc = col(c.field);
      const op = String(c.op) as MeasureCondition['op'];
      if (!cc || !['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'notnull'].includes(op)) { bad = `bad condition on ${c.field}`; break; }
      let values = (c.values ?? []).map(String);
      if (op === 'eq' || op === 'neq') {
        values = values.map((v) => cc.topValues.find((t) => t.value.toLowerCase() === v.toLowerCase())?.value ?? '').filter(Boolean);
        if (!values.length) { bad = `value not found in ${cc.name}`; break; }
      } else if (op !== 'notnull' && Number.isNaN(Number(values[0]))) { bad = `non-numeric threshold on ${cc.name}`; break; }
      conds.push({ field: cc.name, op, values });
    }
    if (bad) { rejected.push(`${name}: ${bad}`); continue; }
    out.push({ id: uid('m'), name, description: String(it.description ?? ''), kind: agg as MeasureDef['kind'], datasetId: p.datasetId, field: field?.name ?? (agg.startsWith('count') ? p.primaryKey : undefined), condition: conds[0], conditions: conds.slice(1), format: (['number', 'percent', 'decimal'].includes(String(it.format)) ? it.format : agg === 'avg' || agg === 'median' ? 'decimal' : 'number') as MeasureDef['format'], logic: '', assumptions: ['Proposed by the AI model and validated against the data — review before approval.'], requirementRef: it.requirement ? String(it.requirement) : undefined });
  }
  for (const it of pending) {
    const n = byName(it.numerator);
    const d = byName(it.denominator);
    if (!n || !d) { rejected.push(`${it.name}: numerator/denominator not found`); continue; }
    out.push({ id: uid('m'), name: String(it.name), description: String(it.description ?? ''), kind: 'ratio', numeratorId: n.id, denominatorId: d.id, format: it.format === 'decimal' ? 'decimal' : 'percent', logic: '', assumptions: ['Proposed by the AI model and validated against the data — review before approval.'], requirementRef: it.requirement ? String(it.requirement) : undefined });
  }
  return { measures: out, rejected };
}

export async function aiProposeMeasures(spec: RequirementSpec | null, u: DataUnderstanding, existing: MeasureDef[]) {
  const j = await chatJSON<{ measures?: MeasureJson[] }>(
    `You are the Reporting Foundation Agent. Define the KPI measures needed for the requirements, grounded only in the datasets given.\n${MEASURE_RULES}\nReturn {"measures":[{"name","description","aggregation","dataset","field","conditions","numerator","denominator","format","requirement"}]} — one entry per requirement KPI (plus any numerator/denominator a ratio needs). Use the requirement's wording for "name" and copy the KPI text into "requirement".`,
    `Requirement KPIs: ${JSON.stringify(spec?.kpis.map((k) => k.text) ?? [])}\nBusiness rules: ${JSON.stringify(spec?.rules.map((k) => k.text) ?? [])}\nExisting measures (already defined, several from the ProcDNA KPI Catalogue — do not redefine them): ${JSON.stringify(existing.map((m) => (m.catalogueRef ? `${m.name} [catalogue: ${m.catalogueRef}]` : m.name)))}\nDatasets: ${JSON.stringify(dataContext(u))}`,
    { maxTokens: 3500 },
  );
  const res = materializeMeasures(j.measures ?? [], u, existing);
  if (!res.measures.length) throw new Error(`AI proposed no usable measures${res.rejected.length ? ` (${res.rejected.slice(0, 3).join('; ')})` : ''}`);
  return res;
}

/** One KPI from a natural-language description (live change requests). */
export async function aiDefineMeasure(text: string, u: DataUnderstanding, existing: MeasureDef[]) {
  const j = await chatJSON<{ measures?: MeasureJson[] }>(
    `You are the Reporting Foundation Agent. Define the single KPI the user describes (plus a numerator/denominator only if it is a ratio).\n${MEASURE_RULES}\nReturn {"measures":[...]} with the requested KPI LAST.`,
    `KPI request: ${text}\nExisting measures: ${JSON.stringify(existing.map((m) => m.name))}\nDatasets: ${JSON.stringify(dataContext(u))}`,
  );
  const res = materializeMeasures(j.measures ?? [], u, existing);
  if (!res.measures.length) throw new Error(res.rejected[0] ?? 'AI returned no measure');
  const main = res.measures[res.measures.length - 1];
  main.requirementRef = main.requirementRef ?? text;
  return { main, extra: res.measures.slice(0, -1) };
}

// ───────────────────────── Dashboard design ─────────────────────────
interface CompJson { type?: string; title?: string; measures?: string[]; dimension?: string; series?: string; width?: number; topN?: number; threshold?: number; description?: string }

export async function aiGenerateDesign(u0: DataUnderstanding, f: Foundation, spec: RequirementSpec | null, fallback: DashboardSpec): Promise<DashboardSpec> {
  const u = { ...u0, profiles: visibleProfiles(u0.profiles, f) };
  const fields = u.profiles.flatMap((p) => p.columns.filter((c) => ['dimension', 'status', 'attribute'].includes(c.role)).map((c) => ({ column: c.name, label: fieldLabel(f, fref(p.datasetId, c.name)), dataset: p.label })));
  // pages from the ProcDNA FRM report template are laid out deterministically; the model designs the rest
  const templated = fallback.pages.filter((p) => p.template);
  const templateNote = templated.length ? `\nThese pages are already built from the ProcDNA FRM report template — do NOT repeat them or their content; design 1–2 additional pages only (e.g. the patient access funnel and barriers): ${templated.map((p) => `"${p.name}" (${p.components.map((c) => c.title).join(', ')})`).join('; ')}.` : '';
  const j = await chatJSON<{ pages?: { name?: string; description?: string; sections?: { name?: string; components?: CompJson[] }[] }[]; filters?: string[] }>(
    `You are the Dashboard Design Agent. Design a Power BI-style dashboard for the requirements using ONLY the measures and fields listed.${templateNote}
Component types: kpi (one measure), funnel (2–6 count measures in stage order), bar, hbar (needs dimension; use topN 10 for long lists), donut (≤6 categories), line (time trend, 1–3 measures), table (dimension + measures; "threshold" keeps rows whose first measure is greater than it), stacked (dimension + series).
Width is out of 12. Group components into named sections in reading order (headline first, then drivers, then action lists). Prefer one or two focused pages over many; at most 6 KPI cards per page and at most 6 filters.
Return {"pages":[{"name","description","sections":[{"name","components":[{"type","title","measures":[measure names],"dimension":"column","series":"column","width","topN","threshold","description"}]}]}],"filters":["column", ...]}`,
    `Requirements: ${JSON.stringify({ objectives: spec?.objectives.map((x) => x.text), stories: spec?.stories?.map((x) => x.text), kpis: spec?.kpis.map((x) => x.text), filters: spec?.filters.map((x) => x.text), pages: spec?.pages.map((x) => x.text) })}\nMeasures: ${JSON.stringify(f.measures.map((m) => ({ name: m.name, logic: m.logic })))}\nFields: ${JSON.stringify(fields)}`,
    { maxTokens: 4000 },
  );
  const mByName = (n: string) => f.measures.find((m) => m.name.toLowerCase() === n.toLowerCase());
  const dsOf = (m: MeasureDef): string | undefined => m.datasetId ?? (m.numeratorId ? dsOf(f.measures.find((x) => x.id === m.numeratorId)!) : undefined);
  const fieldRef = (name: string | undefined, fromDs?: string) => {
    if (!name) return undefined;
    const cands = u.profiles.flatMap((p) => p.columns.filter((c) => c.name.toLowerCase() === name.toLowerCase() || fieldLabel(f, fref(p.datasetId, c.name)).toLowerCase() === name.toLowerCase()).map((c) => fref(p.datasetId, c.name)));
    return cands.find((r) => !fromDs || reachable(u.relationships, fromDs, r.split('::')[0])) ;
  };
  const TYPES: ComponentType[] = ['kpi', 'funnel', 'bar', 'hbar', 'donut', 'line', 'area', 'table', 'stacked'];
  const pages: DashPage[] = [];
  let valid = 0;
  for (const pg of j.pages ?? []) {
    const comps: DashComponent[] = [];
    for (const sec of pg.sections ?? []) {
      for (const c of sec.components ?? []) {
        const type = String(c.type) as ComponentType;
        const ms = (c.measures ?? []).map((n) => mByName(String(n))).filter((m): m is MeasureDef => !!m);
        if (!TYPES.includes(type) || !ms.length) continue;
        const ds = dsOf(ms[0]);
        const dim = fieldRef(c.dimension, ds);
        if (['bar', 'hbar', 'donut', 'table', 'stacked'].includes(type) && !dim) continue;
        const series = type === 'stacked' ? fieldRef(c.series, ds) : undefined;
        if (type === 'stacked' && !series) continue;
        const width = ([3, 4, 6, 8, 12].includes(Number(c.width)) ? Number(c.width) : type === 'kpi' ? 3 : type === 'table' || type === 'funnel' || type === 'line' ? 12 : 6) as DashComponent['width'];
        comps.push({ id: uid('cmp'), type, title: String(c.title ?? ms[0].name), description: String(c.description ?? ''), measureIds: type === 'kpi' || ['bar', 'hbar', 'donut', 'stacked', 'table'].includes(type) && type !== 'table' ? [ms[0].id] : ms.map((m) => m.id), dimension: dim, series, timeGrain: type === 'line' || type === 'area' ? fallback.timeGrain : undefined, comparison: type === 'kpi' ? true : undefined, width, topN: c.topN ? Number(c.topN) : undefined, threshold: c.threshold != null && !Number.isNaN(Number(c.threshold)) ? { op: 'gt', value: Number(c.threshold) } : undefined, section: sec.name ? String(sec.name) : undefined, tableColumns: type === 'table' ? [] : undefined });
        valid++;
      }
    }
    const name = String(pg.name ?? `Page ${pages.length + 1}`);
    if (comps.length && !templated.some((t) => t.name.toLowerCase() === name.toLowerCase())) pages.push({ id: uid('pg'), name, description: String(pg.description ?? ''), components: comps });
  }
  if (valid < (templated.length ? 2 : 4)) throw new Error(`AI design had only ${valid} component(s) that match the model`);
  pages.unshift(...templated);
  const filters: FilterDef[] = [{ id: uid('flt'), label: 'Reporting Period', type: 'period' }, ...(templated.length ? fallback.filters.filter((x) => x.type === 'multi') : [])];
  for (const name of (j.filters ?? []).slice(0, 6)) {
    const r = fieldRef(String(name));
    if (r && filters.length < (templated.length ? 9 : 7) && !filters.some((x) => x.field === r)) filters.push({ id: uid('flt'), label: fieldLabel(f, r), type: 'multi', field: r });
  }
  for (const x of fallback.filters) if (x.type === 'multi' && !filters.some((y) => y.field === x.field) && filters.length < 3) filters.push(x);
  return { ...fallback, pages, filters };
}
