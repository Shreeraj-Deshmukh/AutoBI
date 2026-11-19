import { chatJSON } from './llm';

/**
 * Screenshots or mockups of a dashboard → a written requirement.
 *
 * Two steps, so that what gets built is decided by code, not by the model:
 *  1. `readMockups`: the AI model reports what it sees, visual by visual, using Power BI's
 *     visual names (an inventory; JSON).
 *  2. `mockupToRequirement`: the inventory becomes requirement text, the kind a user would
 *     type. Each visual is translated with a fixed table (`mapVisual`) to what AutoBI can build,
 *     and anything shown differently or not built is listed, so nothing disappears silently.
 *
 * The text goes into the requirement box for the user to check and edit; from there the
 * project runs exactly as for a typed requirement.
 */

export interface MockupMeasure {
  name?: string;
  format?: string;
}
export interface MockupVisual {
  row?: number;
  width?: string;
  type?: string;
  title?: string;
  measures?: MockupMeasure[];
  category?: string;
  series?: string;
  timeGrain?: string;
  sort?: string;
  topN?: number;
  comparison?: string;
  formatting?: string;
  columns?: string[];
  notes?: string;
}
export interface MockupFilter {
  label?: string;
  kind?: string;
  values?: string;
}
export interface MockupPage {
  name?: string;
  purpose?: string;
  filters?: MockupFilter[];
  visuals?: MockupVisual[];
  notes?: string[];
}
export interface MockupInventory {
  dashboardTitle?: string;
  pages?: MockupPage[];
  definitions?: { text?: string; basis?: string }[];
  questions?: string[];
}

export const MOCKUP_PROMPT = `You are a senior Power BI analyst. You are given screenshots of an existing dashboard or a mockup, normally one page per image, in page order. Describe what is on screen precisely enough for another analyst to rebuild it.

Rules
- Report only what you can see. Never invent KPIs, fields, filters or definitions.
- If text is too small or blurred to read, write "unreadable"; do not guess.
- Do not copy data values (figures, names of people, patients, HCPs, accounts). Use them only to tell the format (count, percentage, currency, days, date) and what kind of field it is (e.g. "a list of HCP names", "US states").
- Name visual types as Power BI does: card, multi-row card, KPI, gauge, clustered column chart, stacked column chart, clustered bar chart, stacked bar chart, 100% stacked bar chart, line chart, area chart, line and clustered column chart, donut chart, pie chart, table, matrix, funnel, scatter chart, map, filled map, shape map, treemap, waterfall chart, ribbon chart, decomposition tree, slicer, text box, image, button, Q&A, smart narrative, custom visual.
- A chart's measures are what is plotted (the values); its category is the axis or the rows; its series is the legend.
- Several cards in a row are separate visuals. Slicers are filters, not visuals.

For each page, in reading order (top to bottom, left to right):
- name: the page title or tab name; purpose: the business question the page answers (one sentence).
- filters: every slicer or filter: label, kind (dropdown, list, date range, relative date, buttons), and the kind of values visible (e.g. "regions", "last 12 months").
- visuals: every visual except decorative shapes and logos: row (1 = top), width (quarter | third | half | two-thirds | full), type, title, measures [{name, format}], category, series, timeGrain (day | week | month | quarter | year) if it is over time, sort and topN if visible, comparison (vs previous period, vs target, vs last year, % change, arrows), formatting (conditional colours, data bars, icons), columns (for tables and matrices: the headers in order), notes.
- notes: text boxes, footnotes and definitions written on the page, word for word.

Then:
- definitions: KPI definitions you can read on the screen, or that the labels clearly imply (e.g. "Reach % = HCPs reached ÷ target HCPs"), each with basis "read" or "implied".
- questions: what a builder would have to ask the business (unclear definitions, which date a period filter uses, where a target comes from).

Return JSON: {"dashboardTitle","pages":[{"name","purpose","filters":[{"label","kind","values"}],"visuals":[{"row","width","type","title","measures":[{"name","format"}],"category","series","timeGrain","sort","topN","comparison","formatting","columns","notes"}],"notes":[]}],"definitions":[{"text","basis"}],"questions":[]}`;

/** Step 1: the AI model reads the screenshots (data URLs, in page order). */
export async function readMockups(images: string[]): Promise<MockupInventory> {
  if (!images.length) throw new Error('Add at least one screenshot.');
  const n = images.length;
  return chatJSON<MockupInventory>(MOCKUP_PROMPT, `${n} screenshot${n > 1 ? 's' : ''} of a dashboard${n > 1 ? `, pages 1 to ${n} in order` : ''}. Describe every page.`, { images, maxTokens: 6000 });
}

