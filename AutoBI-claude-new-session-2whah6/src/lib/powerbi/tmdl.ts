import type { PbiColumn, PbiMeasure, PbiModel, PbiTable } from './model';
import { guid, tmdlName } from './names';

/**
 * TMDL serialisation of the export model (Power BI Project semantic model folder,
 * `definition/`). Layout and indentation follow what Power BI Desktop writes:
 * one tab per level, M expressions two levels below `source =`.
 */

const T = '\t';

/** Property value: quoted only when TMDL requires it (leading/trailing whitespace). */
const value = (v: string) => (/^\s|\s$/.test(v) || v === '' ? `"${v.replace(/"/g, '""')}"` : v);

const description = (text: string | undefined, indent: string) =>
  text
    ? text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => `${indent}/// ${l}`)
    : [];

function measureLines(table: string, m: PbiMeasure): string[] {
  return [
    ...description(m.description, T),
    `${T}measure ${tmdlName(m.name)} = ${m.expression.replace(/\s*\r?\n\s*/g, ' ')}`,
    ...(m.formatString ? [`${T}${T}formatString: ${value(m.formatString)}`] : []),
    ...(m.displayFolder ? [`${T}${T}displayFolder: ${value(m.displayFolder)}`] : []),
    `${T}${T}lineageTag: ${guid(`measure:${table}:${m.name}`)}`,
    '',
  ];
}

function columnLines(table: string, c: PbiColumn, calculated = false): string[] {
  return [
    ...description(c.description, T),
    `${T}column ${tmdlName(c.name)}`,
    `${T}${T}dataType: ${c.dataType}`,
    ...(c.hidden ? [`${T}${T}isHidden`] : []),
    ...(c.formatString ? [`${T}${T}formatString: ${value(c.formatString)}`] : []),
    `${T}${T}lineageTag: ${guid(`column:${table}:${c.name}`)}`,
    `${T}${T}summarizeBy: none`,
    `${T}${T}sourceColumn: ${calculated ? c.source : value(c.name)}`,
    ...(c.sortByColumn ? [`${T}${T}sortByColumn: ${tmdlName(c.sortByColumn)}`] : []),
    ...(c.groupByColumn ? ['', `${T}${T}relatedColumnDetails`, `${T}${T}${T}groupByColumn: ${tmdlName(c.groupByColumn)}`] : []),
    ...(c.parameterFields ? ['', `${T}${T}extendedProperty ParameterMetadata =`, `${T}${T}${T}${T}{`, `${T}${T}${T}${T}  "version": 3,`, `${T}${T}${T}${T}  "kind": 2`, `${T}${T}${T}${T}}`] : []),
    '',
    `${T}${T}annotation SummarizationSetBy = Automatic`,
    ...(c.dataType === 'dateTime' ? ['', `${T}${T}annotation UnderlyingDateTimeDataType = Date`] : []),
    '',
  ];
}

export function tableTmdl(t: PbiTable): string {
  const lines = [
    ...description(t.description, ''),
    `table ${tmdlName(t.name)}`,
    `${T}lineageTag: ${guid(`table:${t.name}`)}`,
    '',
    ...t.measures.flatMap((m) => measureLines(t.name, m)),
    ...t.columns.flatMap((c) => columnLines(t.name, c, t.calculated)),
    `${T}partition ${tmdlName(t.name)} = ${t.calculated ? 'calculated' : 'm'}`,
    `${T}${T}mode: import`,
    `${T}${T}source =`,
    ...t.source.split('\n').map((l) => `${T}${T}${T}${T}${l}`),
    '',
    ...(t.calculated ? [] : [`${T}annotation PBI_ResultType = Table`, '']),
  ];
  return lines.join('\n');
}

export function relationshipsTmdl(model: PbiModel): string {
  return model.relationships
    .map((r) =>
      [
        `relationship ${guid(r.key)}`,
        ...(r.isActive ? [] : [`${T}isActive: false`]),
        ...(r.bothDirections ? [`${T}crossFilteringBehavior: bothDirections`] : []),
        ...(r.toMany ? [`${T}toCardinality: many`] : []),
        `${T}fromColumn: ${tmdlName(r.fromTable)}.${tmdlName(r.fromColumn)}`,
        `${T}toColumn: ${tmdlName(r.toTable)}.${tmdlName(r.toColumn)}`,
        '',
      ].join('\n'),
    )
    .join('\n');
}

export function modelTmdl(model: PbiModel): string {
  return [
    'model Model',
    `${T}culture: en-US`,
    `${T}defaultPowerBIDataSourceVersion: powerBI_V3`,
    `${T}discourageImplicitMeasures`,
    `${T}sourceQueryCulture: en-US`,
    `${T}dataAccessOptions`,
    `${T}${T}legacyRedirects`,
    `${T}${T}returnErrorValuesAsNull`,
    '',
    'annotation __PBI_TimeIntelligenceEnabled = 0',
    '',
    `annotation PBI_QueryOrder = ${JSON.stringify(model.tables.filter((t) => !t.calculated).map((t) => t.name))}`,
    '',
    'annotation PBI_ProTooling = ["DevMode"]',
    '',
    ...model.tables.map((t) => `ref table ${tmdlName(t.name)}`),
    '',
  ].join('\n');
}

export const databaseTmdl = (name: string) => [`database ${tmdlName(name)}`, `${T}compatibilityLevel: 1601`, `${T}compatibilityMode: powerBI`, ''].join('\n');

/** File name for a table definition (Windows-safe; Power BI matches tables by their declared name). */
export const tableFileName = (name: string) => `${name.replace(/[<>:"/\\|?*]/g, '_')}.tmdl`;

/** All files of `definition/`, keyed by path relative to the semantic model folder. */
export function semanticModelFiles(model: PbiModel, name: string): Record<string, string> {
  const files: Record<string, string> = {
    'definition/database.tmdl': databaseTmdl(name),
    'definition/model.tmdl': modelTmdl(model),
  };
  if (model.relationships.length) files['definition/relationships.tmdl'] = relationshipsTmdl(model);
  for (const t of model.tables) files[`definition/tables/${tableFileName(t.name)}`] = tableTmdl(t);
  return files;
}
