import type { CheckSpec, DashComponent, DashPage, DashboardBuild, DataUnderstanding, Foundation, Priority, RequirementSpec, TestCase } from '@/types';
import { splitRef } from '@/lib/engine';
import { PERIOD_LABELS } from '@/lib/dates';
import { humanize, pad } from '@/lib/util';
import { CHART_LABELS } from './designAgent';
import { fieldLabel } from '@/lib/fieldLabels';
import { detectRoster } from '@/lib/access';
import { FEATURES } from '@/config/features';
import { activePeriod, hasPeriodFilter } from '@/lib/periodFilter';

/** Testing & UAT Agent: derives Functional Testing cases and Data Validation (business QC) scenarios from the generated dashboard. */

type Draft = Omit<TestCase, 'id' | 'actual' | 'status' | 'evidence' | 'comments' | 'attachments' | 'runCount'>;

const base = (d: Draft): Draft => d;

export function generateTests(build: DashboardBuild, u: DataUnderstanding, f: Foundation, req: RequirementSpec | null): TestCase[] {
  const spec = build.spec;
  const label = (id: string) => u.profiles.find((p) => p.datasetId === id)?.label ?? id;
  const tech: Draft[] = [];
  const qc: Draft[] = [];
  const pre = `Dashboard v${build.version} generated; default period ${PERIOD_LABELS[activePeriod(spec)]}; no filters applied unless stated.`;
  const dsOf = (c: DashComponent) => [...new Set(c.measureIds.map((m) => f.measures.find((x) => x.id === m)).flatMap((m) => (m?.datasetId ? [m.datasetId] : f.measures.filter((x) => x.id === m?.numeratorId || x.id === m?.denominatorId).map((x) => x.datasetId!))))].map(label).join(', ');
  const ELEMENT: Record<string, string> = { kpi: 'KPI Card', bar: 'Bar Chart', hbar: 'Bar Chart', stacked: 'Stacked Bar Chart', line: 'Line Chart', area: 'Area Chart', donut: 'Donut Chart', table: 'Table', kpiGroup: 'KPI Card', extremes: 'KPI Card', records: 'Case List', scatter: 'Scatter Plot', drilldown: 'Decomposition Tree', Filter: 'Filter', Page: 'Page Tab' };
  const add = (category: 'Interactivity' | 'Functional' | 'UI/UX', page: DashPage | null, element: string, elementType: string, steps: string[], expected: string, check: CheckSpec | null, priority: Priority = 'High', testData = 'Generated dashboard') =>
    tech.push(base({ suite: 'technical', category, page: page?.name ?? 'All pages', component: element, elementType, objective: steps.join(' '), preconditions: pre, steps, testData, expected, priority, execution: check ? 'Automated' : 'Manual', ...(check ? { check } : {}) }));
  const valuesOf = (ref?: string) => {
    if (!ref) return '';
    const { datasetId, column } = splitRef(ref);
    const c = u.profiles.find((p) => p.datasetId === datasetId)?.columns.find((x) => x.name === column);
    const vals = c?.topValues.map((v) => v.value) ?? [];
    return vals.length ? ` (${vals.slice(0, 5).join(', ')}${(c?.distinct ?? 0) > 5 ? ', …' : ''})` : '';
  };
  const lower = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);

  // ── Interactivity: one test per filter
  for (const fl of spec.filters) {
    if (fl.type === 'period') {
      add('Interactivity', null, 'Time Period', 'Filter', [`1. Select the 'R13W' option from the ${fl.label} filter.`, '2. Verify that the dashboard updates to reflect the selected time period and the previous-period comparison.'], 'The dashboard updates to show data for the selected time period (R13W).', { kind: 'period_logic' }, 'Critical', 'R13W, Last 4 weeks, Last 6 months');
      add('Interactivity', null, 'Custom Date', 'Filter', ['1. Enter a custom date range.', '2. Verify that the dashboard updates to reflect the selected date range.'], 'The dashboard updates to show data for the selected custom date range.', null, 'Medium');
    } else {
      const flLabel = fieldLabel(f, fl.field!);
      add('Interactivity', null, flLabel, 'Filter', [`1. Select a specific ${lower(flLabel)} from the ${flLabel} filter.`, `2. Verify that the dashboard updates to reflect the selected ${lower(flLabel)}.`], `The dashboard updates to show data for the selected ${lower(flLabel)}.`, { kind: 'filter_apply', filterId: fl.id }, 'High', `${label(splitRef(fl.field!).datasetId)}.${splitRef(fl.field!).column}`);
    }
  }
  add('Interactivity', spec.pages[0] ?? null, 'Chart cross-filter', 'Bar Chart', ['1. Click a bar in any category chart.', '2. Verify that all related visuals filter to the selected category and that clicking again clears it.'], 'Visuals update to the clicked category and reset when it is clicked again.', null, 'Medium');

  // ── Functional & UI/UX: per page and per component (each visual once)
  const seen = new Set<string>();
  for (const pg of spec.pages) {
    add('Functional', pg, pg.name, ELEMENT.Page, [`1. Click the '${pg.name}' tab.`, '2. Verify that every visual on the page loads with data.'], `'${pg.name}' opens and all ${pg.components.length} visuals render.`, { kind: 'spec_integrity', pageId: pg.id }, 'High');
    for (const c of pg.components) {
      const key = `${c.type}|${c.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const m = f.measures.find((x) => x.id === c.measureIds[0]);
      const el = ELEMENT[c.type] ?? CHART_LABELS[c.type];
      const dimName = c.dimension ? lower(fieldLabel(f, c.dimension)) : '';
      const ds = dsOf(c);
      if (c.type === 'kpi') {
        add('Functional', pg, c.title, el, [`1. Verify that the ${c.title} card shows the value for the selected period.`, '2. Verify that the change versus the previous period is shown with the correct direction.'], `${c.title} shows the correct value (${m?.logic ?? ''}) and period-over-period change.`, { kind: 'kpi_recompute', measureId: c.measureIds[0] }, 'Critical', ds);
        continue;
      }
      if (c.type === 'kpiGroup') {
        if (c.dimension) add('Functional', pg, c.title, el, [`1. Verify that the ${c.title} card shows ${m?.name ?? 'the measure'} for each ${dimName}${valuesOf(c.dimension)}.`, '2. Check each value against the source data.'], `Each ${dimName} value of ${c.title} matches the source.`, { kind: 'group_recompute', componentId: c.id }, 'Critical', ds);
        else
          c.measureIds.forEach((mid, i) => {
            const mm = f.measures.find((x) => x.id === mid);
            add('Functional', pg, `${c.title} – ${c.labels?.[i] ?? mm?.name}`, el, [`1. Verify that the "${c.labels?.[i] ?? mm?.name}" value on the ${c.title} card is shown for the selected period.`, '2. Check the value against the source data.'], `${mm?.name} shows the correct value (${mm?.logic ?? ''}).`, { kind: 'kpi_recompute', measureId: mid }, 'Critical', ds);
          });
        continue;
      }
      if (c.type === 'extremes') {
        add('Functional', pg, c.title, el, [`1. Verify that ${c.title} names the highest and lowest ${dimName}${c.lowIsBest ? ' (fastest and slowest)' : ''}.`, '2. Recompute the measure for every category and compare.'], `The highest and lowest ${dimName} and their values match the source data.`, { kind: 'extremes', componentId: c.id }, 'High', ds);
        continue;
      }
      if (c.type === 'records') {
        const colNames = (c.tableColumns ?? []).map((x) => fieldLabel(f, x));
        add('Functional', pg, c.title, el, [`1. Verify that ${c.title} lists every record counted by ${m?.name}.`, `2. Check that the columns (${colNames.join(', ')}) are populated${c.toggle ? ` and that "${c.toggle.label}" narrows the list` : ''}.`], `Every ${m?.name?.toLowerCase()} record is listed once with its details${c.toggle ? `; the "${c.toggle.label}" toggle shows only matching records` : ''}.`, { kind: 'records', componentId: c.id }, 'Critical', ds);
        add('Interactivity', pg, c.title, el, ['1. Click a case in the list.', '2. Verify that the case detail shows the patient journey dates in order and the case attributes.'], 'The case detail opens with the full journey timeline for that patient.', null, 'Medium', ds);
        continue;
      }
      if (c.type === 'scatter') {
        c.measureIds.slice(0, 2).forEach((mid, i) => add('Functional', pg, c.title, el, [`1. Verify the ${i ? 'vertical' : 'horizontal'} position of each ${dimName} point (${f.measures.find((x) => x.id === mid)?.name}).`, '2. Compare with the source data.'], `Every point's ${f.measures.find((x) => x.id === mid)?.name} matches the source.`, { kind: 'group_recompute', componentId: c.id, measureId: mid }, 'High', ds));
        continue;
      }
      if (c.type === 'drilldown') {
        const lv = (c.levels ?? []).map((x) => fieldLabel(f, x));
        add('Functional', pg, c.title, el, [`1. Verify the first level (${lv[0]}) of ${c.title} against the source.`, `2. Click through ${lv.join(' → ')} and check that each level adds up to the level above.`], `Each level of the drilldown matches the source and sums to its parent.`, { kind: 'group_recompute', componentId: c.id }, 'High', ds);
        add('Interactivity', pg, c.title, el, [`1. Click a bar at each level (${lv.join(' → ')}).`, '2. Verify the next level opens filtered to the selection, and that clicking again collapses it.'], 'Drilling opens the next level for the clicked node only.', null, 'Medium', ds);
        continue;
      }
      if (c.type === 'funnel') {
        const names = c.measureIds.map((id) => f.measures.find((x) => x.id === id)?.name).filter(Boolean);
        add('Functional', pg, c.title, 'Funnel', [`1. Verify that the funnel shows ${names.join(' → ')}.`, '2. Check that each stage count and its share of the first stage are correct.'], 'Each funnel stage matches the source data and percentages are relative to the first stage.', { kind: 'funnel', componentId: c.id }, 'Critical', ds);
      } else if (['bar', 'hbar', 'donut', 'stacked'].includes(c.type) && c.dimension) {
        const inner = c.subDimension ? ` and, within each, by ${lower(fieldLabel(f, c.subDimension))}` : '';
        add('Functional', pg, c.title, el, [`1. Verify that the ${el.toLowerCase()} displays data for different ${dimName} values${valuesOf(c.dimension)}${inner}.`, `2. Check that the ${c.type === 'donut' ? 'segments' : 'bars'} are correctly colored and labeled.`], `The ${el.toLowerCase()} displays data for different ${dimName} values with correct colors and labels.`, { kind: 'group_recompute', componentId: c.id }, 'High', ds);
      } else if (c.type === 'line' || c.type === 'area' || ((c.type === 'bar' || c.type === 'stacked') && c.timeGrain)) {
        const names = c.measureIds.map((id) => f.measures.find((x) => x.id === id)?.name).filter(Boolean).join(', ');
        add('Functional', pg, c.title, el, [`1. Verify that the ${el.toLowerCase()} displays data for ${names} by ${c.timeGrain ?? spec.timeGrain}.`, '2. Check that the lines are correctly colored and labeled.'], `The ${el.toLowerCase()} displays ${names} with correct colors and labels.`, { kind: 'series_recompute', componentId: c.id }, 'High', ds);
      } else if (c.type === 'table') {
        const cols = [fieldLabel(f, c.dimension!), ...(c.tableColumns ?? []).map((x) => fieldLabel(f, x)), ...c.measureIds.map((id) => f.measures.find((x) => x.id === id)?.name ?? '')].filter(Boolean);
        add('Functional', pg, c.title, el, [`1. Verify that the table displays data for different ${dimName} values.`, `2. Check that the columns (${cols.join(', ')}) are correctly labeled and populated.`], 'The table displays correct column labels and data, and totals reconcile.', { kind: 'table_total', componentId: c.id }, 'High', ds);
      }
      add('UI/UX', pg, c.title, el, ['1. Inspect the ' + (c.type === 'table' ? 'table' : 'chart') + ' for proper alignment, font size, and color contrast.', c.type === 'table' ? '2. Verify that the table is scrollable if it exceeds the visible area.' : '2. Verify that tooltips show correct data on hover.'], c.type === 'table' ? 'The table is visually aligned and scrollable if it exceeds the visible area.' : 'The chart is visually aligned and tooltips show correct data on hover.', null, 'Low');
    }
  }

  // ── Business QC scenarios
  const qcSeen = new Set<string>();
  const qcAdd = (category: string, section: string, objective: string, expected: string, check: CheckSpec | null, priority: Priority = 'High', page = spec.pages[0]?.name ?? '') =>
    !(check && qcSeen.has(category + JSON.stringify(check))) && (check && qcSeen.add(category + JSON.stringify(check)), true) &&
    qc.push(
      base({
        suite: 'qc',
        category,
        page,
        component: section,
        elementType: 'Business validation',
        objective,
        preconditions: pre,
        steps: check ? ['Executed automatically by the Testing Agent against source data'] : ['Analyst reviews the dashboard against business expectations', 'Record actual result and evidence'],
        testData: 'Source datasets',
        expected,
        priority,
        execution: check ? 'Automated' : 'Manual',
        ...(check ? { check } : {}),
      }),
    );
  const all = spec.pages.flatMap((p) => p.components.map((c) => ({ p, c })));
  const breakdowns = all.filter(({ c }) => ['bar', 'hbar', 'stacked', 'donut'].includes(c.type) && c.dimension);
  const seenSections = new Set<string>();
  for (const { p, c } of breakdowns) {
    if (seenSections.has(c.title)) continue;
    seenSections.add(c.title);
    const ds = dsOf(c);
    qcAdd('Data Integrity', c.title, `Validate ${fieldLabel(f, c.dimension!).toLowerCase()} counts against source ${ds}`, 'Counts match source records', { kind: 'group_recompute', componentId: c.id }, 'High', p.name);
    if (f.measures.find((m) => m.id === c.measureIds[0])?.kind === 'count' && !c.topN) qcAdd('Calculation Accuracy', c.title, 'Compare chart total against the sum of individual categories', c.type === 'stacked' ? 'Stacked total equals segment sum' : 'Sum of categories equals total', { kind: 'group_rollup', componentId: c.id }, 'High', p.name);
  }
  for (const r of u.relationships.filter((r) => r.status !== 'rejected')) {
    const tgt = u.profiles.find((p) => p.datasetId === r.toDataset)!;
    const src = u.profiles.find((p) => p.datasetId === r.fromDataset)!;
    qcAdd(tgt.entity.toLowerCase() === 'account' ? 'HCP Matching' : 'Data Integrity', `${src.label} ↔ ${tgt.label}`, `Match ${src.entity.toLowerCase()} records with the ${tgt.label} on ${r.fromField}`, `Every ${src.entity.toLowerCase()} record maps to a valid ${tgt.entity.toLowerCase()}`, { kind: 'fk_integrity', relationshipId: r.id }, 'Critical');
    const usedAttrs = new Set(all.flatMap(({ c }) => [c.dimension, c.series, ...(c.tableColumns ?? [])]).filter((x): x is string => !!x && splitRef(x).datasetId === tgt.datasetId).map((x) => splitRef(x).column));
    for (const a of usedAttrs) {
      if (/name/i.test(a)) continue;
      const cat = /tier/i.test(a) ? 'Tier Mapping' : /region|territory|state/i.test(a) ? 'Hierarchy Validation' : 'Data Integrity';
      qcAdd(cat, `${humanize(a)} (${src.label})`, `Verify ${humanize(a).toLowerCase()} on ${src.entity.toLowerCase()} records against the ${tgt.label}`, `All ${src.entity.toLowerCase()} records carry the correct ${humanize(a).toLowerCase()}`, { kind: 'attribute_mapping', relationshipId: r.id, field: a }, 'High');
    }
  }
  const kpiComps = all.filter(({ c }) => c.type === 'kpi');
  if (kpiComps.some(({ c }) => c.comparison)) qcAdd('Period Comparison', 'KPI cards', 'Validate current vs previous period counts', 'Previous period values reconcile to source and periods are adjacent and equal length', { kind: 'period_logic' }, 'High');
  for (const { p, c } of kpiComps) {
    const m = f.measures.find((x) => x.id === c.measureIds[0]);
    if (m?.condition || m?.kind === 'ratio') qcAdd('Engagement Accuracy', c.title, `Match ${c.title.toLowerCase()} with source logs`, `${c.title} reconciles to source`, { kind: 'kpi_recompute', measureId: m.id }, 'High', p.name);
  }
  const trend = all.find(({ c }) => c.type === 'line' || c.type === 'area');
  if (trend) {
    qcAdd('Outlier Detection', trend.c.title, 'Identify unexplained spikes in weekly activity', 'No unexplained spikes; any spike is explained by business events', { kind: 'outlier', componentId: trend.c.id }, 'Medium', trend.p.name);
    const tm = f.measures.find((m) => m.id === trend.c.measureIds[0] && (m.kind === 'count' || m.kind === 'sum')); // only additive measures roll up across time buckets
    if (tm) qcAdd('Timeline Validation', trend.c.title, 'Verify correct weekly, monthly and quarterly aggregation', 'Weekly, monthly and quarterly totals reconcile to the period total', { kind: 'timeline', measureId: tm.id }, 'High', trend.p.name);
  }
  const acts = u.profiles.filter((p) => p.kind === 'activity');
  if (acts.length >= 2) {
    const ma = f.measures.find((m) => m.datasetId === acts[0].datasetId && m.kind === 'count' && !m.condition);
    const mb = f.measures.find((m) => m.datasetId === acts[1].datasetId && m.kind === 'count' && !m.condition);
    if (ma && mb) qcAdd('Campaign Correlation', `${acts[0].label} vs ${acts[1].label}`, `Check alignment between ${acts[1].entity.toLowerCase()} and ${acts[0].entity.toLowerCase()} activity`, 'Both channels cover the same timeline; correlation is reported', { kind: 'correlation', measureA: ma.id, measureB: mb.id }, 'Low');
  }
  for (const { p, c } of all.filter(({ c }) => c.type === 'table')) {
    qcAdd('Roll-up Total Accuracy', c.title, 'Validate grand totals against row-wise aggregation', 'Grand total matches aggregation', { kind: 'table_total', componentId: c.id }, 'High', p.name);
    qcAdd('Activity Alignment', c.title, 'Validate activity shown per row against back-end data for a sample of rows', 'Sampled rows match source activity counts', null, 'Medium', p.name);
  }
  for (const a of acts) qcAdd('Data Integrity', a.label, `Check ${a.label} for duplicate records`, 'No duplicate activity records', { kind: 'duplicates', datasetId: a.datasetId }, 'High');
  for (const p of u.profiles) qcAdd('Data Integrity', p.label, `Validate that all ${p.rowCount.toLocaleString('en-US')} source rows of ${p.label} are loaded into the dashboard`, 'Source, profiled and reported row counts are equal', { kind: 'row_count', datasetId: p.datasetId }, 'Medium');
  // headline counts must count each entity once
  for (const { p, c } of kpiComps) {
    const m = f.measures.find((x) => x.id === c.measureIds[0]);
    const prof = u.profiles.find((x) => x.datasetId === m?.datasetId);
    if (m && m.kind === 'count' && prof?.primaryKey && m.field === prof.primaryKey) qcAdd('Calculation Accuracy', c.title, `Confirm ${c.title} counts each ${prof.entity.toLowerCase()} once (unique ${m.field})`, `${c.title} equals the number of unique ${m.field} values`, { kind: 'unique_count', measureId: m.id }, 'Critical', p.name);
  }
  for (const { p, c } of all.filter(({ c }) => c.type === 'funnel')) qcAdd('Data Integrity', c.title, 'Validate funnel stage counts against the source journey data', 'Every stage reconciles to source records', { kind: 'funnel', componentId: c.id }, 'Critical', p.name);
  for (const { p, c } of all.filter(({ c }) => c.type === 'records')) qcAdd('Case Integrity', c.title, 'Confirm every open case in the source appears in the FRM case list exactly once', 'Case list count equals the open-case count in the source', { kind: 'records', componentId: c.id }, 'Critical', p.name);
  for (const { p, c } of all.filter(({ c }) => c.type === 'extremes' && c.dimension && /territor|region|district/i.test(c.dimension))) qcAdd('Hierarchy Validation', c.title, `Validate the highest and lowest ${fieldLabel(f, c.dimension!).toLowerCase()} for ${c.title.toLowerCase()}`, 'Territory scorecard names the right territories', { kind: 'extremes', componentId: c.id }, 'High', p.name);
  // ProcDNA KPI catalogue: every catalogue KPI on the dashboard must still follow the catalogue definition
  const onDash = new Set(all.flatMap(({ c }) => c.measureIds));
  for (const m of f.measures.filter((x) => x.catalogueRef && onDash.has(x.id))) {
    const pg = all.find(({ c }) => c.measureIds.includes(m.id))!.p.name;
    qcAdd('Catalogue Alignment', m.name, `Confirm ${m.name} follows the ProcDNA KPI Catalogue definition and reconciles to source`, 'Dashboard logic equals the catalogue computation and the value matches the source data', { kind: 'catalogue', measureId: m.id }, 'High', pg);
  }
  if (FEATURES.rowLevelSecurity && detectRoster(u)) qcAdd('Access Control', 'Row-level security', 'Confirm each FRM sees only their authorised territory data', 'Users see only authorised rows and their numbers reconcile', { kind: 'rls' }, 'Critical');
  qcAdd('Filter Functionality', 'Filters', 'Apply multiple filters and verify all sections update', 'All relevant visuals update correctly', { kind: 'multi_filter' }, 'High');
  if (hasPeriodFilter(spec)) qcAdd('Default Behavior', 'Filters', 'Validate the default reporting period', `Default period is ${PERIOD_LABELS[spec.defaultPeriod]} anchored on the latest data date`, { kind: 'default_period' }, 'Medium');
  for (const r of (req?.rules ?? []).slice(0, 4)) qcAdd('Business Rule', 'Requirements', `Confirm business rule: ${r.text}`, 'Dashboard behaviour is consistent with the agreed rule', null, 'Medium');

  const mk = (d: Draft, id: string): TestCase => ({ ...d, id, actual: '', status: 'Not Started', evidence: '', comments: [], attachments: [], runCount: 0 });
  return [...tech.map((d, i) => mk(d, `TC${pad(i + 1)}`)), ...qc.map((d, i) => mk(d, `QC${pad(i + 1)}`))];
}

export const TEST_CATEGORIES = ['Interactivity', 'Functional', 'UI/UX'];
export const SUITE_LABEL = { technical: 'Functional Testing', qc: 'Data Validation Testing' } as const;
export const QC_CATEGORIES = ['Data Integrity', 'Hierarchy Validation', 'Calculation Accuracy', 'Tier Mapping', 'Period Comparison', 'Outlier Detection', 'Engagement Accuracy', 'Timeline Validation', 'Campaign Correlation', 'HCP Matching', 'Activity Alignment', 'Roll-up Total Accuracy', 'Filter Functionality', 'Default Behavior', 'Business Rule', 'Access Control', 'Case Integrity', 'Catalogue Alignment'];
