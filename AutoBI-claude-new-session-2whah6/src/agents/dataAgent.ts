import type { DataUnderstanding, DatasetMeta, DatasetProfile, ReqMapping, Relationship, RequirementSpec, Row } from '@/types';
import { classifyDatasets, detectIssues, detectRelationships, profileDataset } from '@/lib/profile';
import { findEntityDataset, findField, findStatus } from '@/lib/semantic';
import { uid } from '@/lib/util';
import { buildMeasureFromText } from './kpiBuilder';
import { bindCatalogue } from '@/lib/catalogue';

/** Data Intelligence Agent: profiling, understanding, relationships, quality, requirement mapping. */

export function reachable(rels: Relationship[], from: string, to: string, depth = 3): boolean {
  if (from === to) return true;
  if (depth === 0) return false;
  return rels.filter((r) => r.fromDataset === from && r.status !== 'rejected').some((r) => reachable(rels, r.toDataset, to, depth - 1));
}

const STATUS_WORDS = ['deliver', 'open', 'click', 'complet', 'convert', 'respond', 'attend', 'success'];

export function mapRequirements(spec: RequirementSpec, profiles: DatasetProfile[], rels: Relationship[]): ReqMapping[] {
  const out: ReqMapping[] = [];
  const primaryActivity = profiles.find((p) => p.kind === 'activity');
  const catalogue = bindCatalogue({ profiles });
  const label = (id?: string) => profiles.find((p) => p.datasetId === id)?.label;

  for (const k of spec.kpis) {
    const [metricText, dimText] = k.text.split(/\s+by\s+/i);
    // a ProcDNA catalogue KPI: map it with the catalogue's computation, or say which source it needs
    const want = metricText.trim().toLowerCase();
    const bound = catalogue.measures.find((m) => m.catalogueRef?.toLowerCase() === want || m.name.toLowerCase() === want);
    if (bound) {
      const parts = bound.kind === 'ratio' ? catalogue.measures.filter((m) => m.id === bound.numeratorId || m.id === bound.denominatorId) : [bound];
      out.push({ id: uid('map'), requirement: k.text, kind: 'kpi', sources: [...new Set(parts.map((m) => label(m.datasetId)).filter((x): x is string => !!x))], fields: [...new Set(parts.flatMap((m) => [...(m.field ? [m.field] : []), ...[m.condition, ...(m.conditions ?? [])].filter((c) => !!c).map((c) => c!.field)]))], status: bound.kind === 'ratio' || bound.kind === 'avg' || bound.kind === 'median' ? 'calculation_required' : 'available', note: `ProcDNA KPI Catalogue — ${bound.assumptions[0]?.replace(/^ProcDNA KPI Catalogue: /, '') ?? bound.description}` });
      continue;
    }
    const cov = catalogue.coverage.find((c) => c.metric.toLowerCase() === want && c.status === 'needs_data');
    if (cov) {
      out.push({ id: uid('map'), requirement: k.text, kind: 'kpi', sources: [], fields: [], status: 'missing', note: `ProcDNA KPI Catalogue metric. ${cov.note}` });
      continue;
    }
    const built = buildMeasureFromText(k.text, { profiles, relationships: rels } as unknown as DataUnderstanding, []);
    if (built && !/^total /i.test(metricText.trim())) {
      const all = [built.main, ...built.extra];
      const conds = all.flatMap((m) => [m.condition, ...(m.conditions ?? [])].filter((c): c is NonNullable<typeof c> => !!c));
      const ds0 = profiles.find((p) => p.datasetId === (built.main.datasetId ?? built.extra[0]?.datasetId));
      out.push({ id: uid('map'), requirement: k.text, kind: 'kpi', sources: ds0 ? [ds0.label] : [], fields: [...new Set([...(built.main.field ? [built.main.field] : []), ...conds.map((c) => c.field)])], status: built.main.kind === 'ratio' || built.main.kind === 'avg' ? 'calculation_required' : 'available', note: built.main.description });
      continue;
    }
    const ds = findEntityDataset(metricText, profiles);
    if (!ds) {
      out.push({ id: uid('map'), requirement: k.text, kind: 'kpi', sources: [], fields: [], status: 'missing', note: `No uploaded dataset represents "${metricText.trim()}". This KPI cannot be calculated without additional data.` });
      continue;
    }
    const low = metricText.toLowerCase();
    const sources = [ds.label];
    const fields: string[] = [];
    let status: ReqMapping['status'] = 'available';
    let note = '';
    const kw = STATUS_WORDS.find((w) => low.includes(w));
    if (/rate|ratio|%|percent/.test(low)) {
      const num = kw ? findStatus(ds, kw) : null;
      const den = findStatus(ds, 'deliver');
      if (num) fields.push(num.column);
      if (den && den.column !== num?.column) fields.push(den.column);
      status = num ? 'calculation_required' : 'missing';
      note = num ? `Derived: ${num.column} = ${num.value} ÷ ${den ? `${den.column} = ${den.value}` : `all ${ds.entity.toLowerCase()} records`} × 100.` : `No status field indicating "${kw ?? 'success'}" was found in ${ds.label}.`;
    } else if (kw) {
      const st = findStatus(ds, kw);
      if (st) {
        fields.push(st.column);
        note = `Count of ${ds.entity.toLowerCase()} records where ${st.column} = ${st.value}.`;
      } else {
        status = 'missing';
        note = `${ds.label} has no field indicating "${kw}" status.`;
      }
    } else if (/(revenue|amount|value|sales|cost|spend|units|quantity|prescription|trx|nrx)/.test(low) && ds.columns.some((c) => c.role === 'measure')) {
      const mc = ds.columns.find((c) => c.role === 'measure' && low.split(/\s+/).some((w) => c.name.toLowerCase().includes(w.replace(/s$/, '')))) ?? ds.columns.find((c) => c.role === 'measure')!;
      fields.push(mc.name);
      status = 'calculation_required';
      note = `Aggregated as SUM(${mc.name}) from ${ds.label}.`;
    } else {
      fields.push(ds.primaryKey ?? '(row count)');
      note = `Count of ${ds.entity.toLowerCase()} records${ds.primaryKey ? ` (${ds.primaryKey})` : ''}.`;
    }
    if (dimText && status !== 'missing') {
      const f = findField(dimText, profiles, { roles: ['dimension', 'status', 'attribute', 'foreign_key'], prefer: ds.datasetId });
      if (!f) {
        status = 'missing';
        note += ` No field found for "${dimText}".`;
      } else if (f.datasetId === ds.datasetId) {
        fields.push(f.column);
      } else if (reachable(rels, ds.datasetId, f.datasetId)) {
        fields.push(`${f.column}, ${rels.find((r) => r.fromDataset === ds.datasetId)?.fromField ?? 'join key'}`);
        sources.push(f.profile.label);
        if (status === 'available') status = 'join_required';
        note += ` ${f.column} comes from ${f.profile.label} via join.`;
      } else {
        status = 'missing';
        note += ` ${f.column} exists in ${f.profile.label} but no relationship links it to ${ds.label}.`;
      }
    }
    out.push({ id: uid('map'), requirement: k.text, kind: 'kpi', sources, fields, status, note: note.trim() });
  }

  const seen = new Set<string>();
  for (const [kind, items] of [['dimension', spec.dimensions], ['filter', spec.filters]] as const) {
    for (const d of items) {
      const key = `${kind}:${d.text.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (/period|date|time/i.test(d.text)) {
        const acts = profiles.filter((p) => p.dateField && p.kind === 'activity');
        out.push({ id: uid('map'), requirement: d.text, kind, sources: acts.map((a) => a.label), fields: acts.map((a) => a.dateField!), status: acts.length ? 'available' : 'missing', note: acts.length ? 'Applied to each activity dataset’s event date.' : 'No date fields found in activity data.' });
        continue;
      }
      const f = findField(d.text, profiles, { roles: ['dimension', 'status', 'attribute', 'foreign_key'], prefer: primaryActivity?.datasetId });
      if (!f) {
        out.push({ id: uid('map'), requirement: d.text, kind, sources: [], fields: [], status: 'missing', note: `No field corresponding to "${d.text}" was found in the uploaded data.` });
        continue;
      }
      const joined = primaryActivity && f.datasetId !== primaryActivity.datasetId && reachable(rels, primaryActivity.datasetId, f.datasetId);
      out.push({
        id: uid('map'),
        requirement: d.text,
        kind,
        sources: [f.profile.label],
        fields: [f.column],
        status: f.score < 0.9 ? 'clarification' : joined ? 'join_required' : 'available',
        note: f.score < 0.9 ? `Closest match is ${f.profile.label}.${f.column} — please confirm.` : joined ? `Joined to activity data via ${rels.find((r) => r.toDataset === f.datasetId)?.toField ?? 'key'}.` : `${f.col.distinct} distinct values.`,
      });
    }
  }
  return out;
}

export function runDataIntelligence(datasets: DatasetMeta[], rowsOf: (id: string) => Row[], spec: RequirementSpec | null): DataUnderstanding {
  const profiles = datasets.map((d) => profileDataset(d, rowsOf(d.id)));
  const rels = detectRelationships(profiles, rowsOf);
  classifyDatasets(profiles, rels);
  const label = (id: string) => profiles.find((p) => p.datasetId === id)?.label ?? id;
  const issues = detectIssues(profiles, rels, label);
  const mappings = spec ? mapRequirements(spec, profiles, rels) : [];

  const suggestedMetrics: string[] = [];
  for (const p of profiles.filter((x) => x.kind === 'activity')) {
    suggestedMetrics.push(`Total ${p.entity.toLowerCase()}s — COUNT(${p.primaryKey ?? 'rows'}) from ${p.label}`);
    for (const c of p.columns.filter((c) => c.role === 'status'))
      for (const v of c.topValues.slice(0, 2)) suggestedMetrics.push(`${p.entity} records with ${c.name} = ${v.value}`);
    for (const c of p.columns.filter((c) => c.role === 'measure')) suggestedMetrics.push(`Sum / average of ${c.name} from ${p.label}`);
    const fk = rels.find((r) => r.fromDataset === p.datasetId);
    if (fk) suggestedMetrics.push(`Distinct ${label(fk.toDataset).replace(/ Master$/, '').toLowerCase()}s reached — COUNT DISTINCT(${fk.fromField}) in ${p.label}`);
  }

  const missingInfo = mappings.filter((m) => m.status === 'missing').map((m) => `${m.requirement}: ${m.note}`);
  if (!profiles.some((p) => p.kind === 'activity')) missingInfo.push('No transactional (activity) dataset with dates was detected; trend and period analysis will not be possible.');
  const acts = profiles.filter((p) => p.kind === 'activity').length;
  const masters = profiles.filter((p) => p.kind === 'master').length;
  const summary = `Identified ${profiles.length} dataset(s): ${acts} activity, ${masters} master, ${profiles.length - acts - masters} other. Detected ${rels.length} relationship(s) and ${issues.filter((i) => i.severity !== 'info').length} data-quality warning(s).${spec ? ` ${mappings.filter((m) => m.status !== 'missing').length}/${mappings.length} requirements can be fulfilled with the available data.` : ' Requirements not yet available — mapping pending.'}`;
  return { generatedAt: new Date().toISOString(), profiles, relationships: rels, issues, mappings, suggestedMetrics, missingInfo, summary };
}
