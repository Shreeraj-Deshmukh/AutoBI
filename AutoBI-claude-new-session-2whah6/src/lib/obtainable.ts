import type { DatasetProfile, ReqMapping } from '@/types';

/**
 * Whether a requirement (KPI, filter or breakdown) can be obtained from the uploaded data at all, before any
 * fuzzy matching: its subject words must appear in the data (column names, dataset names or category values),
 * and money / age / score words need a numeric column of that kind. Requirements that fail are reported as
 * missing instead of being matched to something that merely shares a word ("Average patient age" is not
 * "Plans Reached (Patients)").
 */

/** Words that say how to compute or show something, or name the business entities, not what to measure. */
const GENERIC = new Set(
  (
    'a an the of per by for in on at with and or to from vs versus all each every any new current overall ' +
    'average avg mean median total sum number no count counts volume rate ratio percent percentage pct share proportion % ' +
    'time days day weeks week weekly months month monthly quarter quarterly year yearly ytd trend trends over top bottom highest lowest ' +
    'level levels group groups wise breakdown distribution mix split list view summary detail details id ids key status type types category ' +
    'patient patients case cases hcp hcps prescriber prescribers physician physicians doctor doctors plan plans payer payers pbm pbms ' +
    'product products territory territories region regions account accounts frm frms manager managers team field reimbursement ' +
    'kpi kpis metric metrics measure measures dashboard report reporting period periods date dates filter filters segment segments name names'
  ).split(/\s+/),
);

/** Words naming an amount: they need a numeric column of that kind (a category or a day count is not an amount). */
const QUANTITY = new Set('amount amounts cost costs revenue revenues sales price prices spend spending dollar dollars $ value income salary margin profit budget fee fees payment payments paid age ages score scores rating ratings satisfaction nps'.split(' '));

/** Words the data spells differently. */
const SYNONYMS: Record<string, string[]> = {
  drop: ['discontinu', 'dropped', 'drop'],
  dropoff: ['discontinu', 'drop'],
  delay: ['days', 'delay', 'aging', 'pending'],
  delays: ['days', 'delay', 'aging', 'pending'],
  stuck: ['stage', 'pending', 'days'],
  initiation: ['start', 'initiat'],
  approval: ['approv', 'outcome'],
  approved: ['approv', 'outcome'],
  denial: ['deni', 'outcome'],
  resolved: ['resol', 'closed', 'close'],
  resolution: ['resol', 'closed', 'close'],
  escalation: ['escalat'],
  escalated: ['escalat'],
  barrier: ['barrier'],
  barriers: ['barrier'],
  backlog: ['open', 'backlog'],
  response: ['response', 'action'],
  fill: ['therapy', 'fill', 'start'],
  appeal: ['appeal'],
  closure: ['close', 'closed', 'closure'],
  // amounts as data usually names them
  sales: ['sales', 'amount', 'revenue', 'net', 'gross', 'value', 'quantity'],
  revenue: ['revenue', 'sales', 'amount', 'net', 'gross', 'value'],
  cost: ['cost', 'amount', 'spend', 'price', 'fee'],
  costs: ['cost', 'amount', 'spend', 'price', 'fee'],
  amount: ['amount', 'value', 'paid', 'payment'],
  value: ['value', 'amount', 'price', 'net', 'sales', 'revenue'],
  price: ['price', 'amount', 'value'],
  closed: ['close', 'closed'],
  received: ['open', 'received', 'referral'],
  opened: ['open'],
};

const split = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9$%]+/)
    .filter(Boolean);

const stem = (t: string) => (t.length > 5 ? t.slice(0, 5) : t);

interface Vocab {
  /** tokens of column names, dataset names and category values */
  all: string[];
  /** tokens of numeric column names */
  numeric: string[];
}

export function dataVocabulary(profiles: DatasetProfile[]): Vocab {
  const all = new Set<string>();
  const numeric = new Set<string>();
  for (const p of profiles) {
    for (const t of [...split(p.label), ...split(p.entity), ...split(p.datasetId)]) all.add(t);
    for (const c of p.columns) {
      for (const t of split(c.name)) {
        all.add(t);
        if ((c.type === 'number' || c.type === 'integer') && c.role !== 'identifier' && c.role !== 'foreign_key') numeric.add(t);
      }
      // category values (short lists only: free-text notes would make every word look present)
      if ((c.role === 'dimension' || c.role === 'status') && c.distinct <= 50) for (const v of c.topValues.slice(0, 50)) for (const t of split(v.value)) all.add(t);
    }
    // a dataset named after an amount (sales_transactions) with numeric columns has that amount
    if (p.columns.some((c) => (c.type === 'number' || c.type === 'integer') && c.role === 'measure')) for (const t of [...split(p.label), ...split(p.datasetId)]) numeric.add(t);
  }
  return { all: [...all], numeric: [...numeric] };
}

const found = (token: string, vocab: string[]) => {
  const forms = SYNONYMS[token] ?? [token];
  return forms.some((f) => vocab.some((v) => v === f || (f.length >= 4 && (v.startsWith(stem(f)) || f.startsWith(stem(v)) && v.length >= 4))));
};

/** Content words of a requirement (what it is about), without the computing / entity words. */
export const subjectWords = (text: string) => split(text.replace(/\([^)]*\)/g, (m) => ` ${m} `)).filter((t) => !GENERIC.has(t) && !/^\d+$/.test(t) && t.length > 1);

/**
 * Why the requirement cannot be obtained from the data, or null when it can.
 * `strict` (filters and breakdowns): every subject word must be in the data.
 */
export function unobtainableReason(text: string, vocab: Vocab, opts: { strict?: boolean } = {}): string | null {
  const words = subjectWords(text);
  if (!words.length) return null;
  // (filters and breakdowns are categories: "Sales Territory" is not an amount)
  const amounts = opts.strict ? [] : words.filter((w) => QUANTITY.has(w) && !found(w, vocab.numeric));
  if (amounts.length) return `The data has no ${amounts.map((w) => `"${w}"`).join(' / ')} values (no numeric column for it), so "${text}" cannot be calculated.`;
  const absent = words.filter((w) => !found(w, vocab.all));
  // a KPI most of whose subject is not in the data ("Call center average handle time"); filters: any of it
  if (absent.length * 2 > words.length || (opts.strict && absent.length)) return `Nothing in the uploaded data describes ${absent.map((w) => `"${w}"`).join(', ')}, so "${text}" cannot be ${opts.strict ? 'used' : 'calculated'}.`;
  return null;
}

/**
 * The requirements the data supports: what the KPI definitions and the dashboard design are built from.
 * Missing ones are left out entirely (and listed as warnings), so nothing is built from a near-match.
 */
export function supportedRequirements<T extends { kpis: { text: string }[]; filters: { text: string }[]; dimensions: { text: string }[] }>(spec: T | null, mappings: ReqMapping[] | undefined): T | null {
  if (!spec) return spec;
  const keep = (x: { text: string }) => !isMissingRequirement(mappings, x.text);
  return { ...spec, kpis: spec.kpis.filter(keep), filters: spec.filters.filter(keep), dimensions: spec.dimensions.filter(keep) };
}

/** Requirement mappings the data cannot support (shown as warnings, never matched to something else). */
export const missingRequirements = (mappings: ReqMapping[] | undefined) => (mappings ?? []).filter((m) => m.status === 'missing');

/** Whether a requirement text was found to be unobtainable. */
export const isMissingRequirement = (mappings: ReqMapping[] | undefined, text: string) => (mappings ?? []).some((m) => m.status === 'missing' && m.requirement.trim().toLowerCase() === text.trim().toLowerCase());