// ─── Step 2: inventory → requirement text (deterministic) ───

/** What AutoBI builds for a visual. `filter` and `note` are not charts; `null` is not built. */
export type BuildKind = 'kpi' | 'bar' | 'hbar' | 'stacked' | 'line' | 'area' | 'donut' | 'table' | 'funnel' | 'scatter' | 'combo' | 'filter' | 'note' | null;

export interface VisualMapping {
  kind: BuildKind;
  /** Why it is built differently (or not at all): "is a filled map; it will be …". */
  change?: string;
  topN?: number;
}

/**
 * Power BI visual type (as named in a screenshot) → what AutoBI builds. Fixed and tested, so the
 * result does not depend on the model; the order matters ("treemap" before "map", "bar" after "stacked").
 */
export function mapVisual(type: string | undefined): VisualMapping {
  const t = String(type ?? '').toLowerCase().trim();
  if (!t || t === 'unreadable') return { kind: null, change: 'its type could not be read' };
  if (/slicer|filter/.test(t)) return { kind: 'filter' };
  if (/text ?box|^text$|heading|title/.test(t)) return { kind: 'note' };
  if (/q ?& ?a|q and a|question/.test(t)) return { kind: null, change: 'is a Q&A visual; AutoBI has no equivalent' };
  if (/smart narrative|narrative/.test(t)) return { kind: null, change: 'is a smart narrative; AutoBI has no equivalent (the documentation step writes an executive summary)' };
  if (/custom|r visual|python|power ?apps|html/.test(t)) return { kind: null, change: 'is a custom visual; AutoBI has no equivalent' };
  // maps first: "shape map" and "bubble map" are maps, not shapes or scatter charts
  if (/tree ?map/.test(t)) return { kind: 'hbar', topN: 10, change: 'is a treemap; it will be a horizontal bar chart of the top 10' };
  if (/map/.test(t)) return { kind: 'hbar', topN: 10, change: 'is a map; it will be a horizontal bar chart of the top 10' };
  if (/image|picture|logo|button|bookmark|navigator|navigation|shape/.test(t)) return { kind: null, change: 'is an image or button, not a data visual' };
  if (/gauge/.test(t)) return { kind: 'kpi', change: 'is a gauge; it will be a KPI card' };
  if (/card|^kpi/.test(t)) return { kind: 'kpi' };
  if (/funnel/.test(t)) return { kind: 'funnel' };
  if (/scatter|bubble/.test(t)) return { kind: 'scatter' };
  if (/decomposition/.test(t)) return { kind: 'bar', change: 'is a decomposition tree; it will be a bar chart' };
  if (/waterfall/.test(t)) return { kind: 'bar', change: 'is a waterfall chart; it will be a bar chart' };
  if (/ribbon/.test(t)) return { kind: 'bar', change: 'is a ribbon chart; it will be a bar chart' };
  if (/line/.test(t) && /column|bar|combo/.test(t)) return { kind: 'combo', change: 'combines lines and columns; it will be a line chart and a bar chart' };
  if (/combo/.test(t)) return { kind: 'combo', change: 'is a combo chart; it will be a line chart and a bar chart' };
  if (/stacked/.test(t) && /bar|column|area/.test(t)) return /area/.test(t) ? { kind: 'area', change: 'is a stacked area chart; it will be an area chart' } : { kind: 'stacked' };
  if (/bar/.test(t)) return { kind: 'hbar' };
  if (/column/.test(t)) return { kind: 'bar' };
  if (/area/.test(t)) return { kind: 'area' };
  if (/line|trend|sparkline/.test(t)) return { kind: 'line' };
  if (/pie/.test(t)) return { kind: 'donut', change: 'is a pie chart; it will be a donut chart' };
  if (/donut|doughnut/.test(t)) return { kind: 'donut' };
  if (/matrix|pivot/.test(t)) return { kind: 'table', change: 'is a matrix; it will be a table' };
  if (/table|grid|list/.test(t)) return { kind: 'table' };
  return { kind: null, change: `is a "${clean(type, 40)}"; AutoBI has no equivalent` };
}

/** A model string, trimmed and on one line; empty for missing or unreadable values. */
function clean(v: unknown, max = 120): string {
  if (v == null || typeof v === 'object') return '';
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s || /^(unreadable|unknown|n\/?a|none|null|-)$/i.test(s)) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const uniq = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
};

