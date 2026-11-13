import type { DashComponent, DashPage, DashboardSpec, FieldRef, Foundation } from '@/types';
import { CARD_TYPES, cardWeight } from '@/agents/designAgent';
import { PERIOD_LABELS } from '@/lib/dates';
import { fieldLabel } from '@/lib/fieldLabels';
import { CLIENT_THEME } from '@/dashboard/format';
import { LOGO_FILE } from './theme';
import { axisOf, isMatrix } from '@/lib/engine';
import { DATE_TABLE, PERIOD_COLUMN, PERIOD_PRESETS, PERIOD_TABLE, addFieldParameter, formatOf, type PbiModel } from './model';
import { daxCol, daxMeasure, daxString, pbirString, shortId } from './names';

/**
 * PBIR report definition (Power BI Project report folder, `definition/`) generated
 * from the approved dashboard specification: one page per dashboard page, one visual
 * per component, laid out on Celestra's 12-column grid, with the dashboard filters as
 * slicers synced across pages.
 */

export const SCHEMA = {
  visual: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.5.0/schema.json',
  page: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.0.0/schema.json',
  pages: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.0.0/schema.json',
  version: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json',
  report: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/3.1.0/schema.json',
} as const;

/** Theme compatibility stamp (the PBIR schema versions this report is written against). */
export const THEME_VERSION = { visual: '2.5.0', page: '2.0.0', report: '3.1.0' };

const PAGE_W = 1280;
const MARGIN = 16;
const GAP = 12;
const COL = (PAGE_W - 2 * MARGIN - 11 * GAP) / 12;
const span = (cols: number) => cols * COL + (cols - 1) * GAP;
const INNER = PAGE_W - 2 * MARGIN;

type Json = Record<string, unknown>;
const lit = (v: string) => ({ expr: { Literal: { Value: v } } });
const TRUE = lit('true');
const FALSE = lit('false');

interface FieldExpr {
  table: string;
  property: string;
  kind: 'Column' | 'Measure';
}
const fieldJson = (f: FieldExpr, source?: string): Json => ({ [f.kind]: { Expression: { SourceRef: source ? { Source: source } : { Entity: f.table } }, Property: f.property } });
const projection = (f: FieldExpr, displayName?: string): Json => ({ field: fieldJson(f), queryRef: `${f.table}.${f.property}`, nativeQueryRef: displayName ?? f.property, ...(displayName ? { displayName } : {}) });

interface Placed {
  name: string;
  json: Json;
}

interface Ctx {
  model: PbiModel;
  foundation: Foundation;
  spec: DashboardSpec;
  warnings: string[];
  page: DashPage;
  /** "Geo Level" field parameter, on pages that show the selector. */
  geo?: GeoParam;
}

interface GeoParam {
  /** display column of the parameter table (what the slicer and visuals reference) */
  param: FieldExpr;
  order: FieldExpr;
  fields: FieldRef[];
  labels: string[];
  defaultIndex: number;
}

/** Visual role: projections, plus the field parameter a projection comes from. */
interface Role {
  projections: Json[];
  fieldParameters?: Json[];
}

const queryRefOf = (f: FieldExpr) => `${f.table}.${f.property}`;
const followsGeo = (ctx: Ctx, ref?: FieldRef) => !!(ref && ctx.geo?.fields.includes(ref));

/** Role for category / series fields; a field that follows the Geo Level selector is projected through the field parameter. */
function role(ctx: Ctx, items: { f: FieldExpr; ref?: FieldRef }[], active = false): Role {
  const geoAt = items.findIndex((it) => followsGeo(ctx, it.ref));
  return {
    projections: items.map((it) => ({ ...projection(it.f), ...(active ? { active: true } : {}) })),
    ...(geoAt >= 0 ? { fieldParameters: [{ parameterExpr: fieldJson(ctx.geo!.param), index: geoAt, length: 1 }] } : {}),
  };
}

/** Title that names the selected geo level ("Closure Rate by Region (%)" → measure-driven text), else the static title. */
function titleOf(ctx: Ctx, c: DashComponent): string | Json {
  const g = ctx.geo;
  if (!g || !(followsGeo(ctx, c.dimension) || followsGeo(ctx, c.series))) return c.title;
  const label = g.labels[g.defaultIndex];
  const at = c.title.indexOf(label);
  const m = ctx.model.measureOf.get(c.measureIds[0]);
  if (at < 0 || !m) return c.title;
  const name = ctx.model.addMeasure(m.table, {
    name: `${c.title} – Title`,
    // the parameter's display column cannot be read on its own (it is grouped by the fields column), so go through the order column
    expression: `${daxString(c.title.slice(0, at))} & SWITCH(SELECTEDVALUE(${daxCol(g.order.table, g.order.property)}, ${g.defaultIndex}), ${g.labels.map((l, i) => `${i}, ${daxString(l)}`).join(', ')}) & ${daxString(c.title.slice(at + label.length))}`,
    description: `Title of "${c.title}", naming the selected geo level.`,
    displayFolder: 'Titles',
  });
  return { expr: fieldJson({ table: m.table, property: name, kind: 'Measure' }) };
}

