import type { DataUnderstanding, FieldMap, Foundation, MeasureDef, ModelTable, RequirementSpec } from '@/types';
import { humanize, plural, uid } from '@/lib/util';
import { positiveValue, tokens } from '@/lib/semantic';
import { conditionsOf, describe as describeCond } from '@/lib/conditions';
import { buildMeasureFromText } from './kpiBuilder';

/** Reporting Foundation Agent: logical model, field mappings and KPI logic (simulated data-mart workspace). */

const tableName = (kind: 'fact' | 'dimension', entity: string) => `${kind === 'fact' ? 'Fact' : 'Dim'}_${entity.replace(/\s+/g, '_')}${kind === 'fact' ? '_Activity' : ''}`;

export function measureLogic(m: MeasureDef, all: MeasureDef[], labelOf: (id: string) => string): string {
  if (m.kind === 'ratio') {
    const n = all.find((x) => x.id === m.numeratorId)?.name ?? '?';
    const d = all.find((x) => x.id === m.denominatorId)?.name ?? '?';
    return `[${n}] / [${d}]${m.format === 'percent' ? ' × 100' : ''}`;
  }
  const fn = { count: 'COUNT', countDistinct: 'COUNT DISTINCT', sum: 'SUM', avg: 'AVERAGE' }[m.kind];
  const conds = conditionsOf(m);
  const where = conds.length ? ` WHERE ${conds.map(describeCond).join(' AND ')}` : '';
  return `${fn}(${labelOf(m.datasetId!)}.${m.field ?? '*'})${where}`;
}

/** The defined measure that answers a requirement KPI, if any (explicit link first, then a name match). */
export function measureForRequirement(f: Foundation, requirement: string): MeasureDef | undefined {
  const r = requirement.toLowerCase().trim();
  const linked = f.measures.find((m) => m.requirementRef?.toLowerCase().trim() === r);
  if (linked) return linked;
  const kt = tokens(requirement.replace(/\s+by\s+.+$/i, ''));
  if (!kt.length) return undefined;
  return f.measures.find((m) => { const mt = tokens(m.name); return mt.length === kt.length && kt.every((t) => mt.includes(t)); });
}

/**
 * Keep the requirement mapping and the data gaps consistent with the KPIs actually defined:
 * a KPI the foundation calculates (AI- or user-defined) is not "missing" any more.
 */
export function reconcileMappings(u: DataUnderstanding, f: Foundation) {
  const label = (id: string) => u.profiles.find((p) => p.datasetId === id)?.label ?? id;
  for (const mp of u.mappings) {
    if (mp.kind !== 'kpi' || mp.status !== 'missing') continue;
    const m = measureForRequirement(f, mp.requirement);
    if (!m) continue;
    const parts = m.kind === 'ratio' ? [f.measures.find((x) => x.id === m.numeratorId), f.measures.find((x) => x.id === m.denominatorId)].filter((x): x is MeasureDef => !!x) : [m];
    mp.status = m.kind === 'ratio' || m.kind === 'avg' ? 'calculation_required' : 'available';
    mp.sources = [...new Set(parts.filter((x) => x.datasetId).map((x) => label(x.datasetId!)))];
    mp.fields = [...new Set(parts.flatMap((x) => [...(x.field ? [x.field] : []), ...conditionsOf(x).map((c) => c.field)]))];
    mp.note = `Defined in the Reporting Foundation as "${m.name}": ${m.logic || measureLogic(m, f.measures, label)}`;
  }
  f.gaps = u.mappings.filter((m) => m.status === 'missing').map((m) => `${m.requirement} — ${m.note}`);
  return f;
}

/** Add rule-based measures for requirement KPIs not yet covered (used after AI proposals). */
export function fillRequirementGaps(f: Foundation, u: DataUnderstanding, spec: RequirementSpec | null) {
  const label = (id: string) => u.profiles.find((p) => p.datasetId === id)?.label ?? id;
  for (const k of spec?.kpis ?? []) {
    if (f.measures.some((m) => m.requirementRef?.toLowerCase() === k.text.toLowerCase())) continue;
    const kt = tokens(k.text.replace(/\s+by\s+.+$/i, ''));
    if (f.measures.some((m) => { const mt = tokens(m.name); return mt.length === kt.length && kt.every((t) => mt.includes(t)); })) continue;
    const built = buildMeasureFromText(k.text, u, f.measures);
    if (built) f.measures.push(...built.extra, built.main);
  }
  for (const m of f.measures) m.logic = measureLogic(m, f.measures, label);
  return f;
}

