import type { DashboardSpec, DataUnderstanding, Foundation, MeasureCondition, MeasureDef } from '@/types';
import { KPI_CATALOGUE } from '@/config/kpiCatalogue';
import { conditionsOf } from '@/lib/conditions';
import { fieldLabel } from '@/lib/fieldLabels';
import { displayName } from '@/lib/catalogue';
import { dataVocabulary, missingRequirements, unobtainableReason } from '@/lib/obtainable';

/**
 * KPI explainer of the Design assistant: answers what a KPI means and how it is calculated, from the project's own
 * KPI definitions, the ProcDNA KPI catalogue and the design. Answers are built by code from those facts, so they
 * describe exactly what this dashboard computes. It never computes values and never changes the design.
 *
 * `classifyDesignMessage` decides whether a Design assistant message is a design edit (handled as before),
 * a question about the KPIs (answered here) or unclear (the user picks).
 */

export interface KpiContext {
  u: DataUnderstanding;
  f: Foundation;
  spec: DashboardSpec;
  /** page the user is looking at (the KPI list and examples come from it) */
  activePageId?: string;
}

// ───────────────────────────── edit or question ─────────────────────────────

export type DesignIntent = 'edit' | 'question' | 'unclear';

/** Polite openings in front of the actual request ("Can you add …", "Please rename …"). */
const POLITE = /^(?:(?:please|kindly|ok(?:ay)?|hi|hey)[,\s]+|(?:can|could|would|will|shall)\s+(?:you|we|i)\s+(?:please\s+)?|i(?:'d| would)?\s+(?:like|want)\s+(?:you\s+)?to\s+|let'?s\s+)+/i;
const EDIT_VERB = /^(add|remove|delete|drop|move|rename|replace|swap|change|convert|switch|make|put|insert|create|set|turn|resize|widen|split|sort|undo)\b/i;
const LIST_VERB = /^(show|list|highlight|identify|flag)\b/i;
/** Words that ask what a KPI is or how it is built. */
const ASKS_DEFINITION = /\b(mean|means|meaning|meant|defin\w*|formula\w*|calculat\w*|comput\w*|logic|dax|includ\w*|exclud\w*|counts? as|counted|based on|derived|which (?:columns?|fields?|dates?|data|tables?)|what data|difference|differ\w*|explain\w*|stand for|stands for|made of|built)\b/i;
const QUESTION_START = /^(what|what's|whats|how|why|which|who|where|when|is|are|does|do|did|explain|define|describe|tell me|meaning)\b/i;
/** Words of the design commands: a message with them and no question is an edit. */
const EDIT_WORDS = /\b(full|half)[- ]width\b|\b(comparison|filters?|slicers?|page|chart|card|table|visual|section|widget|tab|title|layout)\b/i;
const KPI_WORDS = /\b(kpis?|measures?|metrics?)\b/i;
/** Questions about values ("How many …", "Which region has the lowest …"): not answered here yet. */
const ASKS_VALUE = /\b(how many|how much|value of|current value|this (?:month|week|quarter|year)|last (?:month|week|quarter|year)|highest|lowest|top \d+|bottom \d+|trend(?:ing)?|went up|went down|increase[ds]?|decrease[ds]?|right now|today)\b|^which (?:regions?|territor(?:y|ies)|payers?|products?|hcps?|prescribers?|accounts?|plans?|frms?|markets?) (?:has|have|is|are)\b/i;

const body = (text: string) => text.trim().replace(POLITE, '').trim();

/** Edit, question or unclear. Rules only; an unclear message gets two buttons in the chat. */
export function classifyDesignMessage(text: string, ctx?: KpiContext): DesignIntent {
  const t = body(text);
  if (!t) return 'edit';
  if (EDIT_VERB.test(t)) return 'edit';
  if (LIST_VERB.test(t)) {
    // "Show me how … is calculated", "List the KPIs on this page" are questions; "Show HCPs with more than 5 …" is an edit
    if (ASKS_DEFINITION.test(t) || (KPI_WORDS.test(t) && !/\b(with|where|having|that have)\b/i.test(t)) || /^show me\b/i.test(t)) return 'question';
    return 'edit';
  }
  // "How about adding a payer filter?"
  if (/\b(add|remove|move|rename|replace)\w*\b.*\b(filters?|slicers?|charts?|pages?|cards?|tables?|kpis?)\b/i.test(t) && !ASKS_DEFINITION.test(t)) return 'edit';
  if (QUESTION_START.test(t) || /\?\s*$/.test(t) || ASKS_DEFINITION.test(t)) return 'question';
  if (ctx && !EDIT_WORDS.test(t) && findKpis(t, ctx).length) return 'unclear';
  return 'edit';
}

// ───────────────────────────── which KPI ─────────────────────────────

const STOP = new Set(
  'the a an of in on for to by per is are was were be what whats how does do did which who why when where explain define defined definition describe tell me us about please this that it its these those kpi kpis measure measures metric metrics mean means meaning meant calculated calculate calculation computed compute formula logic dashboard page card chart visual show give list value values and or with from as at its into vs versus between difference differ include includes included including exclude excludes count counted counts there their does'.split(
    ' ',
  ),
);
/** Words a question may leave out ("closure rate" for Case Closure Rate, "resolution time" for both its average and median). */
const SOFT = new Set('average avg median total case cases number frm patient patients days day'.split(' '));
const UNIT = /\s*\((?:%|days|count|hrs|mins|usd|#)\)\s*/gi;

const tokens = (s: string) =>
  s
    .replace(UNIT, ' ')
    .replace(/%/g, ' percent ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !STOP.has(t));
const same = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 5)) || b.startsWith(a.slice(0, 5))));
const has = (q: string[], t: string) => q.some((x) => same(x, t));

interface Candidate {
  m: MeasureDef;
  words: string[];
  /** words that must also be in the question (the card a label sits in) */
  context?: string[];
  /** chart titles: at least one of these (the KPI's own name) must be in the question ("Patients by Payer" is not "payer") */
  anchor?: string[];
  weight: number;
}

function candidates(ctx: KpiContext): Candidate[] {
  const out: Candidate[] = [];
  const byId = new Map(ctx.f.measures.map((m) => [m.id, m]));
  const anchors = new Map<string, string[]>();
  for (const m of ctx.f.measures) {
    const names = new Set([m.name, m.catalogueRef && displayName(m.catalogueRef), m.requirementRef].filter((x): x is string => !!x));
    for (const c of ctx.f.catalogue ?? []) if (c.measureId === m.id) names.add(displayName(c.metric));
    for (const n of names) out.push({ m, words: tokens(n), weight: 2 });
    anchors.set(m.id, [...new Set([...names].flatMap(tokens))]);
  }
  for (const c of ctx.spec.pages.flatMap((p) => p.components)) {
    if (c.measureIds.length === 1 && byId.has(c.measureIds[0])) out.push({ m: byId.get(c.measureIds[0])!, words: tokens(c.title), anchor: anchors.get(c.measureIds[0]), weight: 0 });
    c.labels?.forEach((label, i) => {
      const m = byId.get(c.measureIds[i]);
      if (m) out.push({ m, words: tokens(label), context: tokens(c.title), weight: 1 });
    });
  }
  return out.filter((c) => c.words.length);
}

function score(q: string[], qText: string, c: Candidate): number {
  const req = c.words.filter((w) => !SOFT.has(w));
  const soft = c.words.filter((w) => SOFT.has(w));
  if (req.length ? !req.every((w) => has(q, w)) : !soft.every((w) => has(q, w))) return 0;
  if (c.context && !c.context.every((w) => has(q, w))) return 0;
  if (c.anchor && !c.anchor.some((w) => has(q, w))) return 0;
  const phrase = c.words.join(' ');
  return req.length * 10 + soft.filter((w) => has(q, w)).length * 3 + (qText.includes(phrase) ? 4 : 0) + c.weight;
}

/**
 * KPIs the text is about, best match first: several when the wording fits more than one equally ("resolution time"),
 * and with `alsoClose` also KPIs named nearly as well ("difference between average and median resolution time").
 */
export function findKpis(text: string, ctx: KpiContext, opts: { max?: number; alsoClose?: boolean } = {}): MeasureDef[] {
  const max = opts.max ?? 3;
  const q = tokens(text);
  if (!q.length) return [];
  const qText = q.join(' ');
  const best = new Map<string, { m: MeasureDef; s: number }>();
  for (const c of candidates(ctx)) {
    const s = score(q, qText, c);
    if (s > (best.get(c.m.id)?.s ?? 0)) best.set(c.m.id, { m: c.m, s });
  }
  const ranked = [...best.values()].sort((a, b) => b.s - a.s);
  if (!ranked.length) return [];
  // the top score, plus any KPI the question names as well ("difference between X and Y")
  const top = ranked[0].s;
  return ranked.filter((r) => r.s === top || (opts.alsoClose && r.s >= 20 && r.s >= top - 6)).slice(0, max).map((r) => r.m);
}

// ───────────────────────────── explaining one KPI ─────────────────────────────

const profileOf = (ctx: KpiContext, m: MeasureDef) => ctx.u.profiles.find((p) => p.datasetId === m.datasetId);
const label = (ctx: KpiContext, ds: string, col: string) => fieldLabel(ctx.f, `${ds}::${col}`);
const quoted = (vs: string[]) => vs.map((v) => `"${v}"`).join(' or ');
const sentence = (s: string) => (s && !/[.!?]$/.test(s.trim()) ? `${s.trim()}.` : s.trim());

function conditionText(ctx: KpiContext, ds: string, c: MeasureCondition): string {
  const l = label(ctx, ds, c.field);
  switch (c.op) {
    case 'eq':
      return `${l} is ${quoted(c.values)}`;
    case 'neq':
      return `${l} is not ${quoted(c.values)}`;
    case 'notnull':
      return `${l} has a value`;
    default:
      return `${l} is ${{ gt: 'more than', gte: 'at least', lt: 'less than', lte: 'at most' }[c.op]} ${c.values[0]}`;
  }
}

/** The calculation in words ("Number of case records in Case Activity where Case Status is "Closed""). */
function formula(ctx: KpiContext, m: MeasureDef): string {
  const byId = (id?: string) => ctx.f.measures.find((x) => x.id === id);
  if (m.kind === 'ratio') {
    const n = byId(m.numeratorId);
    const d = byId(m.denominatorId);
    return `${n?.name ?? 'numerator'} ÷ ${d?.name ?? 'denominator'}${m.format === 'percent' ? ', shown as a percentage' : ''}`;
  }
  const p = profileOf(ctx, m);
  if (!p) return m.logic || m.description;
  const entity = (p.entity || 'record').toLowerCase();
  const f = m.field ? label(ctx, p.datasetId, m.field) : '';
  const base =
    m.kind === 'count'
      ? !m.field || m.field === p.primaryKey
        ? `Number of ${entity} records in ${p.label}`
        : `Number of ${p.label} records that have a ${f}`
      : m.kind === 'countDistinct'
        ? `Number of different ${f} values in ${p.label}`
        : m.kind === 'sum'
          ? `Sum of ${f} over the ${p.label} records`
          : m.kind === 'avg'
            ? `Average of ${f} over the ${p.label} records (records without a value are left out)`
            : `Median of ${f} over the ${p.label} records (the middle value, so a few very long or short ones don't pull it; records without a value are left out)`;
  const conds = conditionsOf(m).map((c) => conditionText(ctx, p.datasetId, c));
  return conds.length ? `${base}, where ${conds.join(' and ')}` : base;
}

/** How the Time Period filter applies (each activity table follows its own date; master data is not filtered). */
function periodText(ctx: KpiContext, m: MeasureDef, depth = 0): string {
  if (m.kind === 'ratio') {
    if (depth > 3) return '';
    const parts = [m.numeratorId, m.denominatorId].map((id) => ctx.f.measures.find((x) => x.id === id)).filter((x): x is MeasureDef => !!x);
    const texts = [...new Set(parts.map((x) => periodText(ctx, x, depth + 1)).filter(Boolean))];
    return texts.length === 1 ? texts[0] : texts.join(' ');
  }
  const p = profileOf(ctx, m);
  if (!p) return '';
  if (p.kind === 'activity' && p.dateField) return `The Time Period filter selects ${p.label} records by ${label(ctx, p.datasetId, p.dateField)}.`;
  return 'Not affected by the Time Period filter (master data).';
}

/** Tables and columns a KPI reads ("Case Activity: Case ID, Case Status, Case Open Date"), merged across ratio parts. */
function dataUsed(ctx: KpiContext, m: MeasureDef): string[] {
  const used = new Map<string, Set<string>>();
  const walk = (x: MeasureDef, depth: number) => {
    if (x.kind === 'ratio') {
      if (depth < 4) for (const id of [x.numeratorId, x.denominatorId]) {
        const part = ctx.f.measures.find((k) => k.id === id);
        if (part) walk(part, depth + 1);
      }
      return;
    }
    const p = profileOf(ctx, x);
    if (!p) return;
    const cols = used.get(p.label) ?? new Set<string>();
    for (const c of [x.field, ...conditionsOf(x).map((k) => k.field), p.kind === 'activity' ? p.dateField : undefined]) if (c) cols.add(label(ctx, p.datasetId, c));
    used.set(p.label, cols);
  };
  walk(m, 0);
  return [...used].map(([t, cols]) => `${t}: ${[...cols].join(', ')}`);
}

/** The KPI's description with raw column names in their reporting names ("Days_to_Resolution" → "Days to Resolution"). */
function meaningOf(ctx: KpiContext, m: MeasureDef): string {
  const p = profileOf(ctx, m);
  let d = m.description;
  if (p) for (const c of p.columns) if (c.name.includes('_')) d = d.split(c.name).join(label(ctx, p.datasetId, c.name));
  return sentence(d);
}

/** Where the KPI shows on the dashboard ('"Open" in Cases', 'Open Case Aging'), per page. */
function placements(ctx: KpiContext, m: MeasureDef): string[] {
  return ctx.spec.pages
    .map((pg) => {
      const at = pg.components
        .map((c) => {
          const i = c.measureIds.indexOf(m.id);
          if (i < 0) return null;
          return c.labels?.[i] && c.labels[i] !== c.title ? `"${c.labels[i]}" in ${c.title}` : c.title;
        })
        .filter((x): x is string => !!x);
      return at.length ? `${pg.name}: ${[...new Set(at)].join(', ')}` : null;
    })
    .filter((x): x is string => !!x);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** What this dashboard does differently from the catalogue's reference formula. */
function catalogueDifferences(ctx: KpiContext, m: MeasureDef, computation: string): string[] {
  const out: string[] = [];
  const p = profileOf(ctx, m);
  if (!p) return out;
  // status lists: case_status IN ('Open','Pending') against the values this data has
  const re = /([a-z_]+)\s*(?:=|\bIN\b)\s*\(?\s*((?:'[^']*'\s*,?\s*)+)\)?/gi;
  for (const [, field, list] of computation.matchAll(re)) {
    const cat = [...list.matchAll(/'([^']*)'/g)].map((x) => x[1]);
    const ours = conditionsOf(m).find((c) => c.op === 'eq' && norm(c.field) === norm(field));
    if (!ours) continue;
    const col = p.columns.find((c) => c.name === ours.field);
    const l = label(ctx, p.datasetId, ours.field);
    const lower = ours.values.map((v) => v.toLowerCase());
    for (const v of cat.filter((x) => !lower.includes(x.toLowerCase()))) {
      const inData = col?.topValues.some((t) => t.value.toLowerCase() === v.toLowerCase());
      out.push(inData ? `${l} "${v}" is not counted here.` : `The data has no ${l} "${v}", so it can't be counted.`);
    }
    const catLower = cat.map((x) => x.toLowerCase());
    const extra = ours.values.filter((v) => !catLower.includes(v.toLowerCase()));
    if (extra.length) out.push(`${l} ${quoted(extra)} ${extra.length > 1 ? 'are' : 'is'} also counted here.`);
  }
  // which date the period follows
  if (p.kind === 'activity' && p.dateField) {
    const date = label(ctx, p.datasetId, p.dateField);
    if (/\bas of\b|period_end_date/i.test(computation)) out.push(`The catalogue counts it as of the end of the period; here records are selected by ${date} in the selected period, with their current status.`);
    else if (/close_?date\s+BETWEEN|closed in (?:the )?period/i.test(computation)) out.push(`The catalogue selects cases by when they were closed; here records are selected by ${date} in the selected period.`);
  }
  // a stored duration column instead of a date difference
  if (/DATEDIFF/i.test(computation) && m.field && (m.kind === 'avg' || m.kind === 'median')) out.push(`Here it uses the ${label(ctx, p.datasetId, m.field)} column of the data instead of computing the date difference.`);
  return out;
}

/** Assumptions already said elsewhere in the answer. */
const NOISE = /^(ProcDNA KPI Catalogue:|ProcDNA FRM report measure\.|Building block of a catalogue ratio\.|Blank values are excluded from the average\.)/;

/** The full explanation of one KPI. */
export function explainKpi(ctx: KpiContext, m: MeasureDef, opts: { dax?: Record<string, string>; askedFor?: string } = {}): string {
  const lines: string[] = [m.name];
  const where = placements(ctx, m);
  lines.push(where.length ? `Shown on ${where.join(' · ')}` : 'Not shown on the dashboard yet (defined in the Reporting Foundation).');
  lines.push('');
  if (m.description) lines.push(`Meaning: ${meaningOf(ctx, m)}`);
  lines.push(`How it's calculated: ${sentence(formula(ctx, m))}`);
  if (m.kind === 'ratio') {
    for (const id of [m.numeratorId, m.denominatorId]) {
      const part = ctx.f.measures.find((x) => x.id === id);
      if (part) lines.push(`  • ${part.name}: ${sentence(formula(ctx, part))}`);
    }
  }
  const period = periodText(ctx, m);
  if (period) lines.push(`Time period: ${period}`);
  const data = dataUsed(ctx, m);
  if (data.length) lines.push(`Data used: ${data.join(' · ')}`);
  const notes = m.assumptions.filter((a) => !NOISE.test(a));
  if (notes.length) lines.push(`Notes: ${notes.map(sentence).join(' ')}`);
  if (m.requirementRef && norm(m.requirementRef) !== norm(m.name) && norm(displayName(m.requirementRef)) !== norm(m.name)) lines.push(`Requested in the requirements as "${m.requirementRef}".`);
  const entry = m.catalogueRef ? KPI_CATALOGUE.find((c) => c.name === m.catalogueRef) : undefined;
  if (entry) {
    lines.push(`ProcDNA KPI Catalogue: ${sentence(entry.definition)} Reference formula: ${entry.computation}`);
    const diff = catalogueDifferences(ctx, m, entry.computation);
    if (diff.length) lines.push(`In this dashboard: ${diff.join(' ')}`);
  }
  // the catalogue metric the user named, when it is answered by this KPI under another name
  const alias = (ctx.f.catalogue ?? []).find((c) => c.status === 'same_as' && c.measureId === m.id && opts.askedFor && findCatalogueMention(opts.askedFor, [c.metric]));
  if (alias) lines.push(`"${displayName(alias.metric)}" in the ProcDNA catalogue is answered by this KPI: ${sentence(alias.note)}`);
  if (opts.dax) lines.push(opts.dax[m.id] ? `Power BI (DAX): ${opts.dax[m.id]}` : 'Power BI (DAX): not available for this KPI.');
  return lines.join('\n');
}

/** Short version for lists and comparisons. */
const brief = (ctx: KpiContext, m: MeasureDef) => [m.name, ...(m.description ? [`Meaning: ${meaningOf(ctx, m)}`] : []), `How it's calculated: ${sentence(formula(ctx, m))}`].join('\n');

// ───────────────────────────── answering a question ─────────────────────────────

export type KpiAnswerKind = 'definition' | 'several' | 'difference' | 'list' | 'missing' | 'value' | 'unknown';

export interface KpiAnswer {
  kind: KpiAnswerKind;
  reply: string;
  /** KPIs the answer is about */
  kpis: MeasureDef[];
  /** a direct yes / no answer was found from the definition (no AI sentence needed) */
  direct?: boolean;
}

export const wantsDax = (text: string) => /\bdax\b|power ?bi (?:formula|measure|expression|code)/i.test(text);
const asksDifference = (text: string) => /\b(difference|differ\w*|vs\.?|versus|compare[ds]?|comparison)\b/i.test(text);
const asksList = (text: string) => KPI_WORDS.test(text) && /\b(which|what|list|all|show)\b/i.test(text) && /\b(are|on|in|this|page|dashboard|have|there|all|list|show)\b/i.test(text);

function mentions(text: string, phrase: string) {
  const q = tokens(text);
  const w = tokens(phrase).filter((x) => !SOFT.has(x));
  return w.length > 0 && w.every((x) => has(q, x));
}
function findCatalogueMention(text: string, names: string[]) {
  return names.find((n) => mentions(text, displayName(n)));
}

/** KPIs shown on a page (or the whole dashboard), in order. */
function shownKpis(ctx: KpiContext, wholeDashboard: boolean): MeasureDef[] {
  const pages = wholeDashboard ? ctx.spec.pages : ctx.spec.pages.filter((p) => p.id === (ctx.activePageId ?? ctx.spec.pages[0]?.id));
  const ids = [...new Set(pages.flatMap((p) => p.components.flatMap((c) => c.measureIds)))];
  return ids.map((id) => ctx.f.measures.find((m) => m.id === id)).filter((m): m is MeasureDef => !!m);
}

const examples = (ctx: KpiContext) => {
  const first = shownKpis(ctx, false)[0] ?? shownKpis(ctx, true)[0] ?? ctx.f.measures[0];
  return first ? ` For example: "How is ${first.name} calculated?"` : '';
};

/** "Does the open backlog include escalated cases?" → yes / no from the KPI's conditions. */
function inclusionAnswer(ctx: KpiContext, m: MeasureDef, text: string): string | null {
  const at = /\b(includ\w*|exclud\w*|counts? as|counted|part of|consider\w*)\b/i.exec(text);
  if (!at) return null;
  const p = profileOf(ctx, m);
  if (!p) return null;
  // the value asked about comes after "include" ("Does the open backlog include escalated cases?" → "escalated")
  const q = text.slice(at.index + at[0].length).toLowerCase();
  for (const c of conditionsOf(m)) {
    const col = p.columns.find((x) => x.name === c.field);
    const asked = col?.topValues.map((t) => t.value).find((v) => new RegExp(`\\b${v.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(q));
    if (!asked) continue;
    const l = label(ctx, p.datasetId, c.field);
    const inList = c.values.some((v) => v.toLowerCase() === asked.toLowerCase());
    const counted = c.op === 'eq' ? inList : c.op === 'neq' ? !inList : null;
    if (counted == null) continue;
    return counted ? `Yes: records with ${l} "${asked}" are counted in ${m.name}.` : `No: ${m.name} only counts records where ${conditionText(ctx, p.datasetId, c)}.`;
  }
  return null;
}

/** Cleans a question down to the thing asked about ("What is average patient age?" → "average patient age"). */
const subjectOf = (text: string) =>
  body(text)
    .replace(/\?+\s*$/, '')
    .replace(/^(?:what|how|why|which|who|is|are|does|do|did|explain|define|describe|tell me about)\b(?:\s+(?:is|are|does|do|isn'?t|aren'?t|the|a|an|we|you|our|my)\b)*\s*/i, '')
    .replace(/\b(?:mean|means|calculated|computed|defined|shown|there|on (?:the|this) (?:dashboard|page))\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Answers a question about the dashboard's KPIs. `kpis` overrides the KPI lookup (e.g. picked by the AI);
 * `dax` maps measure ids to their Power BI DAX ("Name = expression"), included when the question asks for it.
 */
export function explainKpiQuestion(text: string, ctx: KpiContext, opts: { kpis?: MeasureDef[]; dax?: Record<string, string> } = {}): KpiAnswer {
  const definitional = ASKS_DEFINITION.test(text);
  // values are on the dashboard; the assistant explains meaning and logic only
  if (ASKS_VALUE.test(text) && !definitional) {
    const kpis = opts.kpis ?? findKpis(text, ctx);
    const about = kpis[0] ? ` For example: "How is ${kpis[0].name} calculated?"` : examples(ctx);
    return {
      kind: 'value',
      kpis,
      reply: `I can explain what a KPI means and how it's calculated, but I don't look up its values: those are on the dashboard (Development and the full-screen preview), where the filters apply.${about}`,
    };
  }
  const kpis = opts.kpis ?? findKpis(text, ctx, { alsoClose: asksDifference(text) || /\band\b/i.test(text) });
  if (!kpis.length && asksList(text)) {
    const whole = /\b(dashboard|all|every|whole)\b/i.test(text);
    const list = shownKpis(ctx, whole);
    const page = ctx.spec.pages.find((p) => p.id === (ctx.activePageId ?? ctx.spec.pages[0]?.id));
    if (!list.length) return { kind: 'list', kpis: [], reply: `No KPIs are shown on ${whole ? 'the dashboard' : `"${page?.name}"`} yet.` };
    return {
      kind: 'list',
      kpis: list,
      reply: [`KPIs on ${whole ? 'the dashboard' : `"${page?.name}"`}:`, ...list.map((m) => `• ${m.name}${m.description ? `: ${sentence(m.description)}` : ''}`), '', 'Ask about any of them, e.g. "How is it calculated?" with its name.'].join('\n'),
    };
  }
  const dax = wantsDax(text) ? opts.dax ?? {} : undefined;
  if (kpis.length === 1) {
    const lead = inclusionAnswer(ctx, kpis[0], text);
    const reply = explainKpi(ctx, kpis[0], { dax, askedFor: text });
    return { kind: 'definition', kpis, reply: lead ? `${lead}\n\n${reply}` : reply, direct: !!lead };
  }
  if (kpis.length > 1) {
    if (asksDifference(text) || /\band\b/i.test(text)) {
      const [a, b] = kpis;
      const diff: string[] = [];
      if (a.kind !== b.kind && ['avg', 'median'].includes(a.kind) && ['avg', 'median'].includes(b.kind) && a.field === b.field)
        diff.push(`Both use ${label(ctx, a.datasetId!, a.field!)}. The average adds every value and divides by how many there are, so a few very long cases pull it up; the median is the middle value, so it shows a typical case.`);
      else if (a.kind === 'ratio' || b.kind === 'ratio') diff.push(`${a.kind === 'ratio' ? a.name : b.name} is a share (one count divided by another); ${a.kind === 'ratio' ? b.name : a.name} is ${['avg', 'median'].includes((a.kind === 'ratio' ? b : a).kind) ? 'an average or median' : 'a count'}.`);
      return { kind: 'difference', kpis, reply: [...kpis.map((m) => brief(ctx, m)), ...(diff.length ? [`Main difference: ${diff.join(' ')}`] : [])].join('\n\n') };
    }
    return { kind: 'several', kpis, reply: ['More than one KPI matches that:', '', ...kpis.map((m) => brief(ctx, m)).join('\n\n').split('\n'), '', 'Ask about one by its full name for all the details.'].join('\n') };
  }
  // asked for in the requirements but not in the data
  const missing = missingRequirements(ctx.u.mappings).find((r) => mentions(text, r.requirement));
  if (missing) return { kind: 'missing', kpis: [], reply: `"${missing.requirement}" isn't on this dashboard: the uploaded data can't support it. ${sentence(missing.note)}` };
  // a catalogue metric this data can't calculate
  const needs = (ctx.f.catalogue ?? []).filter((c) => c.status === 'needs_data');
  const cat = findCatalogueMention(text, needs.map((c) => c.metric));
  if (cat) {
    const c = needs.find((x) => x.metric === cat)!;
    const entry = KPI_CATALOGUE.find((x) => x.name === cat);
    return { kind: 'missing', kpis: [], reply: `"${displayName(cat)}" is a ProcDNA KPI Catalogue metric${entry ? ` (${sentence(entry.definition).replace(/\.$/, '')})` : ''}, but this data can't calculate it. ${sentence(c.note)}` };
  }
  // not a KPI of this dashboard; say whether the data could have it at all
  const subject = subjectOf(text);
  const why = subject ? unobtainableReason(subject, dataVocabulary(ctx.u.profiles)) : null;
  const list = shownKpis(ctx, false).slice(0, 8).map((m) => m.name);
  return {
    kind: why ? 'missing' : 'unknown',
    kpis: [],
    reply: `${why ? `That isn't a KPI of this dashboard, and the uploaded data can't provide it: ${why}` : `I couldn't find a KPI matching "${subject || text.trim()}".`}${list.length ? ` KPIs on this page: ${list.join(', ')}.` : ''}${examples(ctx)}`,
  };
}