const FORMAT_HINT: [RegExp, string][] = [
  [/percent|%|rate|ratio/i, 'percentage'],
  [/currency|\$|£|€|amount|revenue|money/i, 'currency'],
  [/day|duration|time/i, 'days'],
];
function measureText(m: MockupMeasure): string {
  const name = clean(m?.name, 80);
  if (!name) return '';
  const f = clean(m?.format, 40);
  const hint = f ? FORMAT_HINT.find(([re]) => re.test(f))?.[1] : undefined;
  return hint && !name.toLowerCase().includes(hint) ? `${name} (${hint})` : name;
}
const GRAINS = ['day', 'week', 'month', 'quarter', 'year'];
const grainOf = (v: unknown) => {
  const s = clean(v, 20).toLowerCase();
  return GRAINS.find((g) => s.startsWith(g) || s.startsWith(`${g}ly`) || (g === 'day' && s.startsWith('dai')));
};
function comparisonText(v: unknown): string {
  const s = clean(v, 80).toLowerCase();
  if (!s) return '';
  if (/target|goal|plan|quota|budget/.test(s)) return 'compared with target';
  if (/last year|prior year|previous year|py|yoy|year over year/.test(s)) return 'compared with the same period last year';
  if (/previous|prior|last|change|%|arrow|vs/.test(s)) return 'compared with the previous period';
  return '';
}

const KIND_NAME: Record<Exclude<BuildKind, 'kpi' | 'filter' | 'note' | 'combo' | null>, string> = {
  bar: 'bar chart',
  hbar: 'horizontal bar chart',
  stacked: 'stacked bar chart',
  line: 'line chart',
  area: 'area chart',
  donut: 'donut chart',
  table: 'table',
  funnel: 'funnel',
  scatter: 'scatter chart',
};

/** One chart, as a requirement line: `"Sales by Region": bar chart of Net Sales by Region.` */
function chartLine(kind: keyof typeof KIND_NAME, v: MockupVisual, topN?: number): string {
  const title = clean(v.title, 80);
  const ms = uniq(arr<MockupMeasure>(v.measures).map(measureText));
  const cat = clean(v.category, 60);
  const series = clean(v.series, 60);
  const grain = grainOf(v.timeGrain);
  const n = Number(v.topN) > 0 ? Math.round(Number(v.topN)) : topN;
  const what = ms.length ? list(ms) : title || 'the measure shown';
  let s: string;
  if (kind === 'table') {
    const cols = uniq(arr<string>(v.columns).map((c) => clean(c, 50)));
    s = `table${cat ? ` of ${n ? `the top ${n} ` : ''}${cat}` : ''}${cols.length ? ` with columns ${list(cols)}` : ms.length ? ` showing ${list(ms)}` : ''}`;
  } else if (kind === 'funnel') {
    s = `funnel of ${what}${cat ? ` by ${cat}` : ''}`;
  } else if (kind === 'scatter') {
    s = ms.length >= 2 ? `scatter chart of ${ms[0]} against ${ms[1]}${cat ? ` for each ${cat}` : ''}` : `scatter chart of ${what}${cat ? ` by ${cat}` : ''}`;
  } else if (kind === 'line' || kind === 'area') {
    s = `${KIND_NAME[kind]} of ${what} over time${grain ? `, by ${grain}` : ''}${series ? `, one line per ${series}` : ''}`;
  } else {
    // bar, hbar, stacked, donut: by a category; a time axis ("Month") is written as "over time, by month",
    // so it is read as the time grain, not as a field called Month
    const timeAxis = !cat ? grain : /^(day|date|week|month|quarter|year|period|time)s?\b/i.test(cat) ? (grain ?? grainOf(cat) ?? 'month') : undefined;
    const by = timeAxis ? ` over time, by ${timeAxis}` : cat ? ` by ${cat}` : '';
    s = `${KIND_NAME[kind]} of ${n && cat && !timeAxis ? `the top ${n} ${cat} by ${what}` : `${what}${by}`}${series ? `, split by ${series}` : ''}`;
  }
  const cmp = comparisonText(v.comparison);
  return `${title ? `"${title}": ` : ''}${s}${cmp ? `, ${cmp}` : ''}.`;
}

export interface RequirementDraft {
  /** The text for the requirement box. */
  text: string;
  /** Visuals shown differently, and visuals not built: also inside `text`. */
  changed: string[];
  notBuilt: string[];
  pages: number;
  visuals: number;
}

