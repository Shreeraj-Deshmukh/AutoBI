export const uid = (prefix = 'id') =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;

export const nowIso = () => new Date().toISOString();

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Deterministic PRNG (mulberry32) so synthetic sample data is reproducible. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T,>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)],
    weighted: <T,>(items: readonly (readonly [T, number])[]) => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [v, w] of items) {
        if ((r -= w) <= 0) return v;
      }
      return items[items.length - 1][0];
    },
  };
}

export const fmtNumber = (n: number | null | undefined, digits = 0) =>
  n == null || Number.isNaN(n)
    ? '—'
    : n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const fmtCompact = (n: number) =>
  Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : fmtNumber(n);

export const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const fmtDateTime = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';

export const humanize = (s: string) =>
  s
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(Hcp|Hcps|Pbm|Pbms|Frm|Frms|Pa|Sp|Kpi|Trx|Nrx|Uat|Bv|Id|Npi|Hco)\b/g, (w) => (w.endsWith('s') && w.length > 3 ? w.slice(0, -1).toUpperCase() + 's' : w === 'Trx' ? 'TRx' : w === 'Nrx' ? 'NRx' : w.toUpperCase()));

export const normalizeToken = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export const singular = (w: string) =>
  w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.endsWith('ses') ? w.slice(0, -2) : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;

export const plural = (w: string) => (/rx$/i.test(w) ? w : w.endsWith('y') ? w.slice(0, -1) + 'ies' : w.endsWith('s') ? w : w + 's');

export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export const pad = (n: number, w = 3) => String(n).padStart(w, '0');

export function download(filename: string, content: BlobPart, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]) {
  const cols = columns ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
