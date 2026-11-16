import type { DashComponent, DashPage, DashboardSpec, FilterDef } from '@/types';
import { CARD_TYPES, cardWeight } from '@/agents/designAgent';
import { hasPeriodFilter } from '@/lib/periodFilter';
import { BANNER } from '@/dashboard/format';

/**
 * Page layout of a dashboard page, shared by the Power BI export and the web dashboard (design mock and
 * development preview), so both place every box in the same spot at the same size.
 *
 * Coordinates are Power BI report pixels on a page PAGE_W wide (the web scales x and width to its own width
 * and keeps the heights).
 */

export const PAGE_W = 1280;
export const MARGIN = 16;
export const GAP = 12;
export const INNER = PAGE_W - 2 * MARGIN;
const COL = (PAGE_W - 2 * MARGIN - 11 * GAP) / 12;
export const span = (cols: number) => cols * COL + (cols - 1) * GAP;
/** Slicer box: header plus the dropdown, or the two date boxes of the Custom Date slicer. */
export const SLICER_H = 76;
/** Natural slicer widths, before a row is stretched to the full page width. */
const SLICER_W = { geo: 170, period: 220, date: 260, filter: 190 } as const;
/** Box heights per visual type (a row of boxes takes the tallest). */
export const HEIGHT: Partial<Record<DashComponent['type'], number>> = { kpi: 112, kpiGroup: 124, extremes: 124, hbar: 340, stacked: 320, scatter: 340, table: 420, records: 460, drilldown: 420 };
const DEFAULT_HEIGHT = 300;
export const TITLE_H = (page: DashPage) => (page.description ? 64 : 44);
export const SECTION_H = 32;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SlicerSlot = { kind: 'geo' } | { kind: 'period' } | { kind: 'date' } | { kind: 'filter'; filter: FilterDef };

export type LayoutItem =
  /** band: the light purple band behind the slicer rows */
  | { kind: 'banner' | 'logo' | 'tabs' | 'title' | 'band'; box: Box }
  | { kind: 'slicer'; slot: SlicerSlot; box: Box }
  | { kind: 'section'; text: string; box: Box }
  /** the narrowing slicer of a case list (records toggle), above the list */
  | { kind: 'toggle'; component: DashComponent; box: Box }
  | { kind: 'component'; component: DashComponent; box: Box };

export interface PageLayout {
  items: LayoutItem[];
  /** page height (at least 720, the Power BI default) */
  height: number;
}

export interface LayoutOptions {
  /** the page shows the Geo Level selector */
  geo: boolean;
  /** the data has activity dates (Time Period and Custom Date slicers need them) */
  hasDates: boolean;
  /** the dashboard filters shown as slicers (multi filters whose field is available) */
  filters: FilterDef[];
  /** components with a narrowing toggle slicer above them */
  hasToggle: (c: DashComponent) => boolean;
}

export const hasToggle = (c: DashComponent) => c.type === 'records' && !!c.toggle?.filter[0];

