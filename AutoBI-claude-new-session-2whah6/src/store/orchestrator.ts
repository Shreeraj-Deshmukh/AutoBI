import type {
  AgentId,
  AgentRun,
  ChatMessage,
  Clarification,
  DashboardSpec,
  DatasetMeta,
  Defect,
  Foundation,
  HistoryEvent,
  MeasureDef,
  Milestone,
  Project,
  ProjectInfo,
  ReqItem,
  Row,
  RequirementSection,
  ReleaseState,
  StageId,
  StageStatus,
  TestCase,
  UatSignoff,
} from '@/types';
import { getProject, mutate, useStore } from './store';
import { engineFor } from './engineCache';
import { agentMeta, STAGES } from '@/agents/registry';
import { DETERMINISTIC, aiActive, engineLabel, withAI, type AIResult } from '@/agents/llm';
import { aiDefineMeasure, aiDescribeData, aiDesignEdit, aiExecutiveSummary, aiExtractRequirements, aiGenerateDesign, aiProposeMeasures, aiRespond } from '@/agents/aiAgents';
import { buildMeasureFromText } from '@/agents/kpiBuilder';
import { applyClarification, extractRequirements, respondToMessage } from '@/agents/requirementAgent';
import { mapRequirements, runDataIntelligence } from '@/agents/dataAgent';
import { fillRequirementGaps, measureLogic, reconcileMappings, runFoundation } from '@/agents/foundationAgent';
import { applyDesignCommand, designStats, generateDesign } from '@/agents/designAgent';
import { buildDashboard } from '@/agents/developmentAgent';
import { generateTests } from '@/agents/testingAgent';
import { runCheck } from '@/agents/validators';
import { docBasis, generateDocs, summarize } from '@/agents/documentationAgent';
import { getRows, putRows, deleteRows } from '@/lib/rowStore';
import { proposeRelease } from '@/lib/access';
import { FEATURES } from '@/config/features';
import { IngestError, coerce, parseFile } from '@/lib/ingest';
import { generateSampleData, SAMPLE_FILES } from '@/lib/sampleData';
import { humanize, nowIso, pad, sleep, uid } from '@/lib/util';
import { prettify } from '@/lib/fieldLabels';

// ───────────────────────────── helpers ─────────────────────────────
const ORDER: StageId[] = STAGES.map((s) => s.id);

export function emptyProject(info: ProjectInfo, narrative = ''): Project {
  const t = nowIso();
  const stages = Object.fromEntries(ORDER.map((s) => [s, { status: 'not_started' as StageStatus }])) as Project['stages'];
  return {
    id: uid('prj'),
    createdAt: t,
    updatedAt: t,
    isDemo: false,
    info,
    narrative,
    chat: [],
    requirements: null,
    requirementsStatus: 'none',
    requirementsVersion: 0,
    datasets: [],
    understanding: null,
    foundation: null,
    foundationVersion: 0,
    design: null,
    designChat: [],
    dashboard: null,
    testing: null,
    documentation: null,
    stages,
    milestones: [],
    history: [],
    runs: [],
    versions: { requirements: [], foundation: [], design: [], dashboard: [], tests: [], documentation: [] },
  };
}

export function log(p: Project, actor: string, kind: HistoryEvent['kind'], message: string, stage?: StageId) {
  p.history.unshift({ id: uid('h'), at: nowIso(), actor, kind, message, stage });
  if (p.history.length > 300) p.history.length = 300;
}

export function setStage(p: Project, s: StageId, status: StageStatus, clearReview = false) {
  p.stages[s] = { ...p.stages[s], status, updatedAt: nowIso(), ...(clearReview ? { needsReview: undefined } : {}) };
}

export function milestone(p: Project, m: Milestone) {
  if (!p.milestones.some((x) => x.name === m)) p.milestones.push({ name: m, at: nowIso() });
}

/** When an upstream artifact changes after approval, flag downstream stages for review (never overwrite them). */
function flagDownstream(p: Project, from: StageId, reason: string) {
  const idx = ORDER.indexOf(from);
  for (const s of ORDER.slice(idx + 1)) {
    const st = p.stages[s];
    if (['approved', 'completed', 'pending_approval', 'in_progress'].includes(st.status) && !st.needsReview) {
      st.needsReview = reason;
      log(p, 'Orchestrator', 'warning', `${STAGES.find((x) => x.id === s)!.label} marked for review: ${reason}`, s);
    }
  }
}

const toast = (k: 'success' | 'error' | 'info', t: string) => useStore.getState().toast(k, t);

/** Record which engine actually produced an agent's output (AI or deterministic fallback). */
function stamp(run: AgentRun, meta: { engine: string; aiError?: string }) {
  run.engine = meta.engine;
  if (meta.aiError) run.warnings.push(`Azure AI Foundry call failed (${meta.aiError}); the deterministic engine was used instead.`);
}

// ───────────────────────────── gates ─────────────────────────────
export function stageGate(p: Project, s: StageId): { open: boolean; reason?: string } {
  switch (s) {
    case 'requirements':
      return { open: true };
    case 'data':
      return p.requirements ? { open: true } : { open: false, reason: 'Extract requirements first so the Data Intelligence Agent can map them to data.' };
    case 'foundation':
      return p.stages.data.status === 'completed' ? { open: true } : { open: false, reason: 'Data understanding must be completed and confirmed.' };
    case 'design':
      return p.foundation ? { open: true } : { open: false, reason: 'A reporting foundation must be generated before wireframes.' };
    case 'development':
      return p.design?.status === 'approved' ? { open: true } : { open: false, reason: 'Design approval is mandatory before development.' };
    case 'testing':
      return p.dashboard ? { open: true } : { open: false, reason: 'The dashboard must be generated before tests can be created.' };
    case 'documentation':
      return p.requirementsStatus !== 'none' ? { open: true } : { open: false, reason: 'Documentation is generated progressively once requirements exist.' };
  }
}

export function progress(p: Project) {
  const done = ORDER.filter((s) => ['approved', 'completed'].includes(p.stages[s].status)).length;
  return Math.round((done / ORDER.length) * 100);
}

export function currentStage(p: Project): StageId {
  return ORDER.find((s) => !['approved', 'completed'].includes(p.stages[s].status)) ?? 'documentation';
}

// ───────────────────────────── agent runner ─────────────────────────────
interface StepDef {
  label: string;
  detail?: string;
}

/**
 * Executes an agent with visible steps. The real work (`work`) runs synchronously
 * (deterministic engine); steps are revealed progressively so users can follow
 * what the agent is doing. Errors are captured on the run and surfaced.
 */
async function runAgent<T>(pid: string, agent: AgentId, steps: StepDef[], inputs: string[], work: () => T | Promise<T>, finalize: (p: Project, result: T, run: AgentRun) => void, opts: { delay?: number; ai?: boolean } = {}): Promise<T | null> {
  const run: AgentRun = {
    id: uid('run'),
    agentId: agent,
    startedAt: nowIso(),
    status: 'running',
    engine: opts.ai ? engineLabel() : DETERMINISTIC,
    steps: steps.map((s) => ({ label: s.label, status: 'pending' as const, detail: s.detail })),
    inputs,
    outputs: [],
    warnings: [],
    errors: [],
  };
  mutate(pid, (p) => {
    p.runs.unshift(run);
    if (p.runs.length > 120) p.runs.length = 120;
  });
  const updRun = (fn: (r: AgentRun) => void) =>
    mutate(pid, (p) => {
      const r = p.runs.find((x) => x.id === run.id);
      if (r) fn(r);
    });
  const delay = opts.delay ?? 320;
  try {
    for (let i = 0; i < steps.length - 1; i++) {
      updRun((r) => (r.steps[i].status = 'running'));
      await sleep(delay);
      updRun((r) => (r.steps[i].status = 'done'));
    }
    updRun((r) => (r.steps[steps.length - 1].status = 'running'));
    const result = await work();
    await sleep(delay);
    mutate(pid, (p) => {
      const r = p.runs.find((x) => x.id === run.id)!;
      r.steps.forEach((s) => s.status === 'running' && (s.status = 'done'));
      finalize(p, result, r);
      r.finishedAt = nowIso();
      r.status = r.errors.length ? 'failed' : r.warnings.length ? 'completed_with_warnings' : 'completed';
      log(p, agentMeta(agent).name, 'agent', r.summary ?? 'Completed', agentMeta(agent).stage);
    });
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    mutate(pid, (p) => {
      const r = p.runs.find((x) => x.id === run.id)!;
      r.steps.forEach((s) => s.status === 'running' && (s.status = 'error'));
      r.errors.push(msg);
      r.status = 'failed';
      r.finishedAt = nowIso();
      r.summary = `Failed: ${msg}`;
      log(p, agentMeta(agent).name, 'warning', `Run failed: ${msg}. Resolve the issue and re-run the agent.`, agentMeta(agent).stage);
    });
    toast('error', `${agentMeta(agent).name} failed: ${msg}`);
    return null;
  }
}

