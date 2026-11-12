import type { AgentId, AgentRun, Defect, Project } from '@/types';
import { emptyProject, log, milestone, setStage } from './orchestrator';
import { useStore } from './store';
import { engineFor } from './engineCache';
import { applyClarification, extractRequirements } from '@/agents/requirementAgent';
import { runDataIntelligence } from '@/agents/dataAgent';
import { runFoundation } from '@/agents/foundationAgent';
import { applyDesignCommand, designStats, generateDesign } from '@/agents/designAgent';
import { buildDashboard } from '@/agents/developmentAgent';
import { generateTests } from '@/agents/testingAgent';
import { runCheck } from '@/agents/validators';
import { docBasis, generateDocs } from '@/agents/documentationAgent';
import { agentMeta } from '@/agents/registry';
import { DETERMINISTIC } from '@/agents/llm';
import { generateSampleData, SAMPLE_FILES, SAMPLE_NARRATIVE } from '@/lib/sampleData';
import { getRows } from '@/lib/rowStore';
import { humanize, pad, uid } from '@/lib/util';

/**
 * Builds the preloaded "HCP Engagement & Performance Analytics" demo project by
 * actually running every agent over the synthetic sample data. Manual UAT
 * entries are clearly attributed to a sample analyst persona.
 */
export function buildDemoProject(): Project {
  const base = Date.now() - 1000 * 60 * 60 * 26;
  let tick = 0;
  const at = (mins = 7) => new Date(base + (tick += mins) * 60_000).toISOString();
  const p = emptyProject(
    {
      name: 'HCP Engagement & Performance Analytics',
      client: 'Commercial Excellence – US',
      domain: 'Pharma commercial / HCP engagement',
      objective: 'Monitor how commercial teams engage healthcare professionals across accounts, regions and segments through calls and email campaigns.',
      audience: 'Commercial leadership and regional managers',
      problem: 'Engagement reporting is assembled manually from CRM and email platform extracts each week, causing delays and inconsistent numbers.',
      frequency: 'Weekly',
      period: 'Rolling 13 weeks (R13W) with previous-period comparison',
      keyQuestions: ['Are we reaching our Tier 1 accounts often enough?', 'Which segments receive the most call activity?', 'Is email engagement improving over time?', 'Which territories are under-engaged?'],
    },
    SAMPLE_NARRATIVE,
  );
  p.id = 'demo-hcp';
  p.isDemo = true;
  p.createdAt = at(0);
  const run = (agentId: AgentId, steps: string[], summary: string, inputs: string[], outputs: string[], warnings: string[] = []): AgentRun => ({
    id: uid('run'),
    agentId,
    startedAt: at(1),
    finishedAt: at(2),
    status: warnings.length ? 'completed_with_warnings' : 'completed',
    engine: DETERMINISTIC,
    summary,
    steps: steps.map((label) => ({ label, status: 'done' })),
    inputs,
    outputs,
    warnings,
    errors: [],
  });
  const record = (r: AgentRun) => {
    p.runs.unshift(r);
    p.history.unshift({ id: uid('h'), at: r.finishedAt!, actor: agentMeta(r.agentId).name, kind: 'agent', message: r.summary!, stage: agentMeta(r.agentId).stage });
  };
  const gate = (msg: string, stage: Project['history'][number]['stage']) => p.history.unshift({ id: uid('h'), at: at(3), actor: 'User', kind: 'gate', message: msg, stage });

  // ── Requirements
  let spec = extractRequirements(SAMPLE_NARRATIVE, { ...p.info, audience: '' });
  p.chat.push({ id: uid('msg'), role: 'agent', at: at(0), text: "Hi — I'm the Requirement Intelligence Agent. Describe the dashboard you need in plain language." });
  p.chat.push({ id: uid('msg'), role: 'user', at: at(1), text: SAMPLE_NARRATIVE });
  record(run('requirement', ['Reading the business brief', 'Identifying objectives and stakeholders', 'Extracting KPIs, dimensions and filters', 'Inferring visualisations, pages and datasets', 'Checking for ambiguities and missing information'], `Extracted ${spec.objectives.length} objectives, ${spec.kpis.length} KPIs, ${spec.dimensions.length} dimensions, ${spec.filters.length} filters and ${spec.pages.length} pages; ${spec.ambiguities.length} clarification question(s).`, ['Project brief', 'Natural-language requirement'], ['Draft requirements']));
  const answers: Record<string, string> = { timeGrain: 'Weekly', comparison: 'Yes, show current vs previous', audience: 'Commercial leadership' };
  for (const a of [...spec.ambiguities]) {
    p.chat.push({ id: uid('msg'), role: 'agent', at: at(1), text: a.question, options: a.options, clarificationId: a.id });
    spec = applyClarification(spec, a, answers[a.field] ?? a.options[0]);
    p.chat.push({ id: uid('msg'), role: 'user', at: at(1), text: answers[a.field] ?? a.options[0] });
  }
  spec.filters.push({ id: uid('req'), text: 'State', source: 'user' });
  spec.missing = spec.missing.filter((m) => !/frequency|period not/i.test(m));
  p.chat.push({ id: uid('msg'), role: 'user', at: at(1), text: 'add filter State' }, { id: uid('msg'), role: 'agent', at: at(0), text: 'Added "State" to Filters. All clarification questions are answered.' });
  p.requirements = spec;
  p.requirementsStatus = 'approved';
  p.requirementsVersion = 1;
  p.versions.requirements.push({ version: 1, status: 'approved', at: at(2), note: 'Approved by Commercial Excellence lead', snapshot: structuredClone(spec) });
  setStage(p, 'requirements', 'approved');
  milestone(p, 'Requirements Draft');
  milestone(p, 'Requirements Approved');
  gate('Approved Requirements Specification v1', 'requirements');

  // ── Data
  const data = generateSampleData();
  for (const f of SAMPLE_FILES) {
    const rows = data[f.key];
    const cols = Object.keys(rows[0]);
    p.datasets.push({ id: `sample:${f.key}`, name: humanize(f.fileName.replace('.csv', '')), fileName: f.fileName, format: 'sample', rowCount: rows.length, columnCount: cols.length, columns: cols, uploadedAt: at(2), status: 'profiled', isSample: true, sizeBytes: JSON.stringify(rows).length });
  }
  milestone(p, 'Data Ingested');
  const u = runDataIntelligence(p.datasets, getRows, spec);
  for (const d of p.datasets) d.name = u.profiles.find((x) => x.datasetId === d.id)?.label ?? d.name;
  u.relationships.forEach((r) => (r.status = 'confirmed'));
  p.understanding = u;
  record(run('data', ['Inspecting 4 dataset structure(s)', 'Profiling columns', 'Classifying identifiers, dates, dimensions and measures', 'Detecting keys and relationships', 'Inferring what each dataset represents', 'Assessing data quality', 'Mapping requirements to available fields'], u.summary, ['Requirements Specification', 'Uploaded datasets'], ['Data Understanding Report'], u.issues.filter((i) => i.severity !== 'info').map((i) => i.message)));
  setStage(p, 'data', 'completed');
  milestone(p, 'Data Understanding Complete');
  gate('Reviewed and confirmed the Data Understanding Report (3 relationships confirmed)', 'data');

  // ── Foundation
  const f = runFoundation(u, spec);
  p.foundation = f;
  p.foundationVersion = 1;
  p.versions.foundation.push({ version: 1, status: 'approved', at: at(3), note: 'Reviewed and approved', snapshot: structuredClone(f) });
  record(run('foundation', ['Reading the Data Understanding Report', 'Designing fact and dimension tables', 'Mapping source fields to reporting fields', 'Deriving KPI calculation logic', 'Identifying metric dependencies and data gaps'], `Proposed ${f.tables.filter((t) => t.kind === 'fact').length} fact and ${f.tables.filter((t) => t.kind === 'dimension').length} dimension table(s), ${f.fieldMaps.length} field mappings and ${f.measures.length} KPI definitions.`, ['Requirements Specification', 'Data Understanding Report'], ['Reporting Foundation v1']));
  setStage(p, 'foundation', 'approved');
  milestone(p, 'Reporting Foundation Reviewed');
  gate('Approved Reporting Foundation v1', 'foundation');

  // ── Design (v1 generated, then edited with the assistant → v2 approved)
  let design = generateDesign(u, f, spec);
  const s1 = designStats(design);
  record(run('design', ['Reading approved requirements', 'Checking data availability', 'Selecting KPI cards', 'Choosing chart types', 'Laying out pages', 'Configuring filters'], `Generated ${s1.pages} dashboard pages with ${s1.kpis} KPI cards, ${s1.charts} charts, ${s1.tables} tables and ${s1.filters} filters.`, ['Requirements Specification', 'Reporting Foundation'], ['Dashboard Wireframe v1']));
  p.versions.design.push({ version: 1, status: 'superseded', at: at(1), note: 'Generated by Dashboard Design Agent', snapshot: structuredClone(design) });
  p.designChat.push({ id: uid('msg'), role: 'agent', at: at(1), text: `Generated ${s1.pages} pages. Ask me to modify the design.` });
  for (const cmd of ['Add a specialty filter', 'Replace the email delivery status distribution with a bar chart']) {
    const r = applyDesignCommand(design, cmd, { u, f });
    design = r.spec;
    p.designChat.push({ id: uid('msg'), role: 'user', at: at(1), text: cmd }, { id: uid('msg'), role: 'agent', at: at(0), text: r.reply });
  }
  p.design = { spec: design, version: 2, status: 'approved', approvedAt: at(4), savedAt: at(0) };
  p.versions.design.push({ version: 2, status: 'approved', at: at(0), note: 'Approved – frozen for development', snapshot: structuredClone(design) });
  setStage(p, 'design', 'approved');
  milestone(p, 'Wireframe Generated');
  milestone(p, 'Design Approved');
  gate('Approved design v2 — frozen and handed to the Dashboard Development Agent', 'design');

  // ── Development
  milestone(p, 'Development Started');
  const engine = engineFor(p)!;
  const build = buildDashboard(design, 2, u, f, engine);
  p.dashboard = build;
  p.versions.dashboard.push({ version: 1, status: 'approved', at: at(5), note: 'Built from design v2', snapshot: { summary: build.summary, designVersion: 2 } });
  record(run('development', ['Analysing approved design v2', 'Mapping data fields', 'Creating KPI calculation logic', 'Building dashboard components', 'Configuring visualisations', 'Implementing filters and cross-filtering', 'Implementing period comparisons', 'Running component validation', 'Generating dashboard preview'], `Generated dashboard v1: ${build.summary.pages} pages, ${build.summary.kpis} KPI cards, ${build.summary.charts} charts, ${build.summary.tables} tables, ${build.summary.filters} filters. ${build.validations.filter((v) => v.ok).length}/${build.validations.length} components validated.`, ['Approved Design Specification', 'Reporting Foundation', 'Datasets'], ['Generated Dashboard v1', 'Development Summary'], build.warnings));
  setStage(p, 'development', 'completed');
  milestone(p, 'Dashboard Generated');

  // ── Testing: generate + execute automated + partial sample UAT
  const cases = generateTests(build, u, f, spec);
  record(run('testing', ['Inspecting approved requirements', 'Identifying components in dashboard v1', 'Generating functional, UI/UX, filter and navigation tests', 'Generating calculation and data-validation tests', 'Generating business QC scenarios'], `Generated ${cases.length} test cases: ${cases.filter((c) => c.suite === 'technical').length} technical and ${cases.filter((c) => c.suite === 'qc').length} business QC scenarios.`, ['Generated Dashboard', 'Requirements Specification', 'Datasets'], ['Test Case Library', 'Business QC Scenarios']));
  milestone(p, 'Testing Generated');
  const runAt = at(4);
  const defects: Defect[] = [];
  for (const c of cases.filter((x) => x.check)) {
    const r = runCheck(c.check!, { spec: design, u, measures: f.measures, rowsOf: getRows, engine });
    Object.assign(c, { status: r.status, actual: r.actual, evidence: r.evidence, lastRunAt: runAt, executedBy: 'Testing Agent (automated)', runCount: 1 });
    if (r.status === 'Failed') defects.push({ id: `DEF-${pad(defects.length + 1)}`, title: `${c.component}: ${r.actual}`.slice(0, 140), testId: c.id, severity: c.priority, status: 'Open', description: `${c.objective}\n\nExpected: ${c.expected}\nActual: ${r.actual}\n\nEvidence: ${r.evidence}`, createdAt: runAt, raisedBy: 'Testing Agent (automated)' });
  }
  const passed = cases.filter((c) => c.status === 'Passed').length;
  const failed = cases.filter((c) => c.status === 'Failed').length;
  record(run('testing', ['Preparing automated validations', 'Recomputing KPIs independently from source rows', 'Reconciling chart, table and filter outputs', 'Recording results and evidence'], `Executed ${cases.filter((c) => c.check).length} automated test(s): ${passed} passed, ${failed} failed.`, ['Generated Dashboard', 'Datasets'], ['Test Results'], cases.filter((c) => c.status === 'Failed').map((c) => `${c.id}: ${c.actual}`)));
  milestone(p, 'Automated Testing Completed');
  // sample analyst UAT on a subset of manual tests
  const analyst = 'Priya Raman (UAT Analyst)';
  const manual = cases.filter((c) => c.execution === 'Manual');
  manual.slice(0, Math.ceil(manual.length * 0.45)).forEach((c, i) => {
    c.status = 'Passed';
    c.actual = 'Behaves as expected during UAT walkthrough.';
    c.executedBy = analyst;
    c.lastRunAt = at(1);
    c.runCount = 1;
    if (i === 1) c.comments.push({ id: uid('cm'), at: at(0), by: analyst, text: 'Formatting is consistent; % sign shown on rate KPIs.' });
  });
  const ux = manual.find((c) => c.status === 'Not Started' && /table/i.test(c.objective));
  if (ux) {
    ux.status = 'In Progress';
    ux.comments.push({ id: uid('cm'), at: at(1), by: analyst, text: 'Sorting works; checking search on account names next.' });
  }
  for (const d of defects) if (/duplicate/i.test(d.title)) d.status = 'In Progress';
  p.testing = { generatedAt: at(0), dashboardVersion: 1, version: 1, cases, defects, runs: [{ at: runAt, label: 'Run 1', executed: cases.filter((c) => c.check).length, passed, failed }], signoff: { status: 'pending' }, automatedCompletedAt: runAt };
  p.versions.tests.push({ version: 1, status: 'draft', at: runAt, note: 'Generated for dashboard v1', snapshot: { total: cases.length, passed: cases.filter((c) => c.status === 'Passed').length, failed } });
  setStage(p, 'testing', 'in_progress');
  p.history.unshift({ id: uid('h'), at: at(2), actor: analyst, kind: 'user', message: `UAT in progress: ${manual.filter((c) => c.status === 'Passed').length}/${manual.length} manual tests passed`, stage: 'testing' });

  // ── Documentation (progressive draft)
  const docs = generateDocs(p, 1);
  p.documentation = { generatedAt: at(3), version: 1, final: false, docs, basis: docBasis(p) };
  p.versions.documentation.push({ version: 1, status: 'draft', at: at(0), note: 'Progressive draft', snapshot: { docs: docs.map((d) => d.title), final: false } });
  record(run('documentation', ['Collecting latest approved artifacts', 'Writing business requirements & data dictionary', 'Writing mapping, KPI and functional specifications', 'Compiling test, UAT and technical documentation'], `Generated ${docs.length} documents (package v1, draft — UAT sign-off pending).`, ['All approved artifacts', 'Test Results'], ['Documentation Package v1'], ['Draft package: final documentation requires UAT sign-off.']));
  milestone(p, 'Documentation Generated');
  setStage(p, 'documentation', 'in_progress');
  log(p, 'Orchestrator', 'system', 'Analyst UAT pending — sign-off required before the final documentation package and release.', 'testing');
  // align milestone timestamps with the simulated timeline
  const ordered = [...p.history].reverse();
  p.milestones.forEach((m, i) => (m.at = ordered[Math.min(ordered.length - 1, Math.round((i / p.milestones.length) * ordered.length))].at));
  p.updatedAt = at(0);
  return p;
}

/** Bump when the preloaded project's content changes, so existing browsers get the refreshed version. */
const SEED_VERSION = 3;

export function ensureDemo(force = false) {
  const s = useStore.getState();
  if (s.seeded && s.seedVersion === SEED_VERSION && !force) return;
  const demo = buildDemoProject();
  s.setProjects((ps) => [demo, ...ps.filter((x) => x.id !== demo.id)]);
  s.markSeeded(SEED_VERSION);
}
