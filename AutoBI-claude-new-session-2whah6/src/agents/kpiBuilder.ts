import type { DataUnderstanding, DatasetProfile, MeasureCondition, MeasureDef } from '@/types';
import { findEntityDataset, tokens } from '@/lib/semantic';
import { humanize, uid } from '@/lib/util';

/**
 * Turns a business KPI phrase ("Patients awaiting PA", "PA approval rate",
 * "Average time to therapy initiation", "Patients in PA for more than 14 days")
 * into a measure grounded in actual columns and values of the data.
 * Returns the new measures (a rate also returns its numerator / denominator).
 */

// business words → words that appear in data values
const VALUE_SYNONYMS: Record<string, string[]> = {
  awaiting: ['pending'], waiting: ['pending'], pending: ['pending'], outstanding: ['pending', 'open'],
  approved: ['approved'], approval: ['approved'], approve: ['approved'],
  denied: ['denied'], denial: ['denied'], rejected: ['denied'],
  initiating: ['initiated'], initiation: ['initiated'], initiated: ['initiated'], started: ['initiated'], start: ['initiated'], starting: ['initiated'],
  drop: ['discontinued'], dropped: ['discontinued'], dropping: ['discontinued'], dropoff: ['discontinued'], lost: ['discontinued'], 'drop-off': ['discontinued'], discontinued: ['discontinued'], discontinuation: ['discontinued'], abandoned: ['discontinued'],
  unresolved: ['open'], open: ['open'], resolved: ['resolved'],
  appeal: ['appeal'], appealed: ['appeal'],
  delayed: ['delayed'], completed: ['completed'], shipped: ['shipped'],
};

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fourteen: 14, thirty: 30 };

function textTokens(text: string) {
  const base = tokens(text.replace(/drop-?offs?/gi, 'dropoff'));
  const out = new Set(base);
  for (const t of base) for (const s of VALUE_SYNONYMS[t] ?? []) out.add(s);
  if (/\bpa\b|prior auth/i.test(text)) out.add('pa');
  return out;
}

/** Column values whose words are all mentioned (directly or via synonyms) in the text. */
function valueConditions(p: DatasetProfile, want: Set<string>, preferStatus = false): MeasureCondition[] {
  const out: { c: MeasureCondition; score: number }[] = [];
  for (const col of p.columns) {
    if (!['dimension', 'status'].includes(col.role) || col.distinct > 15) continue;
    let best: { v: string; score: number } | null = null;
    for (const { value } of col.topValues) {
      const vt = tokens(value).filter((t) => !['the', 'of', 'and', 'a'].includes(t));
      if (!vt.length || !vt.every((t) => want.has(t))) continue;
      const score = vt.length;
      if (!best || score > best.score) best = { v: value, score };
    }
    if (best) out.push({ c: { field: col.name, op: 'eq', values: [best.v] }, score: best.score + (tokens(col.name).some((t) => want.has(t)) ? 0.5 : 0) + (preferStatus && col.role === 'status' ? 1 : 0) + (/stage|status/i.test(col.name) ? 0.25 : 0) });
  }
  // keep the strongest match per meaning: drop weaker matches whose words are covered by a stronger one
  out.sort((a, b) => b.score - a.score);
  const used = new Set<string>();
  const kept: MeasureCondition[] = [];
  for (const o of out) {
    const words = tokens(o.c.values[0]);
    if (words.some((w) => used.has(w))) continue; // same meaning already captured by a stronger match
    words.forEach((w) => used.add(w));
    kept.push(o.c);
  }
  return kept;
}