export const isRunning = (p: Project, agent?: AgentId) => p.runs.some((r) => r.status === 'running' && (!agent || r.agentId === agent));

// ───────────────────────────── projects ─────────────────────────────
export function createProject(info: ProjectInfo, narrative: string) {
  const p = emptyProject(info, narrative);
  setStage(p, 'requirements', 'in_progress');
  log(p, 'User', 'user', `Created project "${info.name}"`, 'requirements');
  p.chat.push({ id: uid('msg'), role: 'agent', at: nowIso(), text: `Describe the dashboard you need — what to monitor, how to break it down and which filters. I'll turn it into a specification and only ask about what's unclear.` });
  useStore.getState().setProjects((ps) => [p, ...ps]);
  return p.id;
}

export function deleteProject(id: string) {
  const p = getProject(id);
  p?.datasets.forEach((d) => !d.isSample && deleteRows(d.id));
  useStore.getState().setProjects((ps) => ps.filter((x) => x.id !== id));
}

export function updateInfo(pid: string, patch: Partial<ProjectInfo>) {
  mutate(pid, (p) => {
    p.info = { ...p.info, ...patch };
  });
}

// ───────────────────────────── requirements ─────────────────────────────
export async function analyseRequirements(pid: string, narrative: string) {
  const p0 = getProject(pid)!;
  mutate(pid, (p) => {
    p.narrative = narrative;
    p.chat.push({ id: uid('msg'), role: 'user', at: nowIso(), text: narrative });
  });
  let meta: AIResult<ReturnType<typeof extractRequirements>> = { value: null!, engine: DETERMINISTIC };
  await runAgent(
    pid,
    'requirement',
    [{ label: 'Reading the business brief' }, { label: 'Identifying objectives and stakeholders' }, { label: 'Extracting KPIs, dimensions and filters' }, { label: 'Inferring visualisations, pages and datasets' }, { label: 'Checking for ambiguities and missing information' }],
    ['Project brief', 'Natural-language requirement'],
    async () => {
      const base = extractRequirements(narrative, p0.info);
      meta = await withAI(() => aiExtractRequirements(narrative, p0.info, base), () => base);
      return meta.value;
    },
    (p, spec, run) => {
      stamp(run, meta);
      const wasApproved = p.requirementsStatus === 'approved';
      p.requirements = spec;
      p.requirementsStatus = 'draft';
      setStage(p, 'requirements', 'in_progress');
      milestone(p, 'Requirements Draft');
      if (wasApproved) flagDownstream(p, 'requirements', 'requirements were re-extracted');
      const open = spec.ambiguities.filter((a) => !a.answer);
      run.outputs.push('Draft requirements');
      run.summary = `Extracted ${spec.objectives.length} objectives, ${spec.kpis.length} KPIs, ${spec.dimensions.length} dimensions, ${spec.filters.length} filters and ${spec.pages.length} pages; ${open.length} clarification question(s).`;
      if (spec.missing.length) run.warnings.push(...spec.missing);
      p.chat.push({ id: uid('msg'), role: 'agent', at: nowIso(), text: `${run.summary}\n\nI've filled in the sections on the left.${open.length ? ` To fill a gap: ${open[0].question}` : ''}`, options: open[0]?.options, clarificationId: open[0]?.id });
    },
    { ai: true },
  );
}

export async function chat(pid: string, text: string) {
  const p = getProject(pid)!;
  if (!p.requirements) return analyseRequirements(pid, text);
  const runId = uid('run');
  mutate(pid, (pp) => {
    pp.chat.push({ id: uid('msg'), role: 'user', at: nowIso(), text });
    pp.runs.unshift({ id: runId, agentId: 'requirement', startedAt: nowIso(), status: 'running', engine: engineLabel(), steps: [{ label: 'Interpreting your message', status: 'running' }, { label: 'Updating requirements', status: 'pending' }], inputs: ['User message'], outputs: [], warnings: [], errors: [] });
  });
  const cur = getProject(pid)!;
  const res = await withAI(() => aiRespond(cur.requirements!, text, cur.info), () => respondToMessage(cur.requirements!, text, cur.info));
  mutate(pid, (pp) => {
    const changed = JSON.stringify(res.value.spec) !== JSON.stringify(pp.requirements);
    pp.requirements = res.value.spec;
    if (res.value.infoPatch) pp.info = { ...pp.info, ...res.value.infoPatch };
    if (changed) reopenRequirements(pp);
    const next = res.value.spec.ambiguities.find((a) => !a.answer);
    const msg: ChatMessage = { id: uid('msg'), role: 'agent', at: nowIso(), text: next && !res.value.reply.includes(next.question) && aiActive() ? `${res.value.reply}\n\n${next.question}` : res.value.reply };
    if (next) {
      msg.options = next.options;
      msg.clarificationId = next.id;
    }
    pp.chat.push(msg);
    const r = pp.runs.find((x) => x.id === runId)!;
    Object.assign(r, { finishedAt: nowIso(), status: res.aiError ? 'completed_with_warnings' : 'completed', summary: `Conversational refinement: ${res.value.reply.split('\n')[0]}`, outputs: changed ? ['Requirements (updated)'] : [] });
    r.steps = [{ label: 'Interpreting your message', status: 'done' }, { label: 'Updating requirements', status: changed ? 'done' : 'warning' }];
    stamp(r, res);
  });
}

export function answerClarification(pid: string, c: Clarification, answer: string) {
  mutate(pid, (p) => {
    p.chat.push({ id: uid('msg'), role: 'user', at: nowIso(), text: answer });
    p.requirements = applyClarification(p.requirements!, c, answer);
    if (c.field === 'audience' && !p.info.audience) p.info.audience = answer;
    if (c.field === 'timeGrain' && !p.info.frequency) p.info.frequency = humanize(`${p.requirements.timeGrain}ly`);
    reopenRequirements(p);
    const next = p.requirements.ambiguities.find((a) => !a.answer);
    p.chat.push({ id: uid('msg'), role: 'agent', at: nowIso(), text: next ? `Thanks, noted. ${next.question}` : 'Thanks — all clarification questions are answered. When the sections look right, click "Generate Requirements Specification".', options: next?.options, clarificationId: next?.id });
  });
}

function reopenRequirements(p: Project) {
  if (p.requirementsStatus === 'approved') {
    p.requirementsStatus = 'draft';
    setStage(p, 'requirements', 'in_progress');
    flagDownstream(p, 'requirements', `requirements changed after approval (v${p.requirementsVersion})`);
  } else if (p.stages.requirements.status === 'pending_approval') setStage(p, 'requirements', 'in_progress');
}

export function editRequirementItems(pid: string, section: RequirementSection, items: ReqItem[]) {
  mutate(pid, (p) => {
    if (!p.requirements) return;
    p.requirements = { ...p.requirements, [section]: items };
    reopenRequirements(p);
  });
}