// ───────────────────────────── field helpers ─────────────────────────────

function colField(ctx: Ctx, ref: FieldRef | undefined): FieldExpr | null {
  if (!ref) return null;
  const c = ctx.model.col(ref);
  return c ? { table: c.table, property: c.column, kind: 'Column' } : null;
}

function measureField(ctx: Ctx, id: string): FieldExpr | null {
  const m = ctx.model.measureOf.get(id);
  return m ? { table: m.table, property: m.name, kind: 'Measure' } : null;
}

/** Hidden numeric sort key added by the model for ordinal text columns (e.g. "0-7 days" … "30+ days"). */
function isOrdinalColumn(ctx: Ctx, f: FieldExpr) {
  return !!ctx.model.table(f.table)?.columns.find((c) => c.name === f.property)?.sortByColumn;
}

const titleObjects = (title: string | Json, subtitle?: string | Json): Json => ({
  title: [{ properties: { show: TRUE, text: typeof title === 'string' ? lit(pbirString(title)) : title } }],
  ...(subtitle ? { subTitle: [{ properties: { show: TRUE, text: typeof subtitle === 'string' ? lit(pbirString(subtitle)) : subtitle } }] } : {}),
});

function measureFilter(f: FieldExpr, op: 'gt' | 'gte', value: number): Json {
  const v = Number.isInteger(value) ? `${value}L` : `${value}D`;
  return {
    name: shortId(`flt:${f.table}:${f.property}:${op}:${value}`),
    field: fieldJson(f),
    type: 'Advanced',
    filter: { Version: 2, From: [{ Name: 'm', Entity: f.table, Type: 0 }], Where: [{ Condition: { Comparison: { ComparisonKind: op === 'gt' ? 1 : 2, Left: fieldJson(f, 'm'), Right: { Literal: { Value: v } } } } }] },
    howCreated: 'User',
  };
}

function topNFilter(category: FieldExpr, by: FieldExpr, n: number): Json {
  return {
    name: shortId(`top:${category.table}:${category.property}:${by.property}:${n}`),
    field: fieldJson(category),
    type: 'TopN',
    filter: {
      Version: 2,
      From: [
        {
          Name: 'subquery',
          Expression: {
            Subquery: {
              Query: {
                Version: 2,
                From: [
                  { Name: 'c', Entity: category.table, Type: 0 },
                  ...(by.table !== category.table ? [{ Name: 'm', Entity: by.table, Type: 0 }] : []),
                ],
                Select: [{ ...fieldJson(category, 'c'), Name: 'field' }],
                OrderBy: [{ Direction: 2, Expression: fieldJson(by, by.table !== category.table ? 'm' : 'c') }],
                Top: n,
              },
            },
          },
          Type: 2,
        },
        { Name: 'c', Entity: category.table, Type: 0 },
      ],
      Where: [{ Condition: { In: { Expressions: [fieldJson(category, 'c')], Table: { SourceRef: { Source: 'subquery' } } } } }],
    },
    howCreated: 'User',
  };
}

const sortBy = (f: FieldExpr, direction: 'Ascending' | 'Descending') => ({ sort: [{ field: fieldJson(f), direction }], isDefaultSort: false });

// ───────────────────────────── helper measures ─────────────────────────────

function fmtLiteral(ctx: Ctx, id: string) {
  return daxString(formatOf(ctx.model.measureOf.get(id)?.def));
}

/** Whether the reporting period changes a measure (master-data counts are not date-filtered). */
function isDated(ctx: Ctx, id: string, depth = 0): boolean {
  const m = ctx.model.measureOf.get(id);
  if (!m || depth > 5) return false;
  if (m.def.kind === 'ratio') return isDated(ctx, m.def.numeratorId ?? '', depth + 1) || isDated(ctx, m.def.denominatorId ?? '', depth + 1);
  return !!ctx.model.table(m.table)?.dateColumn;
}

/** "+4.2% vs prev. 1,234" text measure for a KPI card subtitle (current vs the immediately preceding period of equal length). */
function comparisonMeasure(ctx: Ctx, id: string): FieldExpr | null {
  const m = ctx.model.measureOf.get(id);
  if (!m || !ctx.model.hasDates || !isDated(ctx, id)) return null;
  const cur = daxMeasure(m.name);
  const date = daxCol(DATE_TABLE, 'Date');
  const prevName = ctx.model.addMeasure(m.table, {
    name: `${m.name} (Previous Period)`,
    expression: `VAR _min = MIN(${date}) VAR _max = MAX(${date}) VAR _len = _max - _min + 1 RETURN IF(ISCROSSFILTERED('${DATE_TABLE}'), CALCULATE(${cur}, REMOVEFILTERS('${PERIOD_TABLE}'), REMOVEFILTERS('${DATE_TABLE}'), DATESBETWEEN(${date}, _min - _len, _max - _len)))`,
    formatString: formatOf(m.def),
    description: `${m.name} in the period of equal length immediately before the selected one (blank for all time).`,
    displayFolder: 'Period comparison',
  });
  const pct = m.def.format === 'percent';
  const delta = pct ? '(_cur - _prev) * 100' : 'DIVIDE(_cur - _prev, ABS(_prev)) * 100';
  const name = ctx.model.addMeasure(m.table, {
    name: `${m.name} vs Previous Period`,
    expression: `VAR _cur = ${cur} VAR _prev = ${daxMeasure(prevName)} RETURN IF(NOT ISBLANK(_prev) && _prev <> 0, FORMAT(${delta}, "+0.0;-0.0;0.0") & ${daxString(pct ? ' pts' : '%')} & " vs prev. " & FORMAT(_prev, ${fmtLiteral(ctx, id)}), "Selected period")`,
    description: `Change in ${m.name} against the previous period, as shown under the KPI card.`,
    displayFolder: 'Period comparison',
  });
  return { table: m.table, property: name, kind: 'Measure' };
}

