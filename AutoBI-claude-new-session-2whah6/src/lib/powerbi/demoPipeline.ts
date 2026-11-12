import type { DatasetMeta, Row } from '@/types';
import { applyClarification, extractRequirements } from '@/agents/requirementAgent';
import { runDataIntelligence } from '@/agents/dataAgent';
import { runFoundation } from '@/agents/foundationAgent';
import { generateDesign } from '@/agents/designAgent';
import { buildDashboard } from '@/agents/developmentAgent';
import { Engine } from '@/lib/engine';
import { humanize } from '@/lib/util';
import { buildPowerBiProject } from './index';

/**
 * Runs Celestra's rule-based agent pipeline (requirements → data → foundation →
 * design → development) on a set of tables, as the app does for a new project with
 * AI turned off, and exports the result to Power BI. Used by tests and by
 * scripts/export-powerbi.ts — not by the app itself.
 */
export function runDemoPipeline(name: string, narrative: string, tables: { name: string; rows: Row[] }[]) {
  const data: Record<string, Row[]> = {};
  const metas: DatasetMeta[] = tables.map((t) => {
    const id = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    data[id] = t.rows;
    const columns = [...new Set(t.rows.slice(0, 500).flatMap((r) => Object.keys(r)))];
    return { id, name: humanize(t.name), fileName: `${t.name}.csv`, format: 'csv', rowCount: t.rows.length, columnCount: columns.length, columns, uploadedAt: '', status: 'uploaded', isSample: false };
  });
  const rowsOf = (id: string) => data[id] ?? [];
  let spec = extractRequirements(narrative, { audience: 'Leadership' });
  for (const a of spec.ambiguities) spec = applyClarification(spec, a, a.options[0]);
  const u = runDataIntelligence(metas, rowsOf, spec);
  const f = runFoundation(u, spec);
  const design = generateDesign(u, f, spec);
  const engine = new Engine({ profiles: u.profiles, relationships: u.relationships, measures: f.measures, rowsOf });
  const build = buildDashboard(design, 1, u, f, engine);
  const pbi = buildPowerBiProject({ name, profiles: u.profiles, relationships: u.relationships, foundation: f, spec: build.spec, rowsOf, anchor: engine.anchor, minDate: engine.minDate });
  return { spec, u, f, design, build, engine, rowsOf, data, pbi };
}