export function generateRequirementSpec(pid: string) {
  mutate(pid, (p) => {
    if (!p.requirements) return;
    setStage(p, 'requirements', 'pending_approval');
    p.requirementsVersion += 1;
    p.versions.requirements.forEach((v) => v.status === 'draft' && (v.status = 'superseded'));
    p.versions.requirements.push({ version: p.requirementsVersion, status: 'draft', at: nowIso(), note: 'Requirements Specification generated', snapshot: structuredClone(p.requirements) });
    log(p, 'Requirement Intelligence Agent', 'agent', `Generated Requirements Specification v${p.requirementsVersion}`, 'requirements');
  });
  toast('success', 'Requirements Specification generated — review and approve to continue.');
}

export function approveRequirements(pid: string) {
  mutate(pid, (p) => {
    if (!p.requirements) return;
    if (p.stages.requirements.status !== 'pending_approval') {
      p.requirementsVersion += 1;
      p.versions.requirements.push({ version: p.requirementsVersion, status: 'draft', at: nowIso(), note: 'Specification generated at approval', snapshot: structuredClone(p.requirements) });
    }
    p.requirementsStatus = 'approved';
    p.versions.requirements.forEach((v) => (v.status = v.version === p.requirementsVersion ? 'approved' : 'superseded'));
    setStage(p, 'requirements', 'approved', true);
    milestone(p, 'Requirements Approved');
    log(p, 'User', 'gate', `Approved Requirements Specification v${p.requirementsVersion}`, 'requirements');
    if (p.stages.data.status === 'not_started') setStage(p, 'data', 'in_progress');
    // refresh mapping if data already understood
    if (p.understanding) p.understanding.mappings = mapRequirements(p.requirements, p.understanding.profiles, p.understanding.relationships);
    if (p.understanding && p.foundation) reconcileMappings(p.understanding, p.foundation);
  });
  toast('success', 'Requirements approved. Next: upload datasets for the Data Intelligence Agent.');
}

// ───────────────────────────── data ─────────────────────────────
export async function uploadFiles(pid: string, files: File[]) {
  const errors: string[] = [];
  let refreshOnly = getProject(pid)!.stages.data.status === 'completed';
  for (const file of files) {
    try {
      const tables = await parseFile(file);
      for (const t of tables) {
        // same file (and sheet) uploaded again → replace that dataset's rows in place (a data correction)
        const existing = getProject(pid)!.datasets.find((d) => d.fileName === t.fileName && (tables.length === 1 || d.name.toLowerCase().includes(t.name.split('–').pop()!.trim().toLowerCase())));
        if (existing) {
          await putRows(existing.id, t.rows);
          const sameShape = existing.columns.join('|') === t.columns.join('|');
          if (!sameShape) refreshOnly = false;
          mutate(pid, (p) => {
            const d = p.datasets.find((x) => x.id === existing.id)!;
            Object.assign(d, { rowCount: t.rows.length, columnCount: t.columns.length, columns: t.columns, uploadedAt: nowIso(), status: 'uploaded', sizeBytes: t.sizeBytes });
            log(p, 'User', 'user', `Replaced ${t.fileName} with a corrected version: ${t.rows.length} rows`, 'data');
          });
          continue;
        }
        refreshOnly = false;
        const id = uid('ds');
        await putRows(id, t.rows);
        const meta: DatasetMeta = { id, name: humanize(t.name), fileName: t.fileName, format: t.format, rowCount: t.rows.length, columnCount: t.columns.length, columns: t.columns, uploadedAt: nowIso(), status: 'uploaded', isSample: false, sizeBytes: t.sizeBytes };
        mutate(pid, (p) => {
          p.datasets.push(meta);
          log(p, 'User', 'user', `Uploaded ${t.fileName}${tables.length > 1 ? ` (${t.name})` : ''}: ${t.rows.length} rows × ${t.columns.length} columns`, 'data');
        });
      }
    } catch (e) {
      const ie = e instanceof IngestError ? e : null;
      const msg = ie ? `${ie.message} Impact: ${ie.impact} Action: ${ie.suggestion}` : `${file.name}: ${(e as Error).message}`;
      errors.push(msg);
      mutate(pid, (p) => log(p, 'Data Intelligence Agent', 'warning', `Ingestion failed — ${msg}`, 'data'));
    }
  }
  if (refreshOnly && !errors.length) {
    // corrected data with the same structure: re-profile, keep approvals, re-run tests
    await runDataIntelligenceAgent(pid, { refresh: true });
    return errors;
  }
  mutate(pid, (p) => {
    if (p.datasets.length) milestone(p, 'Data Ingested');
    if (p.stages.data.status === 'not_started') setStage(p, 'data', 'in_progress');
    if (p.stages.data.status === 'completed') {
      setStage(p, 'data', 'in_progress');
      flagDownstream(p, 'data', 'datasets changed');
    }
  });
  if (errors.length) errors.forEach((e) => toast('error', e));
  if (getProject(pid)!.datasets.length) await runDataIntelligenceAgent(pid);
  return errors;
}

export interface WarehouseRequest {
  provider: 'databricks' | 'snowflake';
  connection?: Record<string, string>;
  catalog: string;
  schema: string;
}