export function runFoundation(u: DataUnderstanding, spec: RequirementSpec | null, opts: { requirementKpis?: boolean } = {}): Foundation {
  const label = (id: string) => u.profiles.find((p) => p.datasetId === id)?.label ?? id;
  const tables: ModelTable[] = [];
  const fieldMaps: FieldMap[] = [];
  const measures: MeasureDef[] = [];
  const assumptions: string[] = [];

  for (const p of u.profiles) {
    const kind = p.kind === 'activity' ? 'fact' : 'dimension';
    const name = tableName(kind, p.entity);
    tables.push({
      id: uid('tbl'),
      name,
      kind,
      sourceDatasetId: p.datasetId,
      grain: kind === 'fact' ? `One row per ${p.entity.toLowerCase()} event` : `One row per ${p.entity.toLowerCase()}`,
      fields: p.columns.filter((c) => !(kind === 'fact' && ['dimension', 'attribute'].includes(c.role) && false)).map((c) => c.name),
      description: p.inference,
    });
    for (const c of p.columns) {
      const isFactDate = kind === 'fact' && c.name === p.dateField;
      fieldMaps.push({
        id: uid('fm'),
        sourceDataset: p.datasetId,
        sourceField: c.name,
        reportingTable: name,
        reportingField: isFactDate ? 'Activity_Date' : c.name,
        dataType: c.type === 'date' ? 'Date' : c.type === 'integer' || c.type === 'number' ? 'Number' : c.role === 'identifier' || c.role === 'foreign_key' ? 'Key' : c.role === 'status' ? 'Status' : 'Category',
        role: c.role,
        included: true,
      });
    }
    if (p.duplicateRows) assumptions.push(`${p.label}: ${p.duplicateRows} duplicate row(s) are retained as-is (no de-duplication applied in the POC).`);
  }
  // derived logical tables
  if (u.profiles.some((p) => p.kind === 'activity' && p.dateField)) {
    tables.push({ id: uid('tbl'), name: 'Dim_Date', kind: 'dimension', sourceDatasetId: null, grain: 'One row per calendar day', fields: ['Date', 'Week_Start', 'Month', 'Quarter', 'Year'], description: 'Derived calendar dimension covering the activity date range; enables weekly, monthly and quarterly roll-ups and period comparisons.' });
    fieldMaps.push(...u.profiles.filter((p) => p.kind === 'activity' && p.dateField).map((p) => ({ id: uid('fm'), sourceDataset: p.datasetId, sourceField: p.dateField!, reportingTable: 'Dim_Date', reportingField: 'Date', dataType: 'Date', role: 'date' as const, included: true })));
  }
  for (const p of u.profiles.filter((x) => x.kind === 'master')) {
    const geo = p.columns.filter((c) => /^(region|territory|state|country|city|district|area|zone)$/i.test(c.name)).map((c) => c.name);
    if (geo.length >= 2) {
      tables.push({ id: uid('tbl'), name: 'Dim_Geography', kind: 'dimension', sourceDatasetId: p.datasetId, grain: `One row per ${geo[geo.length - 1].toLowerCase()}`, fields: geo, description: `Derived geographic hierarchy (${geo.join(' › ')}) from ${p.label}, used for drill-down.` });
    }
  }

  // measures
  const add = (m: Omit<MeasureDef, 'id' | 'logic'>) => {
    const full: MeasureDef = { ...m, id: uid('m'), logic: '' };
    measures.push(full);
    return full;
  };
  for (const p of u.profiles.filter((x) => x.kind === 'activity')) {
    const ent = p.entity;
    const sentSuffix = p.dateField && /sent/i.test(p.dateField) ? ' Sent' : '';
    const total = add({ name: `Total ${plural(ent)}${sentSuffix}`, description: `Number of ${ent.toLowerCase()} records${sentSuffix ? ' sent' : ''} in the selected period.`, kind: 'count', datasetId: p.datasetId, field: p.primaryKey, format: 'number', assumptions: p.primaryKey ? [] : ['No unique identifier – counts rows.'] });
    let prevPositive: MeasureDef | null = null;
    for (const c of p.columns.filter((c) => c.role === 'status')) {
      const pos = positiveValue(c);
      if (!pos) continue;
      const cm = add({ name: `${humanize(pos)} ${plural(ent)}`, description: `${plural(ent)} where ${c.name} is "${pos}".`, kind: 'count', datasetId: p.datasetId, field: p.primaryKey, condition: { field: c.name, op: 'eq', values: [pos] }, format: 'number', assumptions: [`"${pos}" is treated as the positive outcome of ${c.name}; other values (${c.topValues.filter((v) => v.value !== pos).map((v) => v.value).join(', ')}) are excluded.`] });
      const base = prevPositive ?? total;
      const rateWord = /deliver/i.test(pos) ? 'Delivery' : /open/i.test(pos) ? 'Open' : humanize(pos);
      add({ name: `${ent} ${rateWord} Rate`, description: `${cm.name} as a percentage of ${base.name}.`, kind: 'ratio', numeratorId: cm.id, denominatorId: base.id, format: 'percent', assumptions: [`Denominator is ${base.name}${prevPositive ? ' (only records that reached the previous stage are eligible)' : ''}.`] });
      prevPositive = cm;
    }
    for (const c of p.columns.filter((c) => c.role === 'measure')) {
      // durations and ages are averaged, amounts and volumes are summed
      if (/(days|duration|time|age|lag|tat|hours|minutes)/i.test(c.name)) add({ name: `Avg ${humanize(c.name)}`, description: `Average of ${c.name} where present.`, kind: 'avg', datasetId: p.datasetId, field: c.name, format: 'decimal', assumptions: ['Blank values are excluded from the average.'] });
      else add({ name: `Total ${humanize(c.name)}`, description: `Sum of ${c.name}.`, kind: 'sum', datasetId: p.datasetId, field: c.name, format: 'number', assumptions: [] });
    }
    const fk = u.relationships.find((r) => r.fromDataset === p.datasetId && r.status !== 'rejected' && u.profiles.find((x) => x.datasetId === r.toDataset)?.kind === 'master');
    if (fk) {
      const target = u.profiles.find((x) => x.datasetId === fk.toDataset)!;
      const reached = add({ name: `${plural(target.entity)} Reached (${plural(ent)})`, description: `Distinct ${target.entity.toLowerCase()}s with at least one ${ent.toLowerCase()}.`, kind: 'countDistinct', datasetId: p.datasetId, field: fk.fromField, format: 'number', assumptions: fk.unmatched ? [`Includes ${fk.unmatched} record(s) whose ${fk.fromField} is not in ${target.label}; these are excluded from distinct counts of matched ${target.entity.toLowerCase()}s.`] : [] });
      add({ name: `Avg ${plural(ent)} per ${target.entity}`, description: `${total.name} divided by ${reached.name}.`, kind: 'ratio', numeratorId: total.id, denominatorId: reached.id, format: 'decimal', assumptions: ['Average across reached entities only.'] });
    }
  }
  for (const p of u.profiles.filter((x) => x.kind === 'master')) {
    add({ name: `Total ${plural(p.entity)}`, description: `Number of ${p.entity.toLowerCase()}s in ${p.label}.`, kind: 'count', datasetId: p.datasetId, field: p.primaryKey, format: 'number', assumptions: ['Not affected by the reporting period filter (master data).'] });
  }
  // KPIs named in the requirements that the generic rules didn't cover (e.g. "Patients awaiting PA")
  for (const k of opts.requirementKpis === false ? [] : spec?.kpis ?? []) {
    const kt = tokens(k.text.replace(/\s+by\s+.+$/i, ''));
    const covered = measures.some((m) => { const mt = tokens(m.name); return mt.length === kt.length && kt.every((t) => mt.includes(t)); });
    if (covered) continue;
    const built = buildMeasureFromText(k.text, u, measures);
    if (!built) continue;
    const dup = measures.find((m) => m.kind === built.main.kind && m.datasetId === built.main.datasetId && m.field === built.main.field && JSON.stringify(conditionsOf(m)) === JSON.stringify(conditionsOf(built.main)) && m.numeratorId === built.main.numeratorId && m.denominatorId === built.main.denominatorId);
    if (dup) {
      dup.requirementRef = dup.requirementRef ?? k.text;
      continue;
    }
    measures.push(...built.extra, built.main);
  }
  for (const m of measures) m.logic = measureLogic(m, measures, label);

  // link to requirements
  if (spec) {
    for (const k of spec.kpis) {
      if (/ by /i.test(k.text)) continue;
      const kt = tokens(k.text);
      const best = measures
        .map((m) => ({ m, s: tokens(m.name).filter((t) => kt.includes(t)).length - Math.abs(tokens(m.name).length - kt.length) * 0.2 }))
        .sort((a, b) => b.s - a.s)[0];
      if (best && best.s >= 1) best.m.requirementRef = best.m.requirementRef ?? k.text;
    }
  }
  const gaps = u.mappings.filter((m) => m.status === 'missing').map((m) => `${m.requirement} — ${m.note}`);
  assumptions.push('Relationships are many-to-one from activity (fact) tables to master (dimension) tables.', 'Reporting period filters apply to the event date of each fact table; master data is not date-filtered.', 'Records with unmatched join keys are kept in totals and shown as "(Unmatched)" when sliced by master attributes.');
  return { generatedAt: new Date().toISOString(), tables, fieldMaps, measures, gaps, assumptions };
}