/** Highest / lowest category of a measure as text ("Northeast · 54.2%"), mirroring the engine's tie-break. */
function extremeMeasure(ctx: Ctx, c: DashComponent, which: 'high' | 'low', withValue = true): FieldExpr | null {
  const m = ctx.model.measureOf.get(c.measureIds[0]);
  const d = colField(ctx, c.dimension);
  if (!m || !d) return null;
  const expr = (f: FieldExpr) => {
    const dc = daxCol(f.table, f.property);
    const order = which === 'high' ? `[@v], DESC, ${dc}, ASC` : `[@v], ASC, ${dc}, DESC`;
    const label = withValue ? `MAXX(_top, ${dc}) & " · " & FORMAT(MAXX(_top, [@v]), ${fmtLiteral(ctx, c.measureIds[0])})` : `MAXX(_top, ${dc})`;
    return `VAR _t = FILTER(ADDCOLUMNS(FILTER(VALUES(${dc}), NOT ISBLANK(${dc})), "@v", ${daxMeasure(m.name)}), NOT ISBLANK([@v])) VAR _top = TOPN(1, _t, ${order}) RETURN IF(NOT ISEMPTY(_top), ${label})`;
  };
  // following the Geo Level selector: one branch per level
  const g = followsGeo(ctx, c.dimension) ? ctx.geo! : null;
  const levels = g ? g.fields.map((r) => colField(ctx, r)) : [];
  const expression = g && levels.every(Boolean) ? `SWITCH(SELECTEDVALUE(${daxCol(g.order.table, g.order.property)}, ${g.defaultIndex}), ${levels.map((f, i) => `${i}, (${expr(f!)})`).join(', ')})` : expr(d);
  const name = ctx.model.addMeasure(m.table, {
    name: `${c.title} – ${withValue ? (which === 'high' ? 'Highest' : 'Lowest') : `Top ${d.property}`}`,
    expression,
    description: `${which === 'high' ? 'Highest' : 'Lowest'} ${g ? 'geography (selected geo level)' : d.property} by ${m.name} (scorecard card "${c.title}").`,
    displayFolder: 'Scorecard',
  });
  return { table: m.table, property: name, kind: 'Measure' };
}

/** Attribute of the top category (e.g. the top prescriber's institution). */
function topAttributeMeasure(ctx: Ctx, c: DashComponent, top: FieldExpr): FieldExpr | null {
  const d = colField(ctx, c.dimension);
  const a = colField(ctx, c.topOnly);
  const m = ctx.model.measureOf.get(c.measureIds[0]);
  if (!d || !a || !m) return null;
  let value: string;
  if (a.table === d.table) value = `CALCULATE(MIN(${daxCol(a.table, a.property)}), REMOVEFILTERS(${daxCol(d.table, d.property)}), ${daxCol(d.table, d.property)} = _name)`;
  else if (activePath(ctx.model, d.table, a.table)) value = `MINX(FILTER(ALL(${daxTableRef(d.table)}), ${daxCol(d.table, d.property)} = _name), RELATED(${daxCol(a.table, a.property)}))`;
  else {
    ctx.warnings.push(`"${c.title}": ${a.property} is not reachable from ${d.property} through an active relationship, so only the top ${d.property} is shown.`);
    return null;
  }
  const name = ctx.model.addMeasure(m.table, {
    name: `${c.title} – ${a.property}`,
    expression: `VAR _name = ${daxMeasure(top.property)} RETURN IF(NOT ISBLANK(_name), ${value})`,
    description: `${a.property} of the top ${d.property} (scorecard card "${c.title}").`,
    displayFolder: 'Scorecard',
  });
  return { table: m.table, property: name, kind: 'Measure' };
}

const daxTableRef = (t: string) => `'${t.replace(/'/g, "''")}'`;

/** Whether `from` reaches `to` through active many-to-one relationships (so RELATED works). */
function activePath(model: PbiModel, from: string, to: string, seen = new Set<string>()): boolean {
  if (from === to) return true;
  seen.add(from);
  return model.relationships.some((r) => r.isActive && !r.toMany && r.fromTable === from && !seen.has(r.toTable) && activePath(model, r.toTable, to, seen));
}

