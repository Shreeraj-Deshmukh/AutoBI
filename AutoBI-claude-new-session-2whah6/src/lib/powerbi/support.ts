import type { ComponentType, DashComponent, DashboardSpec, FieldRef, Foundation, MeasureDef } from '@/types';
import { fieldLabel } from '@/lib/fieldLabels';

/**
 * What the Power BI export can build — the limits every dashboard design is kept within, so that the web
 * mock, the development dashboard and the downloaded Power BI report show the same visuals.
 *
 * `conformSpec` is applied wherever a design is created or changed (design agent, AI design, design assistant,
 * Design Studio edits, development build). A component outside the limits is replaced by the closest one inside
 * them, with a note saying what changed.
 */

/** Power BI visual a component becomes: the internal visualType and the name shown in Power BI Desktop. */
export interface PowerBiVisual {
  visualType: string;
  name: string;
}

const PBI = {
  card: { visualType: 'card', name: 'Card' },
  multiRowCard: { visualType: 'multiRowCard', name: 'Multi-row card' },
  matrix: { visualType: 'pivotTable', name: 'Matrix' },
  column: { visualType: 'clusteredColumnChart', name: 'Clustered column chart' },
  stackedColumn: { visualType: 'columnChart', name: 'Stacked column chart' },
  bar: { visualType: 'clusteredBarChart', name: 'Clustered bar chart' },
  donut: { visualType: 'donutChart', name: 'Donut chart' },
  line: { visualType: 'lineChart', name: 'Line chart' },
  area: { visualType: 'areaChart', name: 'Area chart' },
  table: { visualType: 'tableEx', name: 'Table' },
  scatter: { visualType: 'scatterChart', name: 'Scatter chart' },
} satisfies Record<string, PowerBiVisual>;

/** The component types a design may use (drilldown has no matching Power BI visual and is replaced). */
export const SUPPORTED_TYPES: ComponentType[] = ['kpi', 'kpiGroup', 'extremes', 'bar', 'hbar', 'stacked', 'donut', 'line', 'area', 'funnel', 'table', 'records', 'scatter'];

/** Power BI visual for a component that is within the limits (null: not exportable as it is). */
export function powerBiVisual(c: DashComponent): PowerBiVisual | null {
  switch (c.type) {
    case 'kpi':
      return PBI.card;
    case 'kpiGroup':
      return c.dimension ? PBI.matrix : PBI.multiRowCard;
    case 'extremes':
      return PBI.multiRowCard;
    case 'bar':
      return PBI.column;
    case 'stacked':
      return PBI.stackedColumn;
    case 'hbar':
    case 'funnel':
      return PBI.bar;
    case 'donut':
      return PBI.donut;
    case 'line':
      return PBI.line;
    case 'area':
      return PBI.area;
    case 'table':
    case 'records':
      return PBI.table;
    case 'scatter':
      return PBI.scatter;
    default:
      return null;
  }
}

/** Segments of a stacked chart are added up: only counts and sums can be stacked. */
export const STACKABLE_KINDS: MeasureDef['kind'][] = ['count', 'countDistinct', 'sum'];

interface ConformCtx {
  foundation?: Foundation;
  /** Default time grain of the dashboard, for trend charts that have none. */
  timeGrain: DashboardSpec['timeGrain'];
  /** Optional reachability check (measure → field), e.g. from the engine at build time. */
  reaches?: (measureId: string, field: FieldRef) => boolean;
}

/**
 * Brings one component within the limits. Returns the note for the user when something changed
 * (the component is changed in place).
 */
export function conformComponent(c: DashComponent, ctx: ConformCtx): string | null {
  const label = (r: FieldRef) => fieldLabel(ctx.foundation, r).replace(/ Name$/, '');
  const kind = ctx.foundation?.measures.find((m) => m.id === c.measureIds[0])?.kind;
  const notes: string[] = [];

  // drill-down (decomposition tree): a two-level bar chart over its first two levels
  if (c.type === 'drilldown') {
    const levels = c.levels?.length ? c.levels : c.dimension ? [c.dimension] : [];
    c.type = 'bar';
    c.dimension = levels[0];
    c.subDimension = levels[1];
    c.levels = undefined;
    notes.push(`Power BI has no matching drill-down view, so it is a bar chart${levels[1] ? ` by ${label(levels[0])} › ${label(levels[1])}` : ''}.`);
  }
  // stacked: needs a series, and only counts and sums add up; otherwise bars side by side
  if (c.type === 'stacked' && !c.series) {
    c.type = 'bar';
    notes.push('A stacked chart needs a field to split the bars by, so it is a bar chart.');
  } else if (c.type === 'stacked' && kind && !STACKABLE_KINDS.includes(kind)) {
    c.type = 'bar';
    notes.push(`An average or rate can't be stacked (the segments would add up), so the ${label(c.series!)} values are shown side by side.`);
  }
  // horizontal bar / donut: one category only (Power BI's bar and donut take a single axis field)
  if ((c.type === 'hbar' || c.type === 'donut') && (c.subDimension || c.series || (!c.dimension && c.timeGrain))) {
    if (c.type === 'hbar' || !c.dimension) {
      c.type = 'bar';
      notes.push('Shown as a column chart, which can show more than one category level.');
    } else {
      c.subDimension = undefined;
      c.series = undefined;
      notes.push(`A donut shows one category, so it is split by ${label(c.dimension)} only.`);
    }
  }
  // trends: one line per measure over time (no series), on the dashboard's grain if none is set
  if (c.type === 'line' || c.type === 'area') {
    if (c.series) {
      c.series = undefined;
      notes.push('Trend lines are one line per measure, so the series split was removed.');
    }
    if (!c.timeGrain) c.timeGrain = ctx.timeGrain;
  }
  // scatter: needs two measures; with one, a bar chart of it by the same category
  if (c.type === 'scatter' && c.measureIds.length < 2) {
    c.type = 'bar';
    notes.push('A scatter plot needs two measures, so it is a bar chart.');
  }
  // series and inner levels must reach the measure (checked at build time, where the engine knows the joins)
  if (ctx.reaches) {
    for (const k of ['series', 'subDimension'] as const) {
      const f = c[k];
      if (f && c.measureIds[0] && !ctx.reaches(c.measureIds[0], f)) {
        c[k] = undefined;
        notes.push(`${label(f)} is not linked to this measure, so the chart is not split by it.`);
      }
    }
  }
  return notes.length ? notes.join(' ') : null;
}

export interface ConformResult {
  spec: DashboardSpec;
  /** One line per changed component: `"Title": what changed`. */
  notes: string[];
}

/** Brings every component of a design within the limits (returns a new spec). */
export function conformSpec(input: DashboardSpec, ctx: Omit<ConformCtx, 'timeGrain'>): ConformResult {
  const spec: DashboardSpec = structuredClone(input);
  const notes: string[] = [];
  for (const c of spec.pages.flatMap((p) => p.components)) {
    const n = conformComponent(c, { ...ctx, timeGrain: spec.timeGrain });
    if (n) notes.push(`"${c.title}": ${n}`);
  }
  return { spec, notes };
}