function numericCondition(text: string, p: DatasetProfile, want: Set<string>): MeasureCondition | null {
  const m = /(more than|over|greater than|longer than|at least|above|>=|>|less than|under|fewer than|below|<=|<)\s*(\d+|[a-z]+)\s*([a-z]+)?/i.exec(text);
  if (!m) return null;
  const n = /^\d+$/.test(m[2]) ? Number(m[2]) : NUMBER_WORDS[m[2].toLowerCase()];
  if (n == null) return null;
  const unit = (m[3] ?? '').toLowerCase();
  // pick the numeric column best matching the unit and text (e.g. "days" → Days_in_Current_Stage)
  const cols = p.columns.filter((c) => c.role === 'measure');
  const ranked = cols
    .map((c) => {
      const ct = tokens(c.name);
      return { c, s: (unit && ct.includes(tokens(unit)[0] ?? unit) ? 2 : 0) + ct.filter((t) => want.has(t)).length + (/current|stage|pending/i.test(c.name) && /pending|awaiting|delay|stuck|current/i.test(text) ? 1 : 0) };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  if (!ranked.length) return null;
  const op: MeasureCondition['op'] = /at least|>=/.test(m[1]) ? 'gte' : /less|under|fewer|below|</.test(m[1]) ? (m[1].includes('=') ? 'lte' : 'lt') : 'gt';
  return { field: ranked[0].c.name, op, values: [String(n)] };
}

export interface BuiltMeasures {
  main: MeasureDef;
  extra: MeasureDef[];
}

export function buildMeasureFromText(text: string, u: DataUnderstanding, existing: MeasureDef[]): BuiltMeasures | null {
  const clean = text.replace(/\s+by\s+[a-z ,/]+$/i, '').trim(); // "X by HCP" → breakdown handled by design
  if (!clean) return null;
  const want = textTokens(clean);
  const acts = u.profiles.filter((p) => p.kind === 'activity');
  let ds = findEntityDataset(clean, u.profiles);
  if (!ds || ds.kind !== 'activity') ds = acts.find((p) => valueConditions(p, want).length) ?? acts[0];
  if (!ds) return null;
  const key = ds.primaryKey;
  const isRate = /\b(rate|ratio|percent|percentage|share|%)\b/i.test(clean);
  // "dropped off before therapy initiation": the part after before/without names what did NOT happen
  const positive = textTokens(clean.replace(/\b(before|prior to|without|instead of|excluding|other than)\b.*$/i, ''));
  const conds = valueConditions(ds, positive, isRate);
  const num = numericCondition(clean, ds, want);
  if (num) conds.push(num);
  const name = humanize(clean.replace(/^(number of|count of|total number of)\s+/i, ''));
  const base = { description: `Built from the requirement "${text}".`, assumptions: [`Interpreted from "${text}" — review the conditions.`], requirementRef: text };
  const countDistinct = !!key && (ds.columns.find((c) => c.name === key)?.distinct ?? 0) < ds.rowCount;
  const counter = (n: string, cs: MeasureCondition[]): MeasureDef => ({ id: uid('m'), name: countDistinct && !cs.length && /^total /i.test(n) ? `Unique ${humanize(ds!.entity)}s` : n, kind: countDistinct ? 'countDistinct' : 'count', datasetId: ds!.datasetId, field: key, condition: cs[0], conditions: cs.slice(1), format: 'number', logic: '', ...base, description: `${humanize(ds!.entity)}s${cs.length ? ' where ' + cs.map((c) => `${c.field} ${c.op} ${c.values.join('/')}`).join(' and ') : ''}.` });

  // averages / sums of a numeric column ("average time to therapy initiation")
  if (/\b(average|avg|mean|median|total|sum)\b/i.test(clean) && !/\b(patients?|cases?|hcps?|accounts?)\b(?! .*\b(days|time|amount)\b)/i.test(clean.replace(/^(average|avg|mean|total)\s+/i, ''))) {
    const cols = ds.columns.filter((c) => c.role === 'measure');
    const ranked = cols.map((c) => ({ c, s: tokens(c.name).filter((t) => want.has(t) || (t === 'day' && /time|days|duration/i.test(clean))).length })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    if (ranked.length) {
      const med = /\bmedian\b/i.test(clean);
      const avg = med || /average|avg|mean/i.test(clean);
      return { main: { id: uid('m'), name, kind: med ? 'median' : avg ? 'avg' : 'sum', datasetId: ds.datasetId, field: ranked[0].c.name, condition: conds[0], conditions: conds.slice(1), format: avg ? 'decimal' : 'number', logic: '', ...base, description: `${med ? 'Median' : avg ? 'Average' : 'Sum'} of ${ranked[0].c.name}${conds.length ? ' where ' + conds.map((c) => `${c.field} ${c.op} ${c.values.join('/')}`).join(' and ') : ''}.` }, extra: [] };
    }
  }

  // rates: numerator = matched condition(s); denominator = rows where the same column is filled
  if (/\b(rate|ratio|percent|percentage|share|%)\b/i.test(clean)) {
    if (!conds.length) return null;
    const first = conds[0];
    const numM = counter(`${name} – numerator`, conds);
    const col = ds.columns.find((c) => c.name === first.field);
    // a stage column is a funnel position, so the base is every patient; an outcome column is judged on decided cases
    const isOutcome = !!col && col.missing > 0 && !/stage|status/i.test(first.field);
    const denM = counter(`${name} – denominator`, isOutcome ? [{ field: first.field, op: 'notnull', values: [] }] : []);
    const ratio: MeasureDef = { id: uid('m'), name, kind: 'ratio', numeratorId: numM.id, denominatorId: denM.id, format: 'percent', logic: '', ...base, description: `${numM.description.replace(/\.$/, '')} as a share of ${isOutcome ? `cases with a ${first.field}` : `all ${ds.entity.toLowerCase()}s`}.` };
    // reuse identical existing numerator/denominator if present
    const same = (a: MeasureDef) => existing.find((e) => e.kind === a.kind && e.datasetId === a.datasetId && e.field === a.field && JSON.stringify([e.condition, ...(e.conditions ?? [])].filter(Boolean)) === JSON.stringify([a.condition, ...(a.conditions ?? [])].filter(Boolean)));
    const n0 = same(numM);
    const d0 = same(denM);
    if (n0) ratio.numeratorId = n0.id;
    if (d0) ratio.denominatorId = d0.id;
    numM.name = `${humanize(conds.map((c) => c.values[0]).join(' '))} ${humanize(ds.entity)}s`;
    denM.name = isOutcome ? `${humanize(ds.entity)}s with ${humanize(first.field)}` : countDistinct ? `Unique ${humanize(ds.entity)}s` : `Total ${humanize(ds.entity)}s`;
    return { main: ratio, extra: [...(n0 ? [] : [numM]), ...(d0 ? [] : [denM])] };
  }

  if (!conds.length && !/\b(total|all|number of)\b/i.test(clean)) return null;
  return { main: counter(name, conds), extra: [] };
}

/** Label used in KPI logic. */
export const datasetLabel = (u: DataUnderstanding, id: string) => u.profiles.find((p) => p.datasetId === id)?.label ?? id;