/** Priority flags for a table row: two flags for the top 10% of rows in view, one for the next 25% (or explicit thresholds). */
function flagMeasure(ctx: Ctx, c: DashComponent): FieldExpr | null {
  const m = ctx.model.measureOf.get(c.measureIds[0]);
  const d = colField(ctx, c.dimension);
  if (!m || !d) return null;
  const v = daxMeasure(m.name);
  const dc = daxCol(d.table, d.property);
  const hi = c.flags?.high != null ? String(c.flags.high) : `MAX(2, MINX(TOPN(MIN(_n - 1, INT(_n * 0.1)) + 1, _t, [@v], DESC), [@v]))`;
  const med = c.flags?.medium != null ? String(c.flags.medium) : `MAX(1, MINX(TOPN(MIN(_n - 1, INT(_n * 0.35)) + 1, _t, [@v], DESC), [@v]))`;
  const name = ctx.model.addMeasure(m.table, {
    name: `${c.title} – Priority Flag`,
    expression: `VAR _v = ${v} VAR _t = FILTER(ADDCOLUMNS(ALLSELECTED(${dc}), "@v", ${v}), [@v] > 0) VAR _n = COUNTROWS(_t) VAR _hi = ${hi} VAR _med = ${med} RETURN IF(_v > 0, IF(_v >= _hi, "⚑⚑", IF(_v >= _med, "⚑")))`,
    description: `Priority flags for "${c.title}": two flags for the top 10% of ${d.property} by ${m.name}, one flag for the next 25%.`,
    displayFolder: 'Scorecard',
  });
  return { table: m.table, property: name, kind: 'Measure' };
}

// ───────────────────────────── visuals ─────────────────────────────

interface VisualSpec {
  visual: Json;
  filters?: Json[];
}

function chart(visualType: string, queryState: Json, objects: Json, title: string | Json, subtitle?: string, sort?: Json): Json {
  return {
    visualType,
    query: { queryState, ...(sort ? { sortDefinition: sort } : {}) },
    objects,
    visualContainerObjects: titleObjects(title, subtitle),
    drillFilterOtherVisuals: true,
  };
}

const state = (roles: Record<string, Json[] | Role>) =>
  Object.fromEntries(Object.entries(roles).map(([k, p]) => [k, Array.isArray(p) ? { projections: p } : p] as const).filter(([, p]) => p.projections.length));
const labelsOn = { labels: [{ properties: { show: TRUE } }] };

