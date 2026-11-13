import { deflateSync } from 'fflate';
import type { Cell, DatasetProfile, FieldRef, Foundation, MeasureCondition, MeasureDef, PeriodPreset, Relationship, Row } from '@/types';
import { isOrdinal, splitRef } from '@/lib/engine';
import { PERIOD_LABELS, parseDate, resolvePeriod, toIsoDate } from '@/lib/dates';
import { conditionsOf, describe as describeCond } from '@/lib/conditions';
import { fieldIncluded, fieldLabel } from '@/lib/fieldLabels';
import { NameRegistry, cleanName, daxCol, daxMeasure, daxString, daxTable, mString } from './names';

/**
 * Semantic model for the Power BI export, built from Celestra's data understanding
 * (profiles + relationships), reporting foundation (tables, field mapping, measures)
 * and the ingested rows. Serialised to TMDL by `tmdl.ts`.
 *
 * Data is embedded in each table's Power Query as deflate-compressed JSON, so the
 * project refreshes offline with no file paths or credentials.
 */

export type PbiDataType = 'string' | 'int64' | 'double' | 'dateTime' | 'boolean';

export interface PbiColumn {
  name: string;
  dataType: PbiDataType;
  /** Source column in the dataset rows (null for generated tables). */
  source: string | null;
  hidden?: boolean;
  description?: string;
  formatString?: string;
  sortByColumn?: string;
  /** Field parameter: the column whose values group this one (the display column of the parameter). */
  groupByColumn?: string;
  /** Field parameter: this column holds the NAMEOF() field references. */
  parameterFields?: boolean;
}

export interface PbiMeasure {
  name: string;
  expression: string;
  formatString?: string;
  description?: string;
  displayFolder?: string;
  /** Celestra measure id this was generated from. */
  measureId?: string;
}

export interface PbiTable {
  name: string;
  datasetId: string | null;
  description: string;
  columns: PbiColumn[];
  measures: PbiMeasure[];
  /** Power Query (M) expression of the import partition, or the DAX expression of a calculated table. */
  source: string;
  /** The partition is a DAX calculated table (field parameters), not a Power Query import. */
  calculated?: boolean;
  /** Column filtered by the reporting period (activity tables). */
  dateColumn?: string;
  kind: 'fact' | 'dimension' | 'date' | 'period' | 'parameter';
}

/**
 * Field parameter (e.g. "Geo Level": Region / Territory): a calculated table whose selection swaps the field a visual
 * groups by. Columns: display name, NAMEOF() field reference, order. Returns the table name, or null when a field is not in the model.
 */
export function addFieldParameter(model: PbiModel, name: string, fields: { label: string; ref: FieldRef }[]): { table: string; display: string; order: string } | null {
  const cols = fields.map((f) => ({ label: f.label, col: model.col(f.ref) }));
  if (cols.some((c) => !c.col)) return null;
  const table = model.names.take(cleanName(name, 'Parameter'), ' (Parameter)');
  const display = table;
  const fieldsCol = `${table} Fields`;
  const order = `${table} Order`;
  model.tables.push({
    name: table,
    datasetId: null,
    description: `Field parameter: choose which field the visuals group by (${fields.map((f) => f.label).join(' / ')}).`,
    kind: 'parameter',
    calculated: true,
    columns: [
      { name: display, dataType: 'string', source: '[Value1]', sortByColumn: order, groupByColumn: fieldsCol },
      { name: fieldsCol, dataType: 'string', source: '[Value2]', hidden: true, sortByColumn: order, parameterFields: true },
      { name: order, dataType: 'int64', source: '[Value3]', hidden: true, formatString: '0' },
    ],
    measures: [],
    source: ['{', cols.map((c, i) => `\t(${daxString(c.label)}, NAMEOF(${daxCol(c.col!.table, c.col!.column)}), ${i})`).join(',\n'), '}'].join('\n'),
  });
  return { table, display, order };
}

export interface PbiRelationship {
  key: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  isActive: boolean;
  /** Many-to-many: the "one" side has duplicate keys in the data. */
  toMany: boolean;
  bothDirections: boolean;
  /** Celestra relationship id (absent for generated date relationships). */
  relationshipId?: string;
  note?: string;
}