async function warehouseCall<T>(path: string, body: object): Promise<T> {
  const r = await fetch(`api/warehouse/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `Request failed (${r.status})` }));
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j as T;
}

export const listWarehouseTables = (req: WarehouseRequest) => warehouseCall<{ tables: string[] }>('tables', req).then((r) => r.tables);

/** Import tables from Databricks / Snowflake as datasets, then run the Data Intelligence Agent. */
export async function importWarehouseTables(pid: string, req: WarehouseRequest, tables: string[], limit: number) {
  const errors: string[] = [];
  const name = req.provider === 'databricks' ? 'Databricks' : 'Snowflake';
  for (const table of tables) {
    try {
      const out = await warehouseCall<{ columns: string[]; rows: Row[]; truncated: boolean; source: string }>('import', { ...req, table, limit });
      if (!out.rows.length) throw new Error(`${table} returned no rows`);
      const rows = out.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, coerce(v)])));
      const id = uid('ds');
      await putRows(id, rows);
      mutate(pid, (p) => {
        p.datasets.push({ id, name: humanize(table), fileName: out.source, format: req.provider, rowCount: rows.length, columnCount: out.columns.length, columns: out.columns, uploadedAt: nowIso(), status: 'uploaded', isSample: false });
        log(p, 'User', 'user', `Imported ${out.source} from ${name}: ${rows.length} rows${out.truncated ? ` (limited to ${limit})` : ''}`, 'data');
      });
    } catch (e) {
      errors.push(`${table}: ${(e as Error).message}`);
    }
  }
  errors.forEach((e) => toast('error', `${name} import failed — ${e}`));
  if (tables.length > errors.length) {
    mutate(pid, (p) => {
      milestone(p, 'Data Ingested');
      if (p.stages.data.status === 'completed') flagDownstream(p, 'data', 'datasets changed');
      if (p.stages.data.status !== 'pending_approval') setStage(p, 'data', 'in_progress');
    });
    await runDataIntelligenceAgent(pid);
  }
  return errors;
}

export async function loadSampleDatasets(pid: string) {
  const data = generateSampleData();
  mutate(pid, (p) => {
    for (const f of SAMPLE_FILES) {
      const id = `sample:${f.key}`;
      if (p.datasets.some((d) => d.id === id)) continue;
      const rows = data[f.key];
      const cols = Object.keys(rows[0]);
      p.datasets.push({ id, name: humanize(f.fileName.replace('.csv', '')), fileName: f.fileName, format: 'sample', rowCount: rows.length, columnCount: cols.length, columns: cols, uploadedAt: nowIso(), status: 'uploaded', isSample: true, sizeBytes: JSON.stringify(rows).length });
    }
    milestone(p, 'Data Ingested');
    if (p.stages.data.status !== 'completed') setStage(p, 'data', 'in_progress');
    log(p, 'User', 'user', 'Loaded HCP engagement datasets (Account Master, Call Activity, Email Activity, Campaign Master)', 'data');
  });
  await runDataIntelligenceAgent(pid);
}

export async function removeDataset(pid: string, id: string) {
  const ds = getProject(pid)?.datasets.find((d) => d.id === id);
  if (!ds) return;
  if (!ds.isSample) await deleteRows(id);
  mutate(pid, (p) => {
    p.datasets = p.datasets.filter((d) => d.id !== id);
    log(p, 'User', 'user', `Removed dataset ${ds.fileName}`, 'data');
    if (p.understanding) {
      setStage(p, 'data', 'in_progress');
      flagDownstream(p, 'data', `dataset ${ds.fileName} removed`);
    }
  });
  if (getProject(pid)!.datasets.length) await runDataIntelligenceAgent(pid);
  else mutate(pid, (p) => (p.understanding = null));
}

export async function runDataIntelligenceAgent(pid: string, opts: { refresh?: boolean } = {}) {
  const p0 = getProject(pid)!;
  const datasets = p0.datasets;
  mutate(pid, (p) => p.datasets.forEach((d) => (d.status = 'profiling')));
  let dmeta: AIResult<ReturnType<typeof runDataIntelligence>> = { value: null!, engine: DETERMINISTIC };
  await runAgent(
    pid,
    'data',
    [
      { label: `Inspecting ${datasets.length} dataset structure(s)` },
      { label: 'Profiling columns: types, missing values, distinct counts, ranges' },
      { label: 'Classifying identifiers, dates, dimensions and measures' },
      { label: 'Detecting primary / foreign keys and relationships' },
      { label: 'Inferring what each dataset represents' },
      { label: 'Assessing data quality' },
      { label: p0.requirements ? 'Mapping requirements to available fields' : 'Requirements unavailable – skipping mapping' },
    ],
    p0.requirements ? ['Requirements Specification', 'Uploaded datasets'] : ['Uploaded datasets'],
    async () => {
      const base = runDataIntelligence(datasets, getRows, p0.requirements);
      dmeta = await withAI(() => aiDescribeData(base, p0.info.domain), () => base);
      return dmeta.value;
    },
    (p, u, run) => {
      stamp(run, dmeta);
      const prev = p.understanding;
      // preserve user decisions on relationships / resolved issues
      if (prev) {
        for (const r of u.relationships) {
          const old = prev.relationships.find((x) => x.fromDataset === r.fromDataset && x.fromField === r.fromField && x.toDataset === r.toDataset);
          if (old) {
            r.id = old.id;
            r.status = old.status;
          }
        }
      }
      p.understanding = u;
      for (const d of p.datasets) {
        const prof = u.profiles.find((x) => x.datasetId === d.id);
        d.status = prof ? 'profiled' : 'error';
        if (prof) d.name = prof.label;
      }
      milestone(p, 'Data Ingested');
      if (opts.refresh) {
        retestAutomated(p, 'Corrected data loaded');
        run.summary = `Data refreshed. ${u.summary}`;
      } else {
        if (p.stages.data.status === 'completed') flagDownstream(p, 'data', 'data understanding was regenerated');
        setStage(p, 'data', 'pending_approval');
      }
      run.outputs.push('Data Understanding Report');
      run.summary = run.summary ?? u.summary;
      run.warnings.push(...u.issues.filter((i) => i.severity !== 'info').map((i) => i.message));
      if (!p.requirements) run.warnings.push('Requirements are not available yet — requirement-to-data mapping is pending.');
    },
    { ai: true },
  );
}

export function setRelationshipStatus(pid: string, relId: string, status: 'confirmed' | 'rejected' | 'suggested') {
  mutate(pid, (p) => {
    const r = p.understanding?.relationships.find((x) => x.id === relId);
    if (!r) return;
    r.status = status;
    if (p.requirements) p.understanding!.mappings = mapRequirements(p.requirements, p.understanding!.profiles, p.understanding!.relationships);
    if (p.foundation) reconcileMappings(p.understanding!, p.foundation);
    log(p, 'User', 'user', `${humanize(status)} relationship ${r.fromField} → ${r.toField}`, 'data');
    if (p.stages.data.status === 'completed') flagDownstream(p, 'data', 'relationships changed');
  });
}

export function toggleIssue(pid: string, issueId: string) {
  mutate(pid, (p) => {
    const i = p.understanding?.issues.find((x) => x.id === issueId);
    if (i) {
      i.resolved = !i.resolved;
      log(p, 'User', 'user', `${i.resolved ? 'Acknowledged' : 'Re-opened'} data-quality observation: ${i.type}`, 'data');
    }
  });
}

export function confirmUnderstanding(pid: string) {
  const p = getProject(pid)!;
  if (p.requirementsStatus !== 'approved') {
    toast('error', 'Requirements must be approved before the data mapping can be finalised.');
    return false;
  }
  mutate(pid, (pp) => {
    if (pp.requirements) pp.understanding!.mappings = mapRequirements(pp.requirements, pp.understanding!.profiles, pp.understanding!.relationships);
    if (pp.foundation) reconcileMappings(pp.understanding!, pp.foundation);
    setStage(pp, 'data', 'completed', true);
    milestone(pp, 'Data Understanding Complete');
    log(pp, 'User', 'gate', 'Reviewed and confirmed the Data Understanding Report', 'data');
    if (pp.stages.foundation.status === 'not_started') setStage(pp, 'foundation', 'in_progress');
  });
  if (!getProject(pid)!.foundation) runFoundationAgent(pid);
  return true;
}

// ───────────────────────────── foundation ─────────────────────────────
export async function runFoundationAgent(pid: string) {
  const p0 = getProject(pid)!;
  if (!p0.understanding) return;
  let fmeta: AIResult<ReturnType<typeof runFoundation>> = { value: null!, engine: DETERMINISTIC };
  let aiRejected: string[] = [];
  await runAgent(
    pid,
    'foundation',
    [{ label: 'Reading the Data Understanding Report' }, { label: 'Designing fact and dimension tables' }, { label: 'Mapping source fields to reporting fields' }, { label: 'Deriving KPI calculation logic' }, { label: 'Identifying metric dependencies and data gaps' }],
    ['Requirements Specification', 'Data Understanding Report'],
    async () => {
      fmeta = await withAI(async () => {
        // the model defines the requirement KPIs; rules only fill gaps it left
        const generic = runFoundation(p0.understanding!, p0.requirements, { requirementKpis: false });
        const r = await aiProposeMeasures(p0.requirements, p0.understanding!, generic.measures);
        aiRejected = r.rejected;
        return fillRequirementGaps({ ...generic, measures: [...generic.measures, ...r.measures] }, p0.understanding!, p0.requirements);
      }, () => runFoundation(p0.understanding!, p0.requirements));
      return fmeta.value;
    },
    (p, f, run) => {
      stamp(run, fmeta);
      if (aiRejected.length) run.warnings.push(`AI proposals rejected after validation against the data: ${aiRejected.slice(0, 5).join('; ')}`);
      const hadApproved = p.stages.foundation.status === 'approved';
      if (p.understanding) reconcileMappings(p.understanding, f);
      p.foundation = f;
      p.foundationVersion += 1;
      p.versions.foundation.push({ version: p.foundationVersion, status: 'draft', at: nowIso(), note: 'Generated by Reporting Foundation Agent', snapshot: structuredClone(f) });
      setStage(p, 'foundation', 'pending_approval', true);
      if (hadApproved) flagDownstream(p, 'foundation', 'reporting foundation regenerated');
      run.outputs.push(`Reporting Foundation v${p.foundationVersion}`);
      run.summary = `Proposed ${f.tables.filter((t) => t.kind === 'fact').length} fact and ${f.tables.filter((t) => t.kind === 'dimension').length} dimension table(s), ${f.fieldMaps.length} field mappings and ${f.measures.length} KPI definitions.`;
      if (f.gaps.length) run.warnings.push(...f.gaps);
    },
    { ai: true },
  );
}

/** Add a KPI described in plain words (AI when available, otherwise the rule-based builder). */
export async function defineKpiFromText(pid: string, text: string) {
  const p0 = getProject(pid)!;
  if (!p0.understanding || !p0.foundation) return null;
  const runId = uid('run');
  mutate(pid, (p) => p.runs.unshift({ id: runId, agentId: 'foundation', startedAt: nowIso(), status: 'running', engine: engineLabel(), steps: [{ label: 'Interpreting KPI request', status: 'running' }, { label: 'Validating fields and values against the data', status: 'pending' }], inputs: ['KPI request'], outputs: [], warnings: [], errors: [] }));
  const res = await withAI(
    () => aiDefineMeasure(text, p0.understanding!, p0.foundation!.measures),
    () => {
      const b = buildMeasureFromText(text, p0.understanding!, p0.foundation!.measures);
      if (!b) throw new Error(`Couldn't work out "${text}" from the data. Name the status, value or numeric threshold (e.g. "patients with PA pending for more than 14 days").`);
      return b;
    },
  ).catch((e: Error) => {
    toast('error', e.message);
    return null;
  });
  mutate(pid, (p) => (p.runs = p.runs.filter((r) => r.id !== runId)));
  if (!res) return null;
  mutate(pid, (p) => {
    const f = p.foundation!;
    const label = (id: string) => p.understanding?.profiles.find((x) => x.datasetId === id)?.label ?? id;
    f.measures.push(...res.value.extra, { ...res.value.main, userModified: true });
    for (const x of f.measures) x.logic = measureLogic(x, f.measures, label);
    if (p.understanding) reconcileMappings(p.understanding, f);
    p.runs.unshift({ id: uid('run'), agentId: 'foundation', startedAt: nowIso(), finishedAt: nowIso(), status: res.aiError ? 'completed_with_warnings' : 'completed', engine: res.engine, summary: `Defined KPI "${res.value.main.name}" = ${f.measures.find((m) => m.id === res.value.main.id)?.logic}`, steps: [{ label: 'Interpreting KPI request', status: 'done' }, { label: 'Validating fields and values against the data', status: 'done' }], inputs: ['KPI request'], outputs: ['KPI definition'], warnings: res.aiError ? [`Azure AI Foundry call failed (${res.aiError}); the rule-based builder was used.`] : [], errors: [] });
    touchFoundation(p, `Added KPI "${res.value.main.name}" from: ${text}`, 'logic');
  });
  toast('success', `KPI "${res.value.main.name}" added.`);
  return res.value.main;
}