function componentVisual(ctx: Ctx, c: DashComponent): VisualSpec | null {
  const measures = c.measureIds.map((id) => measureField(ctx, id)).filter((x): x is FieldExpr => !!x);
  const missing = c.measureIds.length - measures.length;
  if (!measures.length) {
    ctx.warnings.push(`"${c.title}" (${ctx.page.name}) was skipped: its measures could not be exported.`);
    return null;
  }
  if (missing) ctx.warnings.push(`"${c.title}" (${ctx.page.name}): ${missing} measure(s) could not be exported and were left out.`);
  const sub = c.description || undefined;
  const title = titleOf(ctx, c);
  if (isMatrix(c)) return matrixVisual(ctx, c, measures[0], title, sub);
  const dim = colField(ctx, c.dimension);
  const needsDim = ['bar', 'hbar', 'donut', 'stacked', 'table', 'extremes', 'scatter'].includes(c.type);
  if (needsDim && !dim) {
    ctx.warnings.push(`"${c.title}" (${ctx.page.name}) was skipped: its category field is not in the model.`);
    return null;
  }
  const catRole = (ref: FieldRef | undefined, f: FieldExpr) => role(ctx, [{ f, ref }]);
  const threshold = (f: FieldExpr) => {
    if (!c.threshold) return [];
    const pct = ctx.model.measureOf.get(c.measureIds[0])?.def.format === 'percent';
    return [measureFilter(f, c.threshold.op, pct ? c.threshold.value / 100 : c.threshold.value)];
  };
  switch (c.type) {
    case 'kpi': {
      const cmp = c.comparison !== false ? comparisonMeasure(ctx, c.measureIds[0]) : null;
      return {
        visual: {
          visualType: 'card',
          query: { queryState: state({ Values: [projection(measures[0])] }) },
          objects: { categoryLabels: [{ properties: { show: FALSE } }] },
          visualContainerObjects: titleObjects(c.title, cmp ? { expr: fieldJson(cmp) } : undefined),
          drillFilterOtherVisuals: true,
        },
      };
    }
    case 'kpiGroup': {
      if (dim) {
        // one value per category, side by side like the app's card: a one-row matrix with the categories as columns
        const objects = {
          columnHeaders: [{ properties: { fontSize: lit('9D'), alignment: lit("'Left'"), wordWrap: TRUE } }],
          values: [{ properties: { fontSize: lit('16D'), fontFamily: lit("'Segoe UI Semibold'") } }],
          subTotals: [{ properties: { rowSubtotals: FALSE, columnSubtotals: FALSE } }],
          grid: [{ properties: { gridVertical: TRUE, gridHorizontal: FALSE } }],
        };
        return { visual: chart('pivotTable', state({ Columns: catRole(c.dimension, dim), Values: [projection(measures[0], ' ')] }), objects, title, sub, isOrdinalColumn(ctx, dim) ? sortBy(dim, 'Ascending') : sortBy(measures[0], 'Descending')) };
      }
      const values = measures.map((m, i) => projection(m, c.labels?.[i] ?? m.property));
      return { visual: chart('multiRowCard', state({ Values: values }), {}, c.title, sub) };
    }
    case 'extremes': {
      if (c.topOnly) {
        const top = extremeMeasure(ctx, c, 'high');
        if (!top) return null;
        const attr = topAttributeMeasure(ctx, c, extremeMeasure(ctx, c, 'high', false)!);
        const values = [projection(top, fieldLabel(ctx.foundation, c.dimension!)), ...(attr ? [projection(attr, fieldLabel(ctx.foundation, c.topOnly))] : [])];
        return { visual: chart('multiRowCard', state({ Values: values }), {}, c.title, sub) };
      }
      const hi = extremeMeasure(ctx, c, 'high');
      const lo = extremeMeasure(ctx, c, 'low');
      if (!hi || !lo) return null;
      const values = c.lowIsBest ? [projection(lo, 'Fastest'), projection(hi, 'Slowest')] : [projection(hi, 'Highest'), projection(lo, 'Lowest')];
      return { visual: chart('multiRowCard', state({ Values: values }), {}, title, sub) };
    }
    case 'bar':
    case 'hbar':
    case 'donut': {
      const type = c.type === 'bar' ? 'clusteredColumnChart' : c.type === 'hbar' ? 'clusteredBarChart' : 'donutChart';
      const sort = isOrdinalColumn(ctx, dim!) ? sortBy(dim!, 'Ascending') : sortBy(measures[0], 'Descending');
      return {
        visual: chart(type, state({ Category: catRole(c.dimension, dim!), Y: [projection(measures[0])] }), c.type === 'donut' ? {} : labelsOn, title, sub, sort),
        filters: [...(c.topN ? [topNFilter(dim!, measures[0], c.topN)] : []), ...threshold(measures[0])],
      };
    }
    case 'stacked': {
      const series = colField(ctx, c.series);
      // Power BI's internal name for the stacked column chart is "columnChart" ("clusteredColumnChart" is side by side)
      return { visual: chart('columnChart', state({ Category: catRole(c.dimension, dim!), Series: series ? catRole(c.series, series) : [], Y: [projection(measures[0])] }), {}, title, sub, isOrdinalColumn(ctx, dim!) ? sortBy(dim!, 'Ascending') : undefined) };
    }
    case 'line':
    case 'area': {
      if (!ctx.model.hasDates) {
        ctx.warnings.push(`"${c.title}" was skipped: the data has no activity dates.`);
        return null;
      }
      const grain = c.timeGrain ?? ctx.spec.timeGrain;
      const axis: FieldExpr = { table: DATE_TABLE, property: grain === 'week' ? 'Week Start' : grain === 'quarter' ? 'Quarter' : 'Month', kind: 'Column' };
      return { visual: chart(c.type === 'line' ? 'lineChart' : 'areaChart', state({ Category: [projection(axis)], Y: measures.map((m) => projection(m)) }), {}, c.title, sub, sortBy(axis, 'Ascending')) };
    }
    case 'funnel':
      // one bar per stage measure (Power BI's funnel visual needs a single measure split by a category)
      return { visual: chart('clusteredBarChart', state({ Y: measures.map((m) => projection(m)) }), labelsOn, c.title, sub) };
    case 'scatter': {
      if (measures.length < 2) return null;
      const series = colField(ctx, c.series);
      return { visual: chart('scatterChart', state({ Category: catRole(c.dimension, dim!), Series: series ? catRole(c.series, series) : [], X: [projection(measures[0])], Y: [projection(measures[1])] }), { categoryLabels: [{ properties: { show: TRUE } }], ...(series ? { legend: [{ properties: { show: TRUE, position: lit("'Bottom'") } }] } : {}) }, title, sub) };
    }
    case 'table': {
      const attrs = (c.tableColumns ?? []).map((r) => colField(ctx, r)).filter((x): x is FieldExpr => !!x);
      const flags = c.flags ? flagMeasure(ctx, c) : null;
      const days = attrs.find((a) => /days/i.test(a.property));
      return {
        visual: chart('tableEx', state({ Values: [projection(dim!), ...attrs.map((a) => projection(a)), ...measures.map((m) => projection(m)), ...(flags ? [projection(flags, 'Priority Flag')] : [])] }), {}, c.title, sub, sortBy(days ?? measures[0], 'Descending')),
        filters: threshold(measures[0]),
      };
    }
    case 'records': {
      const cols = (c.tableColumns ?? []).map((r) => colField(ctx, r)).filter((x): x is FieldExpr => !!x);
      if (!cols.length) return null;
      const sortCol = colField(ctx, c.sortBy);
      // the list shows the rows behind the measure: rows where it is blank (other status, outside the period) are filtered out
      return {
        visual: chart('tableEx', state({ Values: cols.map((x) => projection(x)) }), {}, c.title, sub, sortCol ? sortBy(sortCol, 'Descending') : undefined),
        filters: [measureFilter(measures[0], 'gt', 0)],
      };
    }
    case 'drilldown': {
      const levels = (c.levels ?? (c.dimension ? [c.dimension] : [])).map((r) => colField(ctx, r)).filter((x): x is FieldExpr => !!x);
      if (!levels.length) return null;
      return { visual: chart('decompositionTreeVisual', state({ Analyze: [projection(measures[0])], ExplainBy: levels.map((l) => projection(l)) }), {}, c.title, sub) };
    }
  }
  return null;
}

