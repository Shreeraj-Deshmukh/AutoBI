import type { ComponentValidation, DashboardBuild, DashboardSpec, DataUnderstanding, Foundation } from '@/types';
import { Engine, splitRef, emptyFilters } from '@/lib/engine';
import { designStats } from './designAgent';
import { clone } from '@/lib/util';
import { fieldIncluded, fieldLabel } from '@/lib/fieldLabels';

/** Dashboard Development Agent: compiles the approved design spec against the data and validates every component. */

export function validateComponents(spec: DashboardSpec, engine: Engine, foundation?: Foundation): ComponentValidation[] {
  const out: ComponentValidation[] = [];
  const f = emptyFilters(spec.defaultPeriod);
  for (const p of spec.pages) {
    for (const c of p.components) {
      const v = (ok: boolean, message: string) => out.push({ componentId: c.id, title: c.title, page: p.name, ok, message });
      const missing = c.measureIds.filter((m) => !engine.measures.has(m));
      if (!c.measureIds.length || missing.length) {
        v(false, missing.length ? `KPI definition(s) no longer exist in the reporting foundation.` : 'No measure bound to this component.');
        continue;
      }
      const excluded = [c.dimension, c.series, ...(c.tableColumns ?? [])].filter((x): x is string => !!x && !fieldIncluded(foundation, x));
      if (excluded.length) {
        v(false, `Uses ${excluded.map((x) => fieldLabel(foundation, x)).join(', ')}, which is excluded in Field Mapping. Include the field or change the visual.`);
        continue;
      }
      if (c.dimension) {
        const { datasetId, column } = splitRef(c.dimension);
        const prof = engine.profile(datasetId);
        if (!prof?.columns.some((x) => x.name === column)) {
          v(false, `Dimension field ${column} is not available in the data.`);
          continue;
        }
        const unreachable = c.measureIds.filter((m) => !engine.applies(m, c.dimension!));
        if (unreachable.length) {
          v(false, `No relationship links ${column} to ${unreachable.map((m) => engine.measures.get(m)!.name).join(', ')}.`);
          continue;
        }
      }
      try {
        if (c.type === 'kpi') {
          const k = engine.kpi(c.measureIds[0], f);
          v(k.current != null, k.current == null ? 'Measure returned no value (division by zero or no rows).' : `Value ${k.current.toFixed(2)} computed from source rows.`);
        } else if (c.type === 'funnel') {
          const { current } = engine.resolve(f);
          const vals = c.measureIds.map((m) => engine.value(m, f, current));
          v(vals.every((x) => x != null), `${vals.length} stages: ${vals.map((x) => (x == null ? 'n/a' : Math.round(x))).join(' → ')}.`);
        } else if (c.type === 'line' || c.type === 'area') {
          const s = engine.series(c.measureIds[0], c.timeGrain ?? spec.timeGrain, f);
          v(s.length > 0, s.length ? `${s.length} ${c.timeGrain ?? spec.timeGrain} buckets.` : 'No dated rows in the default period.');
        } else if (c.type === 'stacked') {
          if (!c.series) v(false, 'Stacked chart requires a series field.');
          else {
            const g = engine.group2(c.measureIds[0], c.dimension!, c.series, f);
            v(g.rows.length > 0, `${g.rows.length} categories × ${g.keys.length} series.`);
          }
        } else if (c.type === 'table') {
          const t = engine.table(c.dimension!, c.measureIds, c.tableColumns ?? [], f);
          v(t.length > 0, `${t.length} rows × ${c.measureIds.length + (c.tableColumns?.length ?? 0) + 1} columns.`);
        } else {
          const g = engine.group(c.measureIds[0], c.dimension!, f);
          v(g.length > 0, g.length ? `${g.length} categories.` : 'No data for the default period.');
        }
      } catch (e) {
        v(false, `Rendering failed: ${(e as Error).message}`);
      }
    }
  }
  return out;
}

export function buildDashboard(spec: DashboardSpec, designVersion: number, u: DataUnderstanding, foundation: Foundation, engine: Engine, prevVersion = 0): DashboardBuild {
  const validations = validateComponents(spec, engine, foundation);
  const warnings: string[] = validations.filter((v) => !v.ok).map((v) => `${v.page} › ${v.title}: ${v.message}`);
  for (const r of u.relationships.filter((r) => r.unmatched > 0 && r.status !== 'rejected')) {
    const from = u.profiles.find((p) => p.datasetId === r.fromDataset)?.label;
    const to = u.profiles.find((p) => p.datasetId === r.toDataset)?.label;
    warnings.push(`${r.unmatched} ${from} record(s) have no match in ${to}; they appear as "(Unmatched)" when sliced by ${to} attributes.`);
  }
  const usedMeasures = new Set(spec.pages.flatMap((p) => p.components.flatMap((c) => c.measureIds)));
  const transformations = [
    ...u.relationships.filter((r) => r.status !== 'rejected').map((r) => `Join ${u.profiles.find((p) => p.datasetId === r.fromDataset)?.label}.${r.fromField} → ${u.profiles.find((p) => p.datasetId === r.toDataset)?.label}.${r.toField} (many-to-one, left join)`),
    ...u.profiles.filter((p) => p.dateField).map((p) => `Parse ${p.label}.${p.dateField} to date; derive week / month / quarter buckets`),
    ...foundation.measures.filter((m) => usedMeasures.has(m.id)).map((m) => `Measure ${m.name} = ${m.logic}`),
  ];
  return { generatedAt: new Date().toISOString(), designVersion, version: prevVersion + 1, spec: clone(spec), summary: designStats(spec), validations, warnings, transformations };
}