export interface ExportInput {
  name: string;
  profiles: DatasetProfile[];
  relationships: Relationship[];
  foundation: Foundation;
  rowsOf: (id: string) => Row[];
  /** Latest / earliest activity date (the engine's period anchor), epoch ms. */
  anchor: number;
  minDate: number;
}

export const DATE_TABLE = 'Dim_Date';
export const PERIOD_TABLE = 'Reporting Period';
export const PERIOD_COLUMN = 'Reporting Period';
/** Period presets offered by the period slicer ("all" = no selection, "custom" = the date range slicer). */
export const PERIOD_PRESETS: PeriodPreset[] = ['last4w', 'r13w', 'last6m', 'ytd', 'last12m'];

export class PbiModel {
  tables: PbiTable[] = [];
  relationships: PbiRelationship[] = [];
  warnings: string[] = [];
  /** dataset id → table name */
  readonly tableOf = new Map<string, string>();
  /** field ref → column name */
  private readonly columnOf = new Map<FieldRef, string>();
  /** Celestra measure id → model measure (table + name) */
  readonly measureOf = new Map<string, { table: string; name: string; def: MeasureDef }>();
  /** Every table, column and measure name (measures must not collide with any of them). */
  readonly names = new NameRegistry();
  hasDates = false;

  table(name: string) {
    return this.tables.find((t) => t.name === name);
  }

  /** Table + column a Celestra field reference maps to. */
  col(ref: FieldRef): { table: string; column: string } | null {
    const { datasetId } = splitRef(ref);
    const table = this.tableOf.get(datasetId);
    const column = this.columnOf.get(ref);
    return table && column ? { table, column } : null;
  }

  column(ref: FieldRef): PbiColumn | undefined {
    const c = this.col(ref);
    return c ? this.table(c.table)?.columns.find((x) => x.name === c.column) : undefined;
  }

  /** Adds a measure to a table under a model-unique name; returns the name used. */
  addMeasure(table: string, m: PbiMeasure): string {
    const t = this.table(table);
    if (!t) throw new Error(`Unknown table ${table}`);
    const name = this.names.take(cleanName(m.name, 'Measure'), ' (Measure)');
    t.measures.push({ ...m, name });
    return name;
  }

  /** DAX reference to a Celestra measure, or null when it could not be exported. */
  measureRef(id: string) {
    const m = this.measureOf.get(id);
    return m ? daxMeasure(m.name) : null;
  }

  setColumn(ref: FieldRef, name: string) {
    this.columnOf.set(ref, name);
  }
}

// ───────────────────────────── values & types ─────────────────────────────

function dataTypeOf(p: DatasetProfile, column: string, rows: Row[], forceText: boolean): PbiDataType {
  if (forceText) return 'string';
  const c = p.columns.find((x) => x.name === column);
  switch (c?.type) {
    case 'integer':
      // a column profiled as integer can still hold decimals beyond the profiling sample
      return rows.some((r) => typeof r[column] === 'number' && !Number.isInteger(r[column])) ? 'double' : 'int64';
    case 'number':
      return 'double';
    case 'date':
      return 'dateTime';
    case 'boolean':
      // flags written as text (Y / N, Yes / No) stay text so the report shows them as in the data
      return rows.some((r) => typeof r[column] === 'string') ? 'string' : 'boolean';
    default:
      return 'string';
  }
}

/** Value as it is embedded for Power BI; values that do not fit the column type become blank. */
export function toPbiValue(v: Cell | undefined, t: PbiDataType): string | number | boolean | null {
  if (v == null || v === '') return null;
  switch (t) {
    case 'string':
      return String(v);
    case 'int64':
    case 'double': {
      const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
      if (!Number.isFinite(n)) return null;
      return t === 'int64' ? Math.round(n) : n;
    }
    case 'dateTime': {
      const d = parseDate(typeof v === 'string' ? v : String(v));
      return d ? toIsoDate(d.t) : null;
    }
    case 'boolean':
      if (typeof v === 'boolean') return v;
      if (/^(true|yes|y|1)$/i.test(String(v))) return true;
      if (/^(false|no|n|0)$/i.test(String(v))) return false;
      return null;
  }
}