/**
 * Bar / stacked chart with a two-level axis (period or field › field) and/or a series: the levels go into Category,
 * expanded down so both show (Power BI draws the outer level as group labels under the inner one).
 */
function matrixVisual(ctx: Ctx, c: DashComponent, measure: FieldExpr, title: string | Json, sub?: string): VisualSpec | null {
  const items: { f: FieldExpr; ref?: FieldRef }[] = [];
  let time = false;
  for (const a of axisOf(c)) {
    if ('grain' in a) {
      if (!ctx.model.hasDates) {
        ctx.warnings.push(`"${c.title}" (${ctx.page.name}) was skipped: the data has no activity dates.`);
        return null;
      }
      time = true;
      items.push({ f: { table: DATE_TABLE, property: a.grain === 'week' ? 'Week Start' : a.grain === 'quarter' ? 'Quarter' : 'Month', kind: 'Column' } });
    } else {
      const f = colField(ctx, a.field);
      if (!f) {
        ctx.warnings.push(`"${c.title}" (${ctx.page.name}) was skipped: its category field is not in the model.`);
        return null;
      }
      items.push({ f, ref: a.field });
    }
  }
  const series = c.series ? colField(ctx, c.series) : null;
  if (c.series && !series) ctx.warnings.push(`"${c.title}" (${ctx.page.name}): its series field is not in the model, so it shows one bar per category.`);
  const stacked = c.type === 'stacked';
  const visual = chart(
    stacked ? 'columnChart' : 'clusteredColumnChart',
    state({ Category: role(ctx, items, items.length > 1), Series: series ? role(ctx, [{ f: series, ref: c.series }]) : [], Y: [projection(measure)] }),
    { ...(time ? { categoryAxis: [{ properties: { axisType: lit("'Categorical'") } }] } : {}), ...(stacked ? labelsOn : {}), ...(series ? { legend: [{ properties: { show: TRUE, position: lit("'Bottom'") } }] } : {}) },
    title,
    sub,
    sortBy(items[0].f, 'Ascending'),
  );
  if (items.length > 1)
    visual.expansionStates = [
      {
        roles: ['Category'],
        levels: items.map((it, i) => ({ queryRefs: [queryRefOf(it.f)], ...(i < items.length - 1 ? { isCollapsed: true, identityKeys: [fieldJson(it.f)] } : {}), isPinned: true })),
        root: {},
      },
    ];
  return { visual };
}

function slicer(field: FieldExpr, opts: { mode: 'Dropdown' | 'Between'; single?: boolean; selected?: string; header?: string; selectOn?: FieldExpr }): Json {
  const general: Json = {};
  // a field parameter's selection is stored on its (hidden) fields column, as the NAMEOF() text
  const on = opts.selectOn ?? field;
  if (opts.selected)
    general.filter = {
      filter: {
        Version: 2,
        From: [{ Name: 's', Entity: on.table, Type: 0 }],
        Where: [{ Condition: { In: { Expressions: [fieldJson(on, 's')], Values: [[{ Literal: { Value: pbirString(opts.selected) } }]] } } }],
      },
    };
  return {
    visualType: 'slicer',
    query: { queryState: state({ Values: [projection(field, opts.header)] }) },
    objects: {
      data: [{ properties: { mode: lit(pbirString(opts.mode)) } }],
      // the header names the filter (the app's filter labels, e.g. "Custom Date")
      ...(opts.header ? { header: [{ properties: { show: TRUE, text: lit(pbirString(opts.header)) } }] } : {}),
      ...(opts.single ? { selection: [{ properties: { singleSelect: TRUE } }] } : {}),
      ...(Object.keys(general).length ? { general: [{ properties: general }] } : {}),
    },
    syncGroup: { groupName: `${field.table}.${field.property}`, fieldChanges: true, filterChanges: true },
    drillFilterOtherVisuals: true,
  };
}

/** Image visual showing a registered resource of the report (the client logo). */
function image(item: string): Json {
  return {
    visualType: 'image',
    objects: {
      general: [{ properties: { imageUrl: { expr: { ResourcePackageItem: { PackageName: 'RegisteredResources', PackageType: 1, ItemName: item } } } } }],
      imageScaling: [{ properties: { imageScalingType: lit("'Fit'") } }],
    },
    visualContainerObjects: { title: [{ properties: { show: FALSE } }], background: [{ properties: { show: FALSE } }], border: [{ properties: { show: FALSE } }] },
    drillFilterOtherVisuals: true,
  };
}