/** Step 2: the inventory as requirement text, with every visual translated by `mapVisual`. */
export function mockupToRequirement(inv: MockupInventory): RequirementDraft {
  const pages = arr<MockupPage>(inv?.pages).filter((p) => p && typeof p === 'object');
  const changed: string[] = [];
  const notBuilt: string[] = [];
  const filters: string[] = [];
  const out: string[] = [];
  let visuals = 0;
  const title = clean(inv?.dashboardTitle, 80);
  out.push(`Rebuild ${title ? `the "${title}" dashboard` : 'the dashboard'} shown in the screenshots${pages.length > 1 ? ` (${pages.length} pages)` : ''}.`);

  pages.forEach((p, i) => {
    const name = clean(p.name, 60) || `Page ${i + 1}`;
    const purpose = clean(p.purpose, 200);
    const lines: string[] = [];
    const kpis: string[] = [];
    let kpiCmp = '';
    const pageFilters: string[] = arr<MockupFilter>(p.filters).map((f) => clean(f?.label, 50));
    const notes: string[] = arr<string>(p.notes).map((x) => clean(x, 200));
    const vs = arr<MockupVisual>(p.visuals)
      .filter((v) => v && typeof v === 'object')
      .map((v, k) => ({ v, k }))
      .sort((a, b) => (Number(a.v.row) || 99) - (Number(b.v.row) || 99) || a.k - b.k)
      .map((x) => x.v);
    for (const v of vs) {
      const m = mapVisual(v.type);
      const label = clean(v.title, 80) || clean(v.type, 40) || 'A visual';
      if (m.kind === 'filter') {
        pageFilters.push(clean(v.title, 50) || clean(v.category, 50));
        continue;
      }
      if (m.kind === 'note') {
        notes.push(clean(v.notes, 200) || clean(v.title, 200));
        continue;
      }
      if (m.kind === null) {
        notBuilt.push(`"${label}" (${name}) ${m.change}.`);
        continue;
      }
      visuals++;
      if (m.change) changed.push(`"${label}" (${name}) ${m.change}.`);
      if (m.kind === 'kpi') {
        const ms = arr<MockupMeasure>(v.measures).map(measureText).filter(Boolean);
        kpis.push(...(ms.length ? ms : [clean(v.title, 80)]));
        kpiCmp ||= comparisonText(v.comparison) || (/gauge/i.test(String(v.type)) ? 'compared with target' : '');
      } else if (m.kind === 'combo') {
        const ms = arr<MockupMeasure>(v.measures);
        // first measure as the columns, the rest as the line (Power BI's usual combo)
        lines.push(chartLine('bar', { ...v, measures: ms.slice(0, 1) }));
        lines.push(chartLine('line', { ...v, title: ms.length > 1 ? `${clean(v.title, 70)} (trend)` : v.title, measures: ms.length > 1 ? ms.slice(1) : ms, timeGrain: v.timeGrain ?? v.category }));
      } else {
        lines.push(chartLine(m.kind, v, m.topN));
      }
    }
    out.push('');
    out.push(`Page "${name}"${purpose ? `: ${purpose}` : ''}`);
    const ks = uniq(kpis);
    if (ks.length) out.push(`- KPI cards: ${list(ks)}${kpiCmp ? `, ${kpiCmp}` : ''}.`);
    for (const l of lines) out.push(`- ${l}`);
    if (!ks.length && !lines.length) out.push('- No data visuals could be read on this page.');
    const pf = uniq(pageFilters);
    if (pf.length) out.push(`- Page filters: ${list(pf)}.`);
    for (const n of uniq(notes)) out.push(`- Note on the page: "${n}"`);
    filters.push(...pf);
  });

  const fs = uniq(filters);
  if (fs.length) {
    out.push('');
    out.push(`Let people filter by ${list(fs)}.`);
  }
  const defs = arr<{ text?: string; basis?: string }>(inv?.definitions).map((d) => ({ text: clean(d?.text, 200), basis: clean(d?.basis, 20).toLowerCase() })).filter((d) => d.text);
  if (defs.length) {
    out.push('');
    out.push('KPI definitions from the screenshots:');
    for (const d of defs) out.push(`- ${d.text}${d.basis === 'implied' ? ' (implied, not written on the screen; please confirm)' : ''}`);
  }
  if (changed.length) {
    out.push('');
    out.push('Shown differently from the screenshots:');
    for (const c of changed) out.push(`- ${c}`);
  }
  if (notBuilt.length) {
    out.push('');
    out.push('Not built:');
    for (const c of notBuilt) out.push(`- ${c}`);
  }
  const qs = uniq(arr<string>(inv?.questions).map((q) => clean(q, 200)));
  if (qs.length) {
    out.push('');
    out.push('Open questions:');
    for (const q of qs) out.push(`- ${q}`);
  }
  return { text: out.join('\n'), changed, notBuilt, pages: pages.length, visuals };
}

/** Both steps: screenshots → requirement text. */
export async function describeMockups(images: string[]): Promise<RequirementDraft> {
  const draft = mockupToRequirement(await readMockups(images));
  if (!draft.visuals) throw new Error('No dashboard visuals could be read in the screenshots. Try full-page screenshots, one page each.');
  return draft;
}