/** Mark executed automated tests for re-run (the dashboard reads data and KPI logic live). */
function retestAutomated(p: Project, reason: string) {
  let n = 0;
  for (const c of p.testing?.cases ?? []) if (c.check && c.status !== 'Not Started' && c.status !== 'Requires Retesting') { c.status = 'Requires Retesting'; n++; }
  if (n) log(p, 'Orchestrator', 'system', `${reason} — ${n} automated test(s) marked for re-run.`, 'testing');
}

function touchFoundation(p: Project, note: string, scope: 'logic' | 'structure' = 'structure') {
  // KPI logic changes flow straight into the live dashboard: re-test instead of re-building everything downstream
  if (scope === 'logic') retestAutomated(p, note);
  else if (p.stages.foundation.status === 'approved') flagDownstream(p, 'foundation', note);
  setStage(p, 'foundation', 'pending_approval');
  log(p, 'User', 'user', note, 'foundation');
}

export function updateMeasure(pid: string, m: MeasureDef) {
  mutate(pid, (p) => {
    const f = p.foundation!;
    const i = f.measures.findIndex((x) => x.id === m.id);
    const next = { ...m, userModified: true };
    if (i >= 0) f.measures[i] = next;
    else f.measures.push(next);
    const label = (id: string) => p.understanding?.profiles.find((x) => x.datasetId === id)?.label ?? id;
    for (const x of f.measures) x.logic = measureLogic(x, f.measures, label);
    if (p.understanding) reconcileMappings(p.understanding, f);
    touchFoundation(p, `${i >= 0 ? 'Edited' : 'Added'} KPI "${m.name}"`, 'logic');
  });
}

export function deleteMeasure(pid: string, id: string) {
  mutate(pid, (p) => {
    const f = p.foundation!;
    const used = f.measures.filter((m) => m.numeratorId === id || m.denominatorId === id);
    if (used.length) {
      toast('error', `Cannot delete: used by ${used.map((u) => u.name).join(', ')}.`);
      return;
    }
    const m = f.measures.find((x) => x.id === id);
    f.measures = f.measures.filter((x) => x.id !== id);
    touchFoundation(p, `Deleted KPI "${m?.name}"`);
  });
}

