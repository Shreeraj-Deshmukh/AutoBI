import type { ColumnProfile, DatasetProfile } from '@/types';
import { singular } from './util';

/** Shared semantic matching helpers used by several agents. */

export const tokens = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singular);

const SYNONYMS: Record<string, string[]> = {
  hcp: ['account', 'customer', 'physician'],
  prescription: ['rx', 'trx', 'nrx', 'script'],
  trx: ['rx'],
  nrx: ['rx'],
  script: ['rx'],
  account: ['hcp', 'customer'],
  customer: ['account', 'client'],
  tier: ['tier', 'level'],
  segment: ['segment', 'segmentation'],
  rep: ['representative'],
  representative: ['rep'],
  specialty: ['speciality'],
  period: ['date'],
  template: ['template'],
};

export function expand(ts: string[]) {
  const out = new Set(ts);
  for (const t of ts) for (const s of SYNONYMS[t] ?? []) out.add(s);
  return out;
}

export interface FieldMatch {
  datasetId: string;
  column: string;
  score: number;
  profile: DatasetProfile;
  col: ColumnProfile;
}

/** Best column for a business phrase such as "Account tier" or "Call type". */
export function findField(text: string, profiles: DatasetProfile[], opts: { roles?: ColumnProfile['role'][]; prefer?: string } = {}): FieldMatch | null {
  const want = expand(tokens(text).filter((t) => !['by', 'the', 'of', 'total', 'number', 'count'].includes(t)));
  if (!want.size) return null;
  let best: FieldMatch | null = null;
  for (const p of profiles) {
    const entityToks = tokens(p.entity);
    for (const c of p.columns) {
      if (opts.roles && !opts.roles.includes(c.role)) continue;
      const ct = tokens(c.name);
      const core = ct.filter((t) => t !== 'id' && !entityToks.includes(t));
      const hits = ct.filter((t) => want.has(t)).length;
      if (!hits) continue;
      // full coverage of the column's tokens is the strongest signal
      let score = hits / ct.length + (core.length && core.every((t) => want.has(t)) ? 0.5 : 0);
      if ([...want].every((t) => ct.includes(t) || entityToks.includes(t))) score += 0.4;
      if (opts.prefer === p.datasetId) score += 0.15;
      if (c.role === 'dimension' || c.role === 'status') score += 0.1;
      if (c.role === 'identifier' && !want.has('id')) score -= 0.3;
      // "HCP" means the HCP's name column
      if (ct.includes('name') && hits && ct.length <= 3) score += 0.3;
      if (!best || score > best.score) best = { datasetId: p.datasetId, column: c.name, score, profile: p, col: c };
    }
  }
  return best && best.score >= 0.6 ? best : null;
}

/** Activity dataset whose entity is mentioned in the text (e.g. "Total calls" → Call Activity). */
export function findEntityDataset(text: string, profiles: DatasetProfile[]): DatasetProfile | null {
  const want = expand(tokens(text));
  const ranked = profiles
    .map((p) => {
      const et = tokens(p.entity);
      const lt = tokens(p.label);
      let s = et.filter((t) => want.has(t)).length * 2 + lt.filter((t) => want.has(t)).length;
      if (p.kind === 'activity') s += 0.5;
      return { p, s };
    })
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s);
  if (ranked[0]) return ranked[0].p;
  // Fallback: money/volume words map to the activity dataset that has numeric measures,
  // e.g. "Net sales" → Transaction Activity (Net_Amount).
  const acts = profiles.filter((p) => p.kind === 'activity');
  if (/(sales|revenue|amount|value|spend|transactions?|orders?|volume|units|quantity|prescriptions?|trx|nrx|scripts?)/i.test(text)) {
    return acts.find((p) => p.columns.some((c) => c.role === 'measure')) ?? (acts.length === 1 ? acts[0] : null);
  }
  return null;
}

const POSITIVE = /^(delivered|opened|yes|y|true|completed|complete|success|successful|clicked|active|won|closed won|converted|attended|responded)$/i;

/** Find a status column + its "positive" value for a keyword such as "deliver" or "open". */
export function findStatus(p: DatasetProfile, keyword: string): { column: string; value: string } | null {
  const kw = keyword.toLowerCase();
  for (const c of p.columns) {
    if (c.role !== 'status' && c.role !== 'dimension') continue;
    const nameHit = c.name.toLowerCase().includes(kw);
    const val = c.topValues.find((v) => v.value.toLowerCase().startsWith(kw) && POSITIVE.test(v.value)) ?? (nameHit ? c.topValues.find((v) => POSITIVE.test(v.value)) : undefined);
    if (val) return { column: c.name, value: val.value };
  }
  return null;
}

export function positiveValue(c: ColumnProfile) {
  return c.topValues.find((v) => POSITIVE.test(v.value))?.value ?? null;
}