const M_TYPE: Record<PbiDataType, string> = { string: 'type text', int64: 'Int64.Type', double: 'type number', dateTime: 'type date', boolean: 'type logical' };

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Rows embedded as deflate-compressed JSON (Power BI's own "Enter data" encoding), decoded and typed in M. */
export function embeddedSource(columns: { name: string; dataType: PbiDataType }[], rows: (string | number | boolean | null)[][]): string {
  const b64 = base64(deflateSync(new TextEncoder().encode(JSON.stringify(rows)), { level: 9 }));
  const chunks = b64.match(/.{1,8000}/g) ?? [''];
  const names = `{${columns.map((c) => mString(c.name)).join(', ')}}`;
  const types = `{${columns.map((c) => `{${mString(c.name)}, ${M_TYPE[c.dataType]}}`).join(', ')}}`;
  return [
    'let',
    '    Data = Text.Combine({',
    chunks.map((c) => `        "${c}"`).join(',\n'),
    '    }),',
    '    Rows = Json.Document(Binary.Decompress(Binary.FromText(Data, BinaryEncoding.Base64), Compression.Deflate)),',
    `    Source = Table.FromRows(Rows, ${names}),`,
    `    Typed = Table.TransformColumnTypes(Source, ${types}, "en-US")`,
    'in',
    '    Typed',
  ].join('\n');
}

/** Inverse of `embeddedSource` for tests: the rows encoded in an M expression. */
export function decodeEmbedded(source: string, inflate: (b: Uint8Array) => Uint8Array): unknown[][] {
  const b64 = [...source.matchAll(/^ {8}"([A-Za-z0-9+/=]*)"/gm)].map((m) => m[1]).join('');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(inflate(bytes)));
}

// ───────────────────────────── relationships ─────────────────────────────

interface Edge {
  from: string;
  to: string;
}

/** Distinct directed paths from `a` to `b` (filters flow from the one side, so edges are walked to → from). */
function countPaths(edges: Edge[], a: string, b: string, limit = 2): number {
  let n = 0;
  const walk = (node: string, seen: Set<string>) => {
    if (n >= limit) return;
    if (node === b) {
      n++;
      return;
    }
    for (const e of edges) if (e.to === node && !seen.has(e.from)) walk(e.from, new Set([...seen, e.from]));
  };
  walk(a, new Set([a]));
  return n;
}

/**
 * Power BI allows only one active filter path between two tables. Celestra's engine
 * joins along the shortest path, so links already implied by a longer chain are kept
 * but made inactive, and any link that would still create a second path or a cycle
 * is made inactive too.
 */
export function chooseActive(edges: (Edge & { id: string })[]): Set<string> {
  // drop links implied by another chain one at a time, so one of two parallel links survives
  const kept = [...edges];
  for (const e of edges) {
    const others = kept.filter((x) => x !== e);
    if (countPaths(others, e.to, e.from, 1) > 0) kept.splice(kept.indexOf(e), 1);
  }
  const active: (Edge & { id: string })[] = [];
  for (const e of kept) {
    const next = [...active, e];
    const nodes = [...new Set(next.flatMap((x) => [x.from, x.to]))];
    const cyclic = countPaths(active, e.from, e.to, 1) > 0;
    const ambiguous = nodes.some((x) => nodes.some((y) => x !== y && countPaths(next, x, y) > 1));
    if (!cyclic && !ambiguous) active.push(e);
  }
  return new Set(active.map((e) => e.id));
}

// ───────────────────────────── measures → DAX ─────────────────────────────

const FORMAT: Record<MeasureDef['format'], string> = { number: '#,0', decimal: '#,0.00', percent: '0.0%', currency: '\\$#,0' };
export const formatOf = (m: Pick<MeasureDef, 'format'> | undefined) => FORMAT[m?.format ?? 'number'];