export function updateFieldMap(pid: string, id: string, patch: Partial<Foundation['fieldMaps'][number]>) {
  mutate(pid, (p) => {
    const fm = p.foundation!.fieldMaps.find((x) => x.id === id);
    if (!fm) return;
    const oldLabel = prettify(fm.reportingField);
    Object.assign(fm, patch);
    const newLabel = prettify(fm.reportingField);
    // keep a draft design's titles and filter labels in step with renamed fields
    if (patch.reportingField !== undefined && oldLabel !== newLabel && p.design && p.design.status === 'draft') {
      const re = new RegExp(`\\b${oldLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      for (const pg of p.design.spec.pages) for (const c of pg.components) c.title = c.title.replace(re, newLabel);
      for (const f of p.design.spec.filters) if (f.field === `${fm.sourceDataset}::${fm.sourceField}`) f.label = newLabel;
    }
    const what = patch.included === false ? `Excluded ${fm.sourceField} from reporting` : patch.included === true ? `Included ${fm.sourceField} in reporting` : `Renamed ${fm.sourceField} to "${newLabel}"`;
    touchFoundation(p, what);
  });
}

export function approveFoundation(pid: string) {
  mutate(pid, (p) => {
    if (!p.foundation) return;
    p.foundationVersion += 1;
    p.versions.foundation.forEach((v) => (v.status = 'superseded'));
    p.versions.foundation.push({ version: p.foundationVersion, status: 'approved', at: nowIso(), note: 'Reviewed and approved', snapshot: structuredClone(p.foundation) });
    setStage(p, 'foundation', 'approved', true);
    milestone(p, 'Reporting Foundation Reviewed');
    log(p, 'User', 'gate', `Approved Reporting Foundation v${p.foundationVersion}`, 'foundation');
    if (p.stages.design.status === 'not_started') setStage(p, 'design', 'in_progress');
  });
  if (!getProject(pid)!.design) runDesignAgent(pid);
}

// ───────────────────────────── design ─────────────────────────────
export async function runDesignAgent(pid: string) {
  const p0 = getProject(pid)!;
  if (!p0.understanding || !p0.foundation) return;
  let dmeta2: AIResult<DashboardSpec> = { value: null!, engine: DETERMINISTIC };
  await runAgent(
    pid,
    'design',
    [{ label: 'Reading approved requirements' }, { label: 'Checking data availability for each requirement' }, { label: 'Selecting KPI cards and comparison logic' }, { label: 'Choosing chart types for each breakdown' }, { label: 'Laying out pages and visual hierarchy' }, { label: 'Configuring filters and default period' }],
    ['Requirements Specification', 'Reporting Foundation'],
    async () => {
      const base = generateDesign(p0.understanding!, p0.foundation!, p0.requirements);
      dmeta2 = await withAI(() => aiGenerateDesign(p0.understanding!, p0.foundation!, p0.requirements, base), () => base);
      return dmeta2.value;
    },
    (p, spec, run) => {
      stamp(run, dmeta2);
      const prevApproved = p.design?.status === 'approved';
      const version = (p.design?.version ?? 0) + 1;
      p.design = { spec, version, status: 'draft', savedAt: nowIso() };
      p.versions.design.forEach((v) => v.status === 'draft' && (v.status = 'superseded'));
      p.versions.design.push({ version, status: 'draft', at: nowIso(), note: 'Generated by Dashboard Design Agent', snapshot: structuredClone(spec) });
      setStage(p, 'design', 'pending_approval', true);
      milestone(p, 'Wireframe Generated');
      if (prevApproved) flagDownstream(p, 'design', `design regenerated (v${version})`);
      const s = designStats(spec);
      run.outputs.push(`Dashboard Wireframe v${version}`);
      run.summary = `Generated ${s.pages} dashboard pages with ${s.kpis} KPI cards, ${s.charts} charts, ${s.tables} tables and ${s.filters} filters.`;
      p.designChat.push({ id: uid('msg'), role: 'agent', at: nowIso(), text: `${run.summary} Ask me to modify it — e.g. "Add a payer filter" or "Show HCPs with more than 5 patients delayed in PA".` });
    },
    { ai: true },
  );
}

/** Any edit to an approved design creates a new draft version requiring re-approval. */
export function updateDesign(pid: string, spec: DashboardSpec, note: string) {
  mutate(pid, (p) => {
    if (!p.design) return;
    if (p.design.status === 'approved') {
      p.design = { spec, version: p.design.version + 1, status: 'draft', savedAt: nowIso() };
      setStage(p, 'design', 'pending_approval');
      flagDownstream(p, 'design', `design changed after approval — v${p.design.version} requires re-approval`);
      log(p, 'Orchestrator', 'warning', `Approved design was modified: created draft v${p.design.version}. Re-approval required.`, 'design');
    } else {
      p.design.spec = spec;
      if (p.stages.design.status !== 'pending_approval') setStage(p, 'design', 'pending_approval');
    }
    log(p, 'User', 'user', note, 'design');
  });
}

export async function designCommand(pid: string, text: string, activePageId?: string) {
  const p = getProject(pid)!;
  if (!p.design || !p.understanding || !p.foundation) return;
  const runId = uid('run');
  mutate(pid, (pp) => {
    pp.designChat.push({ id: uid('msg'), role: 'user', at: nowIso(), text });
    pp.runs.unshift({ id: runId, agentId: 'design', startedAt: nowIso(), status: 'running', engine: engineLabel(), steps: [{ label: 'Interpreting change request', status: 'running' }, { label: 'Updating wireframe', status: 'pending' }], inputs: ['Design change request', `Wireframe v${pp.design!.version}`], outputs: [], warnings: [], errors: [] });
  });
  const ctx = { u: p.understanding, f: p.foundation, activePageId };
  const res = await withAI(() => aiDesignEdit(p.design!.spec, text, ctx), () => applyDesignCommand(p.design!.spec, text, ctx));
  mutate(pid, (pp) => {
    pp.designChat.push({ id: uid('msg'), role: 'agent', at: nowIso(), text: res.value.reply });
    const r = pp.runs.find((x) => x.id === runId)!;
    Object.assign(r, { finishedAt: nowIso(), status: res.value.changed ? 'completed' : 'completed_with_warnings', summary: `Design change: "${text}" → ${res.value.reply}`, outputs: res.value.changed ? ['Wireframe (updated)'] : [] });
    r.steps = [{ label: 'Interpreting change request', status: 'done' }, { label: 'Updating wireframe', status: res.value.changed ? 'done' : 'warning' }];
    if (!res.value.changed) r.warnings.push(res.value.reply);
    stamp(r, res);
  });
  if (res.value.changed) updateDesign(pid, res.value.spec, `Design assistant: ${text}`);
}

export function saveDesignDraft(pid: string) {
  mutate(pid, (p) => {
    if (!p.design) return;
    p.design.savedAt = nowIso();
    const last = p.versions.design[p.versions.design.length - 1];
    if (last && last.version === p.design.version && last.status === 'draft') {
      last.snapshot = structuredClone(p.design.spec);
      last.at = nowIso();
    } else p.versions.design.push({ version: p.design.version, status: 'draft', at: nowIso(), note: 'Saved as draft', snapshot: structuredClone(p.design.spec) });
    log(p, 'User', 'user', `Saved design v${p.design.version} as draft`, 'design');
  });
  toast('success', 'Design saved as draft.');
}

export function approveDesign(pid: string) {
  const p = getProject(pid)!;
  if (p.stages.foundation.status !== 'approved') {
    toast('error', 'The reporting foundation must be reviewed and approved before design approval.');
    return false;
  }
  mutate(pid, (pp) => {
    const d = pp.design!;
    d.status = 'approved';
    d.approvedAt = nowIso();
    pp.versions.design.forEach((v) => v.status !== 'superseded' && (v.status = 'superseded'));
    pp.versions.design.push({ version: d.version, status: 'approved', at: nowIso(), note: 'Approved – frozen for development', snapshot: structuredClone(d.spec) });
    setStage(pp, 'design', 'approved', true);
    milestone(pp, 'Design Approved');
    log(pp, 'User', 'gate', `Approved design v${d.version} — frozen and handed to the Dashboard Development Agent`, 'design');
    setStage(pp, 'development', 'in_progress');
  });
  runDevelopmentAgent(pid);
  return true;
}

// ───────────────────────────── development ─────────────────────────────
export async function runDevelopmentAgent(pid: string) {
  const p0 = getProject(pid)!;
  if (p0.design?.status !== 'approved') {
    toast('error', 'Design approval is mandatory before development.');
    return;
  }
  mutate(pid, (p) => milestone(p, 'Development Started'));
  const engine = engineFor(p0)!;
  await runAgent(
    pid,
    'development',
    [
      { label: `Analysing approved design v${p0.design.version}` },
      { label: 'Mapping data fields' },
      { label: 'Creating KPI calculation logic' },
      { label: 'Building dashboard components' },
      { label: 'Configuring visualisations' },
      { label: 'Implementing filters and cross-filtering' },
      { label: 'Implementing period comparisons' },
      ...(FEATURES.rowLevelSecurity ? [{ label: 'Configuring row-level security' }] : []),
      { label: 'Running component validation' },
      { label: 'Generating dashboard preview' },
    ],
    ['Approved Design Specification', 'Reporting Foundation', 'Datasets'],
    () => buildDashboard(p0.design!.spec, p0.design!.version, p0.understanding!, p0.foundation!, engine, p0.dashboard?.version ?? 0),
    (p, build, run) => {
      const failed = build.validations.filter((v) => !v.ok);
      p.dashboard = build;
      if (FEATURES.rowLevelSecurity && !p.release?.users.length) {
        const rel = proposeRelease(p.understanding!, getRows);
        if (rel) {
          p.release = { ...rel, published: p.release?.published };
          run.outputs.push('Row-level security roles');
          log(p, 'Dashboard Development Agent', 'agent', `Configured row-level security on ${rel.securityField!.split('::')[1]} for ${rel.users.length - 1} field user(s)`, 'development');
        }
      }
      p.versions.dashboard.push({ version: build.version, status: 'approved', at: nowIso(), note: `Built from design v${build.designVersion}`, snapshot: { summary: build.summary, designVersion: build.designVersion } });
      setStage(p, 'development', failed.length === build.validations.length ? 'blocked' : 'completed', true);
      milestone(p, 'Dashboard Generated');
      if (p.testing) flagDownstream(p, 'development', `dashboard rebuilt (v${build.version}) — regenerate or re-run tests`);
      if (p.stages.testing.status === 'not_started') setStage(p, 'testing', 'in_progress');
      run.outputs.push(`Generated Dashboard v${build.version}`, 'Development Summary');
      run.summary = `Generated dashboard v${build.version}: ${build.summary.pages} pages, ${build.summary.kpis} KPI cards, ${build.summary.charts} charts, ${build.summary.tables} tables, ${build.summary.filters} filters. ${build.validations.length - failed.length}/${build.validations.length} components validated.`;
      run.warnings.push(...build.warnings);
      if (failed.length === build.validations.length) run.errors.push('No component could be rendered — check the design and reporting foundation.');
    },
    { delay: 260 },
  );
}

// ───────────────────────────── testing ─────────────────────────────
export async function runTestingAgent(pid: string) {
  const p0 = getProject(pid)!;
  if (!p0.dashboard || !p0.understanding || !p0.foundation) return;
  await runAgent(
    pid,
    'testing',
    [{ label: 'Inspecting approved requirements' }, { label: `Identifying components in dashboard v${p0.dashboard.version}` }, { label: 'Generating functional, UI/UX, filter and navigation tests' }, { label: 'Generating calculation and data-validation tests' }, { label: 'Generating business QC scenarios' }],
    ['Generated Dashboard', 'Requirements Specification', 'Datasets'],
    () => generateTests(p0.dashboard!, p0.understanding!, p0.foundation!, p0.requirements),
    (p, cases, run) => {
      const prev = p.testing;
      // preserve user-added tests and manual results where the test still exists
      const userTests = prev?.cases.filter((c) => c.userAdded) ?? [];
      for (const c of cases) {
        const old = prev?.cases.find((o) => o.id === c.id && o.objective === c.objective && o.execution === 'Manual');
        if (old && old.status !== 'Not Started') Object.assign(c, { status: 'Requires Retesting', actual: old.actual, comments: old.comments, attachments: old.attachments });
      }
      const version = (prev?.version ?? 0) + 1;
      p.testing = { generatedAt: nowIso(), dashboardVersion: p.dashboard!.version, version, cases: [...cases, ...userTests], defects: prev?.defects ?? [], runs: prev?.runs ?? [], signoff: { status: 'pending' } };
      p.versions.tests.push({ version, status: 'draft', at: nowIso(), note: `Generated for dashboard v${p.dashboard!.version}`, snapshot: { total: cases.length, passed: 0, failed: 0 } });
      setStage(p, 'testing', 'in_progress', true);
      milestone(p, 'Testing Generated');
      const tech = cases.filter((c) => c.suite === 'technical').length;
      run.outputs.push('Test Case Library', 'Business QC Scenarios');
      run.summary = `Generated ${cases.length} test cases: ${tech} technical and ${cases.length - tech} business QC scenarios (${cases.filter((c) => c.execution === 'Automated').length} automated, ${cases.filter((c) => c.execution === 'Manual').length} manual).`;
    },
  );
}

export async function executeTests(pid: string, ids?: string[]) {
  const p0 = getProject(pid)!;
  if (!p0.testing || !p0.dashboard) return;
  const engine = engineFor(p0)!;
  const targets = p0.testing.cases.filter((c) => c.check && (!ids || ids.includes(c.id)));
  if (!targets.length) {
    toast('info', 'No automated tests selected. Manual tests are executed by an analyst in the UAT tab.');
    return;
  }
  await runAgent(
    pid,
    'testing',
    [{ label: `Preparing ${targets.length} automated validation(s)` }, { label: 'Recomputing KPIs independently from source rows' }, { label: 'Reconciling chart, table and filter outputs' }, { label: 'Recording results and evidence' }],
    ['Generated Dashboard', 'Datasets'],
    () =>
      targets.map((t) => {
        try {
          return { id: t.id, ...runCheck(t.check!, { spec: p0.dashboard!.spec, u: p0.understanding!, measures: p0.foundation!.measures, rowsOf: getRows, engine, release: p0.release }) };
        } catch (e) {
          return { id: t.id, status: 'Blocked' as const, actual: `Execution error: ${(e as Error).message}`, evidence: 'The validator raised an error; investigate and retest.' };
        }
      }),
    (p, results, run) => {
      const T = p.testing!;
      const at = nowIso();
      for (const r of results) {
        const c = T.cases.find((x) => x.id === r.id)!;
        c.status = r.status;
        c.actual = r.actual;
        c.evidence = r.evidence;
        c.lastRunAt = at;
        c.executedBy = 'Testing Agent (automated)';
        c.runCount += 1;
        if (r.status === 'Passed') T.defects.filter((d) => d.testId === c.id && (d.status === 'Open' || d.status === 'In Progress')).forEach((d) => { d.status = 'Resolved'; d.resolution = 'Retest passed (automated)'; });
        if (r.status === 'Failed' && !T.defects.some((d) => d.testId === c.id && d.status !== 'Closed' && d.status !== 'Resolved')) {
          T.defects.push({ id: `DEF-${pad(T.defects.length + 1)}`, title: `${c.component}: ${r.actual}`.slice(0, 140), testId: c.id, severity: c.priority, status: 'Open', description: `${c.objective}\n\nExpected: ${c.expected}\nActual: ${r.actual}\n\nEvidence: ${r.evidence}`, createdAt: at, raisedBy: 'Testing Agent (automated)' });
        }
      }
      const passed = results.filter((r) => r.status === 'Passed').length;
      const failed = results.filter((r) => r.status === 'Failed').length;
      T.runs.push({ at, label: ids?.length === 1 ? ids[0] : `Run ${T.runs.length + 1}`, executed: results.length, passed, failed });
      const allAuto = T.cases.filter((c) => c.check);
      if (allAuto.every((c) => c.status !== 'Not Started')) {
        T.automatedCompletedAt = T.automatedCompletedAt ?? at;
        milestone(p, 'Automated Testing Completed');
      }
      const s = summarize(T.cases);
      const last = p.versions.tests[p.versions.tests.length - 1];
      if (last) last.snapshot = { total: s.total, passed: s.passed, failed: s.failed };
      run.outputs.push('Test Results');
      run.summary = `Executed ${results.length} automated test(s): ${passed} passed, ${failed} failed, ${results.length - passed - failed} need attention.`;
      if (failed) run.warnings.push(...results.filter((r) => r.status === 'Failed').map((r) => `${r.id}: ${r.actual}`));
    },
    { delay: 220 },
  );
}

export function updateTest(pid: string, id: string, patch: Partial<TestCase>, by = 'Analyst') {
  mutate(pid, (p) => {
    const c = p.testing?.cases.find((x) => x.id === id);
    if (!c) return;
    const statusChanged = patch.status && patch.status !== c.status;
    Object.assign(c, patch);
    if (statusChanged && ['Passed', 'Failed', 'Blocked'].includes(patch.status!)) {
      c.lastRunAt = nowIso();
      c.executedBy = by;
      c.runCount += 1;
      log(p, by, 'user', `Marked ${id} as ${patch.status}`, 'testing');
    }
    // every failed check is tracked as a defect automatically
    const T = p.testing!;
    if (patch.status === 'Failed' && !T.defects.some((d) => d.testId === id && (d.status === 'Open' || d.status === 'In Progress')))
      T.defects.push({ id: `DEF-${pad(T.defects.length + 1)}`, title: `${c.component}: ${c.actual || c.objective}`.slice(0, 140), testId: id, severity: c.priority, status: 'Open', description: `${c.objective}\nExpected: ${c.expected}\nActual: ${c.actual}`, createdAt: nowIso(), raisedBy: by });
    if (patch.status === 'Passed') T.defects.filter((d) => d.testId === id && (d.status === 'Open' || d.status === 'In Progress')).forEach((d) => { d.status = 'Resolved'; d.resolution = `Retested and passed by ${by}`; });
    if (p.testing!.signoff.status === 'approved' && statusChanged) {
      p.testing!.signoff = { status: 'pending' };
      setStage(p, 'testing', 'in_progress');
      flagDownstream(p, 'testing', 'test results changed after UAT sign-off');
    }
  });
}

export function addComment(pid: string, id: string, text: string, by = 'Analyst') {
  mutate(pid, (p) => {
    const c = p.testing?.cases.find((x) => x.id === id);
    c?.comments.push({ id: uid('cm'), at: nowIso(), by, text });
  });
}

export function addTestCase(pid: string, c: Partial<TestCase> & { suite: 'technical' | 'qc' }) {
  mutate(pid, (p) => {
    const T = p.testing!;
    const prefix = c.suite === 'qc' ? 'QC' : 'TC';
    const n = Math.max(0, ...T.cases.filter((x) => x.id.startsWith(prefix)).map((x) => parseInt(x.id.slice(2), 10) || 0)) + 1;
    T.cases.push({ id: `${prefix}${pad(n)}`, category: c.suite === 'qc' ? 'Data Integrity' : 'Functional Testing', page: p.dashboard?.spec.pages[0]?.name ?? '', component: '', elementType: 'Custom', objective: '', preconditions: '', steps: [], testData: '', expected: '', actual: '', status: 'Not Started', priority: 'Medium', execution: 'Manual', evidence: '', comments: [], attachments: [], runCount: 0, userAdded: true, ...c });
    log(p, 'User', 'user', `Added test case ${prefix}${pad(n)}`, 'testing');
  });
}

export function deleteTestCase(pid: string, id: string) {
  mutate(pid, (p) => {
    p.testing!.cases = p.testing!.cases.filter((c) => c.id !== id);
    log(p, 'User', 'user', `Deleted test case ${id}`, 'testing');
  });
}

export function raiseDefect(pid: string, d: Omit<Defect, 'id' | 'createdAt' | 'status'>) {
  mutate(pid, (p) => {
    const T = p.testing!;
    const id = `DEF-${pad(T.defects.length + 1)}`;
    T.defects.push({ ...d, id, createdAt: nowIso(), status: 'Open' });
    log(p, d.raisedBy, 'user', `Raised defect ${id}: ${d.title}`, 'testing');
  });
}

export function updateDefect(pid: string, id: string, patch: Partial<Defect>) {
  mutate(pid, (p) => {
    const d = p.testing!.defects.find((x) => x.id === id);
    if (!d) return;
    Object.assign(d, patch);
    if (patch.status === 'Resolved') {
      const t = p.testing!.cases.find((c) => c.id === d.testId);
      if (t && t.status === 'Failed') t.status = 'Requires Retesting';
    }
    log(p, 'User', 'user', `Defect ${id} → ${d.status}`, 'testing');
  });
}

export function uatGateIssues(p: Project): string[] {
  const T = p.testing;
  if (!T) return ['Tests have not been generated.'];
  const out: string[] = [];
  if (!T.automatedCompletedAt) out.push('Automated tests have not all been executed.');
  const pending = T.cases.filter((c) => ['Not Started', 'In Progress', 'Requires Retesting'].includes(c.status));
  if (pending.length) out.push(`${pending.length} test case(s) are not yet executed or need retesting.`);
  const openCrit = T.defects.filter((d) => (d.status === 'Open' || d.status === 'In Progress') && (d.severity === 'Critical' || d.severity === 'High'));
  if (openCrit.length) out.push(`${openCrit.length} open Critical/High defect(s) — resolve them or record an accepted risk.`);
  if (p.stages.development.needsReview) out.push('Dashboard has changed since tests were generated.');
  return out;
}

export function signOffUat(pid: string, s: UatSignoff) {
  const p = getProject(pid)!;
  const issues = uatGateIssues(p);
  const blocking = issues.filter((i) => !i.includes('Critical/High') || !s.acceptedRisks);
  if (s.status === 'approved' && blocking.length) {
    toast('error', `UAT cannot be approved: ${blocking[0]}`);
    return false;
  }
  mutate(pid, (pp) => {
    pp.testing!.signoff = { ...s, at: nowIso() };
    if (s.status === 'approved') {
      setStage(pp, 'testing', 'approved', true);
      milestone(pp, 'UAT Completed');
      const last = pp.versions.tests[pp.versions.tests.length - 1];
      if (last) last.status = 'approved';
      if (pp.stages.documentation.status === 'not_started') setStage(pp, 'documentation', 'in_progress');
    } else setStage(pp, 'testing', 'blocked');
    log(pp, s.by ?? 'Analyst', 'gate', `UAT ${s.status === 'approved' ? 'signed off' : 'rejected'}${s.comments ? `: ${s.comments}` : ''}`, 'testing');
  });
  return true;
}

// ───────────────────────────── documentation ─────────────────────────────
export async function runDocumentationAgent(pid: string) {
  const p0 = getProject(pid)!;
  const final = p0.testing?.signoff.status === 'approved';
  let xmeta: AIResult<string> = { value: '', engine: DETERMINISTIC };
  await runAgent(
    pid,
    'documentation',
    [{ label: 'Collecting latest approved artifacts' }, { label: 'Writing business requirements & data dictionary' }, { label: 'Writing mapping, KPI and functional specifications' }, { label: 'Compiling test, UAT and technical documentation' }],
    ['All approved artifacts', 'Test Results'],
    async () => {
      const docs = generateDocs(p0, (p0.documentation?.version ?? 0) + 1);
      const t = p0.testing ? summarize(p0.testing.cases) : null;
      const facts = { project: p0.info, objectives: p0.requirements?.objectives.map((x) => x.text), kpis: p0.foundation?.measures.map((m) => `${m.name} = ${m.logic}`), datasets: p0.understanding?.profiles.map((x) => `${x.label} (${x.rowCount} rows)`), dataQuality: p0.understanding?.issues.filter((i) => i.severity !== 'info').map((i) => i.message), dashboard: p0.dashboard?.summary, pages: p0.dashboard?.spec.pages.map((x) => x.name), tests: t, openDefects: p0.testing?.defects.filter((d) => d.status === 'Open' || d.status === 'In Progress').map((d) => d.title), uat: p0.testing?.signoff.status };
      xmeta = await withAI(() => aiExecutiveSummary(facts), () => '');
      if (xmeta.value) {
        const block = `## Executive summary\n_Written by ${xmeta.engine} from the project artifacts._\n\n${xmeta.value}\n\n`;
        for (const d of docs.filter((x) => x.id === 'brd' || x.id === 'technical')) {
          const i = d.markdown.indexOf('\n## ');
          d.markdown = i >= 0 ? `${d.markdown.slice(0, i + 1)}${block}${d.markdown.slice(i + 1)}` : d.markdown + block;
        }
      }
      return docs;
    },
    (p, docs, run) => {
      stamp(run, xmeta);
      const version = (p.documentation?.version ?? 0) + 1;
      p.documentation = { generatedAt: nowIso(), version, final, docs, basis: docBasis(p) };
      p.versions.documentation.push({ version, status: final ? 'approved' : 'draft', at: nowIso(), note: final ? 'Final package (post-UAT)' : 'Progressive draft', snapshot: { docs: docs.map((d) => d.title), final } });
      milestone(p, 'Documentation Generated');
      if (final) {
        setStage(p, 'documentation', 'completed', true);
        milestone(p, 'Project Completed');
      } else setStage(p, 'documentation', 'in_progress', true);
      run.outputs.push(`Documentation Package v${version}`);
      run.summary = `Generated ${docs.length} documents (package v${version}, ${final ? 'final' : 'draft — UAT sign-off pending'}).`;
      if (!final) run.warnings.push('Draft package: final documentation requires UAT sign-off.');
    },
    { ai: true },
  );
}

export { ORDER as STAGE_ORDER };

// ───────────────────────────── release & access ─────────────────────────────
export function updateRelease(pid: string, fn: (r: ReleaseState) => void, note: string) {
  mutate(pid, (p) => {
    p.release = p.release ?? { users: [] };
    fn(p.release);
    log(p, 'User', 'user', note, 'documentation');
    const T = p.testing;
    // access rules changed → the access-control test must be re-run
    if (T) for (const c of T.cases) if (c.check?.kind === 'rls' && c.status !== 'Not Started') c.status = 'Requires Retesting';
  });
}

export function proposeAccessRoles(pid: string) {
  const p = getProject(pid)!;
  if (!p.understanding) return;
  const rel = proposeRelease(p.understanding, getRows);
  if (!rel) {
    toast('error', 'No roster found (a table with a person column such as FRM_Name and their territory).');
    return;
  }
  updateRelease(pid, (r) => Object.assign(r, { securityField: rel.securityField, users: rel.users }), `Proposed row-level security for ${rel.users.length - 1} user(s)`);
}

export function publishRelease(pid: string, by: string) {
  const p = getProject(pid)!;
  if (p.testing?.signoff.status !== 'approved') {
    toast('error', 'Publishing requires UAT sign-off.');
    return;
  }
  mutate(pid, (pp) => {
    pp.release = pp.release ?? { users: [] };
    pp.release.published = { at: nowIso(), by, dashboardVersion: pp.dashboard!.version, url: `#/p/${pp.id}/preview` };
    log(pp, by, 'gate', `Published dashboard v${pp.dashboard!.version} for field users${FEATURES.rowLevelSecurity && pp.release.users.length ? ` with row-level security (${pp.release.users.length} user(s))` : ''}`, 'documentation');
  });
  toast('success', 'Dashboard published.');
}