function textbox(paragraphs: { text: string; size: number; bold?: boolean; color?: string }[]): Json {
  return {
    visualType: 'textbox',
    objects: {
      general: [{ properties: { paragraphs: paragraphs.map((p) => ({ textRuns: [{ value: p.text, textStyle: { fontSize: `${p.size}pt`, ...(p.bold ? { fontWeight: 'bold' } : {}), color: p.color ?? CLIENT_THEME.ink } }] })) } }],
    },
    drillFilterOtherVisuals: true,
  };
}

const HEIGHT: Partial<Record<DashComponent['type'], number>> = { kpi: 112, kpiGroup: 124, extremes: 124, hbar: 340, stacked: 320, scatter: 340, table: 420, records: 460, drilldown: 420 };

// ───────────────────────────── pages ─────────────────────────────

function buildPage(ctx: Ctx, index: number): { name: string; files: Record<string, Json>; height: number } {
  const page = ctx.page;
  const pageName = shortId(`page:${index}:${page.id}`);
  const visuals: Placed[] = [];
  const interactions: Json[] = [];
  let z = 0;
  const place = (key: string, json: Json, pos: { x: number; y: number; width: number; height: number }, filters?: Json[]) => {
    const name = shortId(`visual:${pageName}:${key}:${visuals.length}`);
    visuals.push({
      name,
      json: {
        $schema: SCHEMA.visual,
        name,
        position: { ...pos, z: (z += 1000), tabOrder: z },
        visual: json,
        ...(filters?.length ? { filterConfig: { filters } } : {}),
      },
    });
    return name;
  };

  // header: client logo, page title + description
  let y = MARGIN;
  const LOGO_W = 150;
  place('logo', image(LOGO_FILE), { x: MARGIN, y: y + 4, width: LOGO_W, height: 40 });
  place('title', textbox([{ text: page.name, size: 18, bold: true, color: CLIENT_THEME.primary }, ...(page.description ? [{ text: page.description, size: 10, color: CLIENT_THEME.muted }] : [])]), { x: MARGIN + LOGO_W + GAP, y, width: INNER - LOGO_W - GAP, height: page.description ? 64 : 44 });
  y += (page.description ? 64 : 48) + 8;

  // slicer bar: reporting period, date range and the dashboard filters (synced across pages)
  const slicers: { json: Json; width: number }[] = [];
  if (ctx.geo) {
    const def = colField(ctx, ctx.geo.fields[ctx.geo.defaultIndex]);
    const fieldsCol: FieldExpr = { table: ctx.geo.param.table, property: `${ctx.geo.param.property} Fields`, kind: 'Column' };
    slicers.push({ json: slicer(ctx.geo.param, { mode: 'Dropdown', single: true, header: 'Geo Level', ...(def ? { selected: daxCol(def.table, def.property), selectOn: fieldsCol } : {}) }), width: 170 });
  }
  if (ctx.model.hasDates) {
    const preset = PERIOD_PRESETS.includes(ctx.spec.defaultPeriod) ? PERIOD_LABELS[ctx.spec.defaultPeriod] : undefined;
    slicers.push({ json: slicer({ table: PERIOD_TABLE, property: PERIOD_COLUMN, kind: 'Column' }, { mode: 'Dropdown', single: true, selected: preset, header: 'Time Period' }), width: 220 });
    slicers.push({ json: slicer({ table: DATE_TABLE, property: 'Date', kind: 'Column' }, { mode: 'Between', header: 'Custom Date' }), width: 260 });
  }
  for (const fd of ctx.spec.filters) {
    const f = fd.type === 'multi' ? colField(ctx, fd.field) : null;
    if (fd.type === 'multi' && !f) ctx.warnings.push(`Filter "${fd.label}" was skipped: its field is not in the model.`);
    if (f) slicers.push({ json: slicer(f, { mode: 'Dropdown', header: fd.label || undefined }), width: 190 });
  }
  let x = MARGIN;
  // tall enough for the header plus the date boxes of the Custom Date (between) slicer
  const SLICER_H = 76;
  for (const s of slicers) {
    if (x + s.width > PAGE_W - MARGIN) {
      x = MARGIN;
      y += SLICER_H + 8;
    }
    place('slicer', s.json, { x, y, width: s.width, height: SLICER_H });
    x += s.width + GAP;
  }
  if (slicers.length) y += SLICER_H + GAP;

  // components: section headings, rows of cards, then the 12-column grid
  let section: string | undefined;
  let row: { c: DashComponent; v: VisualSpec }[] = [];
  let cards: { c: DashComponent; v: VisualSpec }[] = [];
  const toggles: { slicer: string; list: string }[] = [];
  const toggleField = (c: DashComponent) => {
    const tf = c.type === 'records' ? c.toggle?.filter[0] : undefined;
    const ds = ctx.model.measureOf.get(c.measureIds[0])?.def.datasetId;
    return tf && ds ? colField(ctx, `${ds}::${tf.field}`) : null;
  };
  const flushRow = () => {
    if (!row.length) return;
    let cx = MARGIN;
    let bottom = y;
    for (const r of row) {
      const w = span(r.c.width);
      const h = HEIGHT[r.c.type] ?? 300;
      const tf = toggleField(r.c);
      let top = y;
      let sName: string | undefined;
      if (tf) {
        // the case-list toggle becomes a slicer above the list that only narrows the list
        sName = place('toggle', slicer(tf, { mode: 'Dropdown', header: r.c.toggle!.label.replace(/ only$/i, '') }), { x: cx, y, width: 220, height: SLICER_H });
        top += SLICER_H + 8;
      }
      const name = place(r.c.id, r.v.visual, { x: cx, y: top, width: w, height: h }, r.v.filters);
      if (sName) toggles.push({ slicer: sName, list: name });
      bottom = Math.max(bottom, top + h);
      cx += w + GAP;
    }
    y = bottom + GAP;
    row = [];
  };
  const flushCards = () => {
    if (!cards.length) return;
    // flex-wrap like the app: a line holds cards while their minimum widths fit, then shares the width by weight
    const lines: (typeof cards)[] = [[]];
    let used = 0;
    for (const k of cards) {
      const min = cardWeight(k.c) * 150 + 20;
      if (lines[lines.length - 1].length && used + min + GAP > INNER) {
        lines.push([]);
        used = 0;
      }
      lines[lines.length - 1].push(k);
      used += min + GAP;
    }
    for (const line of lines) {
      const total = line.reduce((s, k) => s + cardWeight(k.c), 0);
      const free = INNER - GAP * (line.length - 1);
      let cx = MARGIN;
      const h = Math.max(...line.map((k) => HEIGHT[k.c.type] ?? 112));
      for (const k of line) {
        const w = Math.floor((free * cardWeight(k.c)) / total);
        place(k.c.id, k.v.visual, { x: cx, y, width: w, height: h }, k.v.filters);
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
      place('section', textbox([{ text: c.section.toUpperCase(), size: 11, bold: true, color: CLIENT_THEME.primary }]), { x: MARGIN, y, width: INNER, height: 32 });
      y += 32 + 4;
    }
    const v = componentVisual(ctx, c);
    if (!v) continue;
    if (CARD_TYPES.includes(c.type)) {
      flushRow();
      cards.push({ c, v });
      continue;
    }
    flushCards();
    const usedCols = row.reduce((s, r) => s + r.c.width, 0);
    if (usedCols + c.width > 12) flushRow();
    row.push({ c, v });
  }
  flushCards();
  flushRow();
  for (const t of toggles) for (const v of visuals) if (v.name !== t.slicer && v.name !== t.list) interactions.push({ source: t.slicer, target: v.name, type: 'NoFilter' });

  const height = Math.max(720, Math.ceil(y + MARGIN));
  const files: Record<string, Json> = {
    [`pages/${pageName}/page.json`]: {
      $schema: SCHEMA.page,
      name: pageName,
      displayName: page.name.slice(0, 100),
      displayOption: 'FitToWidth',
      height,
      width: PAGE_W,
      ...(interactions.length ? { visualInteractions: interactions } : {}),
    },
  };
  for (const v of visuals) files[`pages/${pageName}/visuals/${v.name}/visual.json`] = v.json;
  return { name: pageName, files, height };
}

export function buildReport(model: PbiModel, spec: DashboardSpec, foundation: Foundation): { files: Record<string, Json>; warnings: string[] } {
  const warnings: string[] = [];
  const files: Record<string, Json> = {};
  const pageNames: string[] = [];
  // "Geo Level" selector → field parameter (Region / Territory …)
  let geo: GeoParam | undefined;
  if (spec.geoLevels) {
    const labels = spec.geoLevels.fields.map((r) => fieldLabel(foundation, r).replace(/ Name$/, ''));
    const p = addFieldParameter(model, 'Geo Level', spec.geoLevels.fields.map((ref, i) => ({ label: labels[i], ref })));
    if (p) geo = { param: { table: p.table, property: p.display, kind: 'Column' }, order: { table: p.table, property: p.order, kind: 'Column' }, fields: spec.geoLevels.fields, labels, defaultIndex: Math.max(0, spec.geoLevels.fields.indexOf(spec.geoLevels.default)) };
    else warnings.push('The Geo Level selector was not exported: one of its fields is not in the model.');
  }
  spec.pages.forEach((page, i) => {
    const p = buildPage({ model, foundation, spec, warnings, page, geo: geo && spec.geoLevels!.pages.includes(page.id) ? geo : undefined }, i);
    pageNames.push(p.name);
    Object.assign(files, p.files);
  });
  files['pages/pages.json'] = { $schema: SCHEMA.pages, pageOrder: pageNames, activePageName: pageNames[0] };
  return { files, warnings };
}