function literal(v: string, t: PbiDataType): string {
  if (t === 'int64' || t === 'double') return Number.isFinite(Number(v)) && v.trim() !== '' ? String(Number(v)) : daxString(v);
  if (t === 'boolean') return /^(true|yes|y|1)$/i.test(v) ? 'TRUE()' : 'FALSE()';
  if (t === 'dateTime') {
    const d = parseDate(v);
    if (d) {
      const x = new Date(d.t);
      return `DATE(${x.getUTCFullYear()}, ${x.getUTCMonth() + 1}, ${x.getUTCDate()})`;
    }
  }
  return daxString(v);
}

/** CALCULATE filter argument for one measure condition (KEEPFILTERS so slicers and conditions both apply, as in the engine). */
function conditionFilter(col: string, t: PbiDataType, c: MeasureCondition): string {
  const numeric = t === 'int64' || t === 'double';
  const vals = c.values.map((v) => literal(v, t));
  switch (c.op) {
    case 'notnull':
      return `KEEPFILTERS(NOT ISBLANK(${col}))`;
    case 'eq':
      return vals.length === 1 ? `KEEPFILTERS(${col} = ${vals[0]})` : `KEEPFILTERS(${col} IN {${vals.join(', ')}})`;
    case 'neq':
      return vals.length === 1 ? `KEEPFILTERS(${col} <> ${vals[0]})` : `KEEPFILTERS(NOT ${col} IN {${vals.join(', ')}})`;
    default: {
      const op = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[c.op];
      const n = Number(c.values[0]);
      // blanks never pass a comparison in the engine (DAX would treat blank as 0)
      return numeric ? `KEEPFILTERS(NOT ISBLANK(${col}) && ${col} ${op} ${Number.isFinite(n) ? n : 0})` : `KEEPFILTERS(NOT ISBLANK(${col}) && VALUE(${col}) ${op} ${Number.isFinite(n) ? n : 0})`;
    }
  }
}

/** DAX for a Celestra measure. Returns null (with a reason) when it cannot be expressed against the model. */
function measureDax(m: MeasureDef, model: PbiModel): { dax: string } | { error: string } {
  if (m.kind === 'ratio') {
    const n = model.measureRef(m.numeratorId ?? '');
    const d = model.measureRef(m.denominatorId ?? '');
    if (!n || !d) return { error: 'its numerator or denominator measure was not exported' };
    // the engine scales percentages by 100 for display; Power BI keeps the fraction and formats it as %
    return { dax: `DIVIDE(${n}, ${d})` };
  }
  const ds = m.datasetId;
  const table = ds ? model.tableOf.get(ds) : undefined;
  if (!ds || !table) return { error: 'its dataset is not part of the model' };
  const colRef = (field: string) => {
    const c = model.col(`${ds}::${field}`);
    return c ? { ref: daxCol(c.table, c.column), type: model.column(`${ds}::${field}`)!.dataType } : null;
  };
  const f = m.field ? colRef(m.field) : null;
  if (m.field && !f) return { error: `field ${m.field} was not found` };
  const numeric = f && (f.type === 'int64' || f.type === 'double');
  let agg: string;
  switch (m.kind) {
    case 'count':
      agg = f ? `COUNTA(${f.ref})` : `COUNTROWS(${daxTable(table)})`;
      break;
    case 'countDistinct':
      if (!f) return { error: 'distinct count without a field' };
      agg = `DISTINCTCOUNTNOBLANK(${f.ref})`;
      break;
    case 'sum':
    case 'avg':
    case 'median':
      if (!f || !numeric) return { error: `${m.kind} needs a numeric field` };
      agg = `${{ sum: 'SUM', avg: 'AVERAGE', median: 'MEDIAN' }[m.kind]}(${f.ref})`;
      break;
    default:
      return { error: `unsupported measure kind ${m.kind}` };
  }
  const args: string[] = [];
  for (const c of conditionsOf(m)) {
    const cr = colRef(c.field);
    if (!cr) return { error: `condition field ${c.field} was not found` };
    args.push(conditionFilter(cr.ref, cr.type, c));
  }
  // the reporting period applies to each activity table's own date (Dim_Date relationships are inactive, see buildModel)
  const t = model.table(table)!;
  if (t.dateColumn && model.hasDates) args.push(`USERELATIONSHIP(${daxCol(DATE_TABLE, 'Date')}, ${daxCol(table, t.dateColumn)})`);
  return { dax: args.length ? `CALCULATE(${agg}, ${args.join(', ')})` : agg };
}