/** Lays out one dashboard page: banner, title, slicer rows, then sections, card rows and the 12-column grid. */
export function layoutPage(spec: DashboardSpec, page: DashPage, opts: LayoutOptions): PageLayout {
  const items: LayoutItem[] = [];
  // banner, as in the web dashboard: purple gradient, logo in a white chip on the left, page tabs centred
  const chip = BANNER.chip;
  items.push({ kind: 'banner', box: { x: 0, y: 0, width: PAGE_W, height: BANNER.height } });
  items.push({ kind: 'logo', box: { x: chip.x + 8, y: chip.y + 5, width: chip.width - 16, height: chip.height - 10 } });
  if (spec.pages.length > 1) {
    // tabs share the banner right of the logo (up to 230 px each), centred in it
    const left = chip.x + chip.width + GAP;
    const room = PAGE_W - MARGIN - left;
    const navW = Math.min(room, spec.pages.length * 230);
    items.push({ kind: 'tabs', box: { x: left + Math.round((room - navW) / 2), y: 0, width: navW, height: BANNER.height } });
  }
  // page title + description under the banner
  let y = BANNER.height + GAP;
  items.push({ kind: 'title', box: { x: MARGIN, y, width: INNER, height: TITLE_H(page) } });
  y += (page.description ? 64 : 48) + 8;

  // slicer bar: geo level, reporting period, date range and the dashboard filters
  const slicers: { slot: SlicerSlot; width: number }[] = [];
  if (opts.geo) slicers.push({ slot: { kind: 'geo' }, width: SLICER_W.geo });
  // Time Period + Custom Date only when the dashboard has the Time Period filter (otherwise it shows all time)
  if (opts.hasDates && hasPeriodFilter(spec)) slicers.push({ slot: { kind: 'period' }, width: SLICER_W.period }, { slot: { kind: 'date' }, width: SLICER_W.date });
  for (const filter of opts.filters) slicers.push({ slot: { kind: 'filter', filter }, width: SLICER_W.filter });
  // wrap into rows by the slicers' natural widths, then stretch each row to the full page width
  const lines: (typeof slicers)[] = [[]];
  let used = 0;
  for (const s of slicers) {
    if (lines[lines.length - 1].length && used + s.width > INNER) {
      lines.push([]);
      used = 0;
    }
    lines[lines.length - 1].push(s);
    used += s.width + GAP;
  }
  const rows = lines.filter((l) => l.length);
  if (rows.length) items.push({ kind: 'band', box: { x: 0, y: y - 8, width: PAGE_W, height: rows.length * (SLICER_H + 8) + 8 } });
  for (const line of rows) {
    const natural = line.reduce((sum, s) => sum + s.width, 0);
    const free = INNER - GAP * (line.length - 1);
    let x = MARGIN;
    line.forEach((s, i) => {
      const w = i === line.length - 1 ? MARGIN + INNER - x : Math.floor((free * s.width) / natural);
      items.push({ kind: 'slicer', slot: s.slot, box: { x, y, width: w, height: SLICER_H } });
      x += w + GAP;
    });
    y += SLICER_H + 8;
  }
  if (slicers.length) y += GAP;

  // components: section headings, rows of cards, then the 12-column grid
  let section: string | undefined;
  let row: DashComponent[] = [];
  let cards: DashComponent[] = [];
  const flushRow = () => {
    if (!row.length) return;
    let cx = MARGIN;
    let bottom = y;
    // boxes side by side share one height (the tallest), so the row lines up
    const h = Math.max(...row.map((c) => HEIGHT[c.type] ?? DEFAULT_HEIGHT));
    for (const c of row) {
      const w = span(c.width);
      let top = y;
      if (opts.hasToggle(c)) {
        items.push({ kind: 'toggle', component: c, box: { x: cx, y, width: 220, height: SLICER_H } });
        top += SLICER_H + 8;
      }
      items.push({ kind: 'component', component: c, box: { x: cx, y: top, width: w, height: h } });
      bottom = Math.max(bottom, top + h);
      cx += w + GAP;
    }
    y = bottom + GAP;
    row = [];
  };
  const flushCards = () => {
    if (!cards.length) return;
    // flex-wrap: a line holds cards while their minimum widths fit, then shares the width by weight
    const lines: DashComponent[][] = [[]];
    let used = 0;
    for (const c of cards) {
      const min = cardWeight(c) * 150 + 20;
      if (lines[lines.length - 1].length && used + min + GAP > INNER) {
        lines.push([]);
        used = 0;
      }
      lines[lines.length - 1].push(c);
      used += min + GAP;
    }
    for (const line of lines) {
      const total = line.reduce((s, c) => s + cardWeight(c), 0);
      const free = INNER - GAP * (line.length - 1);
      let cx = MARGIN;
      const h = Math.max(...line.map((c) => HEIGHT[c.type] ?? 112));
      for (const c of line) {
        const w = Math.floor((free * cardWeight(c)) / total);
        items.push({ kind: 'component', component: c, box: { x: cx, y, width: w, height: h } });
        cx += w + GAP;
      }
      y += h + GAP;
    }
    cards = [];
  };
  for (const c of page.components) {
    if (c.section && c.section !== section) {
      flushCards();
      flushRow();
      section = c.section;
      items.push({ kind: 'section', text: c.section, box: { x: MARGIN, y, width: INNER, height: SECTION_H } });
      y += SECTION_H + 4;
    }
    if (CARD_TYPES.includes(c.type)) {
      flushRow();
      cards.push(c);
      continue;
    }
    flushCards();
    const usedCols = row.reduce((s, r) => s + r.width, 0);
    if (usedCols + c.width > 12) flushRow();
    row.push(c);
  }
  flushCards();
  flushRow();
  return { items, height: Math.max(720, Math.ceil(y + MARGIN)) };
}