/** Home table of a measure: its dataset's table, or (for ratios) the numerator's. */
function homeTable(m: MeasureDef, byId: Map<string, MeasureDef>, model: PbiModel, depth = 0): string | undefined {
  if (m.kind === 'ratio') {
    const n = byId.get(m.numeratorId ?? '');
    return depth < 5 && n ? homeTable(n, byId, model, depth + 1) : undefined;
  }
  return m.datasetId ? model.tableOf.get(m.datasetId) : undefined;
}

// ───────────────────────────── build ─────────────────────────────

export function buildModel(input: ExportInput): PbiModel {
  const { profiles, foundation: f, rowsOf } = input;
  const model = new PbiModel();
  const rels = input.relationships.filter((r) => r.status !== 'rejected' && profiles.some((p) => p.datasetId === r.fromDataset) && profiles.some((p) => p.datasetId === r.toDataset));
  const keyCols = new Set(rels.flatMap((r) => [`${r.fromDataset}::${r.fromField}`, `${r.toDataset}::${r.toField}`]));

  // table names follow the Reporting Foundation (Fact_… / Dim_…), falling back to the dataset label
  const tableNames = new NameRegistry([DATE_TABLE, PERIOD_TABLE]);
  for (const p of profiles) {
    const mt = f.tables.find((t) => t.sourceDatasetId === p.datasetId && t.name !== 'Dim_Geography');
    model.tableOf.set(p.datasetId, tableNames.take(cleanName(mt?.name ?? p.label, 'Table')));
  }
  model.hasDates = profiles.some((p) => p.kind === 'activity' && p.dateField);
  for (const n of [...model.tableOf.values(), ...(model.hasDates ? [DATE_TABLE, PERIOD_TABLE] : [])]) model.names.reserve(n);

  // ── dataset tables
  for (const p of profiles) {
    const name = model.tableOf.get(p.datasetId)!;
    const rows = rowsOf(p.datasetId);
    const colNames = new NameRegistry();
    const cols = p.columns.map((c) => {
      const ref = `${p.datasetId}::${c.name}`;
      const colName = colNames.take(cleanName(fieldLabel(f, ref), 'Column'));
      model.setColumn(ref, colName);
      const dataType = dataTypeOf(p, c.name, rows, keyCols.has(ref));
      const col: PbiColumn = {
        name: colName,
        dataType,
        source: c.name,
        hidden: !fieldIncluded(f, ref),
        description: c.businessDefinition || undefined,
        formatString: dataType === 'dateTime' ? 'yyyy-mm-dd' : dataType === 'int64' ? '0' : undefined,
      };
      return col;
    });
    const data = rows.map((r) => cols.map((c) => toPbiValue(r[c.source!], c.dataType)));
    // ordinal text (aging buckets, tiers, deciles) gets a hidden numeric sort key so axes follow the engine's order
    for (const [i, c] of [...cols.entries()]) {
      if (c.dataType !== 'string' || keyCols.has(`${p.datasetId}::${c.source}`)) continue;
      const distinct = [...new Set(data.map((r) => r[i]).filter((v): v is string => typeof v === 'string'))];
      if (distinct.length < 2 || distinct.length > 100 || !isOrdinal(distinct)) continue;
      const order = new Map(distinct.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((v, k) => [v, k + 1]));
      const sortName = colNames.take(`${c.name} Order`);
      c.sortByColumn = sortName;
      cols.push({ name: sortName, dataType: 'int64', source: null, hidden: true, formatString: '0', description: `Sort order of ${c.name}.` });
      data.forEach((r) => r.push(typeof r[i] === 'string' ? order.get(r[i] as string)! : null));
    }
    const mt = f.tables.find((t) => t.sourceDatasetId === p.datasetId && t.name !== 'Dim_Geography');
    model.tables.push({
      name,
      datasetId: p.datasetId,
      description: [mt?.description || p.inference, mt?.grain].filter(Boolean).join(' Grain: '),
      columns: cols,
      measures: [],
      source: embeddedSource(cols, data),
      dateColumn: p.kind === 'activity' && p.dateField ? model.col(`${p.datasetId}::${p.dateField}`)?.column : undefined,
      kind: p.kind === 'activity' ? 'fact' : 'dimension',
    });
  }
  for (const t of model.tables) for (const c of t.columns) model.names.reserve(c.name);

  // ── calendar + reporting period (presets resolved against the latest activity date, like the engine)
  if (model.hasDates) {
    const start = new Date(input.minDate);
    const end = new Date(input.anchor);
    model.tables.push({
      name: DATE_TABLE,
      datasetId: null,
      kind: 'date',
      description: `Calendar from ${toIsoDate(Date.UTC(start.getUTCFullYear(), 0, 1))} to ${toIsoDate(Date.UTC(end.getUTCFullYear(), 11, 31))}. Linked to each activity table's event date; measures activate their own link with USERELATIONSHIP so each table is filtered by its own date.`,
      columns: [
        { name: 'Date', dataType: 'dateTime', source: 'Date', formatString: 'yyyy-mm-dd' },
        { name: 'Week Start', dataType: 'dateTime', source: 'Week Start', formatString: 'dd mmm yyyy', description: 'Monday of the week.' },
        { name: 'Month', dataType: 'dateTime', source: 'Month', formatString: 'mmm yyyy', description: 'First day of the month.' },
        { name: 'Quarter', dataType: 'string', source: 'Quarter' },
        { name: 'Year', dataType: 'int64', source: 'Year', formatString: '0' },
      ],
      measures: [],
      source: [
        'let',
        `    StartDate = #date(${start.getUTCFullYear()}, 1, 1),`,
        `    EndDate = #date(${end.getUTCFullYear()}, 12, 31),`,
        '    Dates = List.Dates(StartDate, Duration.Days(EndDate - StartDate) + 1, #duration(1, 0, 0, 0)),',
        '    Base = Table.FromList(Dates, Splitter.SplitByNothing(), {"Date"}),',
        '    Typed = Table.TransformColumnTypes(Base, {{"Date", type date}}),',
        '    Week = Table.AddColumn(Typed, "Week Start", each Date.StartOfWeek([Date], Day.Monday), type date),',
        '    Month = Table.AddColumn(Week, "Month", each Date.StartOfMonth([Date]), type date),',
        '    Quarter = Table.AddColumn(Month, "Quarter", each Text.From(Date.Year([Date])) & " Q" & Text.From(Date.QuarterOfYear([Date])), type text),',
        '    Year = Table.AddColumn(Quarter, "Year", each Date.Year([Date]), Int64.Type)',
        'in',
        '    Year',
      ].join('\n'),
    });
    const periodRows: (string | number)[][] = [];
    const first = Date.UTC(start.getUTCFullYear(), 0, 1);
    PERIOD_PRESETS.forEach((preset, i) => {
      const r = resolvePeriod(preset, input.anchor, input.minDate)!;
      for (let t = Math.max(r.start, first); t <= r.end; t += 86_400_000) periodRows.push([PERIOD_LABELS[preset], i + 1, toIsoDate(t)]);
    });
    const periodCols: PbiColumn[] = [
      { name: PERIOD_COLUMN, dataType: 'string', source: PERIOD_COLUMN, sortByColumn: 'Period Order', description: `Celestra period presets, resolved against the latest activity date (${toIsoDate(input.anchor)}). Clear the selection for all time.` },
      { name: 'Period Order', dataType: 'int64', source: 'Period Order', hidden: true, formatString: '0' },
      { name: 'Date', dataType: 'dateTime', source: 'Date', hidden: true, formatString: 'yyyy-mm-dd' },
    ];
    model.tables.push({ name: PERIOD_TABLE, datasetId: null, kind: 'period', description: `Reporting period presets as of ${toIsoDate(input.anchor)}.`, columns: periodCols, measures: [], source: embeddedSource(periodCols, periodRows) });
  }

  // ── relationships
  const edges = rels
    .map((r) => ({ r, from: model.col(`${r.fromDataset}::${r.fromField}`), to: model.col(`${r.toDataset}::${r.toField}`) }))
    .filter((x) => x.from && x.to);
  const active = chooseActive(edges.map((x) => ({ id: x.r.id, from: x.from!.table, to: x.to!.table })));
  for (const { r, from, to } of edges) {
    // the "one" side must hold unique, non-blank keys; otherwise Power BI fails the refresh, so fall back to many-to-many
    const all = rowsOf(r.toDataset).map((row) => toPbiValue(row[r.toField], 'string'));
    const keys = all.filter((v) => v != null);
    const toMany = new Set(keys).size !== keys.length || keys.length !== all.length;
    const isActive = active.has(r.id);
    model.relationships.push({
      key: `rel:${r.id}:${r.fromDataset}.${r.fromField}>${r.toDataset}.${r.toField}`,
      relationshipId: r.id,
      fromTable: from!.table,
      fromColumn: from!.column,
      toTable: to!.table,
      toColumn: to!.column,
      isActive,
      toMany,
      bothDirections: false,
      note: [
        toMany ? `${to!.table}[${to!.column}] has duplicate keys, so this is a many-to-many relationship.` : '',
        isActive ? '' : 'Inactive: another active path already connects these tables (Power BI allows only one).',
      ].filter(Boolean).join(' '),
    });
    if (toMany) model.warnings.push(`${to!.table}[${to!.column}] contains duplicate keys; the relationship from ${from!.table} is many-to-many.`);
    if (!isActive) model.warnings.push(`Relationship ${from!.table}[${from!.column}] → ${to!.table}[${to!.column}] is inactive because another active path already connects these tables.`);
  }
  if (model.hasDates) {
    for (const t of model.tables.filter((x) => x.dateColumn))
      model.relationships.push({ key: `date:${t.name}`, fromTable: t.name, fromColumn: t.dateColumn!, toTable: DATE_TABLE, toColumn: 'Date', isActive: false, toMany: false, bothDirections: false, note: 'Activated inside each measure with USERELATIONSHIP.' });
    model.relationships.push({ key: 'period', fromTable: PERIOD_TABLE, fromColumn: 'Date', toTable: DATE_TABLE, toColumn: 'Date', isActive: true, toMany: false, bothDirections: true, note: 'The period slicer filters the calendar.' });
  }

  // ── measures (names first so ratios can reference each other)
  const byId = new Map(f.measures.map((m) => [m.id, m]));
  const fallbackHome = model.tables.find((t) => t.kind === 'fact')?.name ?? model.tables[0]?.name;
  for (const m of f.measures) {
    const table = homeTable(m, byId, model) ?? fallbackHome;
    if (!table) continue;
    model.measureOf.set(m.id, { table, name: model.names.take(cleanName(m.name, 'Measure'), ' (Measure)'), def: m });
  }
  for (const m of f.measures) {
    const target = model.measureOf.get(m.id);
    if (!target) continue;
    const r = measureDax(m, model);
    if ('error' in r) {
      model.warnings.push(`Measure "${m.name}" was not exported: ${r.error}.`);
      model.measureOf.delete(m.id);
      continue;
    }
    const logic = m.kind === 'ratio' ? m.logic : m.logic || conditionsOf(m).map(describeCond).join(' AND ');
    model.table(target.table)!.measures.push({
      name: target.name,
      expression: r.dax,
      formatString: formatOf(m),
      description: [m.description, logic ? `Celestra logic: ${logic}` : '', m.catalogueRef ? `ProcDNA KPI Catalogue: ${m.catalogueRef}` : ''].filter(Boolean).join(' · '),
      displayFolder: m.catalogueRef ? 'KPI Catalogue' : 'Measures',
      measureId: m.id,
    });
  }
  // a ratio exported before its parts failed must not reference a missing measure
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of model.tables)
      for (const m of [...t.measures]) {
        const def = m.measureId ? byId.get(m.measureId) : undefined;
        if (def?.kind === 'ratio' && (!model.measureOf.has(def.numeratorId ?? '') || !model.measureOf.has(def.denominatorId ?? ''))) {
          t.measures.splice(t.measures.indexOf(m), 1);
          model.measureOf.delete(def.id);
          model.warnings.push(`Measure "${def.name}" was not exported: its numerator or denominator measure was not exported.`);
          changed = true;
        }
      }
  }
  return model;
}
