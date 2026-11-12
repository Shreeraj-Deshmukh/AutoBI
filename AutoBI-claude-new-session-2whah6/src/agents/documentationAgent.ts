import type { DocArtifact, Project } from '@/types';
import { splitRef } from '@/lib/engine';
import { PERIOD_LABELS } from '@/lib/dates';
import { fmtDate, fmtDateTime, humanize } from '@/lib/util';
import { CHART_LABELS } from './designAgent';
import { AGENTS } from './registry';
import { FEATURES } from '@/config/features';

/** Documentation Agent: consolidates project artifacts into the delivery documentation set. */

const esc = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head: string[], rows: unknown[][]) => (rows.length ? `| ${head.join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |\n${rows.map((r) => `| ${r.map(esc).join(' | ')} |`).join('\n')}\n` : '_None._\n');
const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') + '\n' : '_None recorded._\n');

export function generateDocs(p: Project, version: number): DocArtifact[] {
  const now = new Date().toISOString();
  const r = p.requirements;
  const u = p.understanding;
  const f = p.foundation;
  const d = p.dashboard;
  const t = p.testing;
  const label = (id: string) => u?.profiles.find((x) => x.datasetId === id)?.label ?? id;
  const fieldName = (fr?: string) => (fr ? `${label(splitRef(fr).datasetId)}.${splitRef(fr).column}` : '—');
  const mname = (id: string) => f?.measures.find((m) => m.id === id)?.name ?? id;
  const header = (title: string) => `# ${title}\n\n**Project:** ${p.info.name}  \n**Client / BU:** ${p.info.client || '—'}  \n**Generated:** ${fmtDateTime(now)} by the Documentation Agent · Package v${version}\n\n`;
  const docs: DocArtifact[] = [];
  const push = (id: string, title: string, markdown: string, basedOn: string[]) => docs.push({ id, title, markdown, generatedAt: now, version, basedOn });

  // 1. BRD
  push(
    'brd',
    'Business Requirements Document',
    header('Business Requirements Document') +
      `## 1. Business objective\n${p.info.objective || '—'}\n\n**Business problem:** ${p.info.problem || '—'}\n\n` +
      `## 2. Scope\n- Reporting domain: ${p.info.domain || '—'}\n- Reporting frequency: ${p.info.frequency || '—'}\n- Reporting period: ${p.info.period || '—'}\n- Dashboard pages: ${r?.pages.map((x) => x.text).join(', ') || '—'}\n\n` +
      `## 3. Stakeholders\n- Intended audience: ${p.info.audience || '—'}\n\n` +
      `### Key questions\n${list(p.info.keyQuestions)}\n` +
      `## 4. Functional requirements\n### Objectives\n${list(r?.objectives.map((x) => x.text) ?? [])}\n### User stories\n${list(r?.stories?.map((x) => x.text) ?? [])}\n### Expected visualisations\n${list(r?.visuals.map((x) => x.text) ?? [])}\n` +
      `## 5. KPIs\n${list(r?.kpis.map((x) => x.text) ?? [])}\n## 6. Reporting dimensions\n${list(r?.dimensions.map((x) => x.text) ?? [])}\n## 7. Filters\n${list(r?.filters.map((x) => x.text) ?? [])}\n` +
      `## 8. Business rules\n${list(r?.rules.map((x) => x.text) ?? [])}\n` +
      `## 9. Clarifications\n${table(['Question', 'Answer'], (r?.ambiguities ?? []).map((a) => [a.question, a.answer ?? 'Open']))}\n` +
      `## 10. Assumptions\n${list([...(r?.missing ?? []), ...(f?.assumptions ?? [])])}\n## 11. Dependencies\n${list(r?.datasets.map((x) => x.text) ?? [])}\n` +
      `## 12. Original requirement statement\n> ${p.narrative || '—'}\n\n_Requirements specification v${p.requirementsVersion} — status: ${p.requirementsStatus}._\n`,
    [`Requirements v${p.requirementsVersion}`],
  );

  // 2. Data dictionary
  if (u) {
    let md = header('Data Understanding & Data Dictionary') + `## Summary\n${u.summary}\n\n## Dataset inventory\n` + table(['Dataset', 'Source file', 'Type', 'Rows', 'Columns', 'Primary key', 'Duplicates'], u.profiles.map((x) => [x.label, p.datasets.find((ds) => ds.id === x.datasetId)?.fileName, humanize(x.kind), x.rowCount, x.columnCount, x.primaryKey ?? '—', x.duplicateRows])) + '\n';
    for (const x of u.profiles) {
      md += `## ${x.label}\n${x.inference} (confidence ${(x.confidence * 100).toFixed(0)}%)\n\n` + table(['Column', 'Type', 'Role', 'Missing', 'Distinct', 'Range / values', 'Business definition'], x.columns.map((c) => [c.name, c.type, humanize(c.role), c.missing, c.distinct, c.type === 'date' ? `${c.dateMin} → ${c.dateMax}` : c.min != null ? `${c.min} – ${c.max}` : c.topValues.slice(0, 3).map((v) => v.value).join(', '), c.businessDefinition])) + '\n';
    }
    md += `## Identified relationships\n` + table(['From', 'Field', 'To', 'Field', 'Match rate', 'Unmatched', 'Status'], u.relationships.map((x) => [label(x.fromDataset), x.fromField, label(x.toDataset), x.toField, `${(x.matchRate * 100).toFixed(1)}%`, x.unmatched, x.status])) + '\n';
    md += `## Data-quality observations\n` + table(['Severity', 'Type', 'Observation', 'Impact', 'Suggested action'], u.issues.map((i) => [i.severity, i.type, i.message, i.impact, i.suggestion])) + '\n';
    md += `## Requirement-to-data mapping\n` + table(['Requirement', 'Type', 'Source', 'Field(s)', 'Status', 'Note'], u.mappings.map((m) => [m.requirement, m.kind, m.sources.join(' + '), m.fields.join(', '), humanize(m.status), m.note]));
    push('dictionary', 'Data Understanding & Data Dictionary', md, ['Data Understanding Report']);
  }

  // 3. Mapping
  if (f && u) {
    push(
      'mapping',
      'Reporting Data Mapping Document',
      header('Reporting Data Mapping Document') +
        `> Simulated data-preparation workspace — no physical data mart, warehouse or ETL pipeline was built in this POC.\n\n## Logical reporting tables\n` +
        table(['Table', 'Type', 'Source', 'Grain', 'Description'], f.tables.map((x) => [x.name, x.kind, x.sourceDatasetId ? label(x.sourceDatasetId) : 'Derived', x.grain, x.description])) +
        `\n## Relationships\n` + table(['Fact / many side', 'Dimension / one side', 'Join'], u.relationships.filter((x) => x.status !== 'rejected').map((x) => [label(x.fromDataset), label(x.toDataset), `${x.fromField} = ${x.toField}`])) +
        `\n## Source-to-reporting field mappings\n` + table(['Source table', 'Source field', 'Reporting table', 'Reporting field', 'Data type', 'Included'], f.fieldMaps.map((m) => [label(m.sourceDataset), m.sourceField, m.reportingTable, m.reportingField, m.dataType, m.included ? 'Yes' : 'No'])) +
        `\n## Transformation assumptions\n${list(f.assumptions)}\n## Metric dependencies\n` + table(['Measure', 'Depends on'], f.measures.filter((m) => m.kind === 'ratio').map((m) => [m.name, `${mname(m.numeratorId!)}, ${mname(m.denominatorId!)}`])) +
        `\n## Data gaps\n${list(f.gaps)}`,
      [`Reporting Foundation v${p.foundationVersion}`],
    );
    // 4. KPI doc
    push(
      'kpi',
      'KPI & Calculation Document',
      header('KPI & Calculation Document') +
        table(['KPI', 'Business definition', 'Calculation logic', 'Source fields', 'Aggregation', 'Format', 'Assumptions'], f.measures.map((m) => [m.name, m.description, m.logic, m.kind === 'ratio' ? `${mname(m.numeratorId!)}, ${mname(m.denominatorId!)}` : `${label(m.datasetId!)}.${m.field ?? '*'}${m.condition ? `, ${m.condition.field}` : ''}`, m.kind === 'ratio' ? 'Ratio of aggregates' : humanize(m.kind), m.format, [...m.assumptions, m.userModified ? 'Modified by user' : ''].filter(Boolean).join(' ')])) +
        `\n## Filter behaviour\n- Reporting-period filters apply to the event date of each fact table.\n- Category filters apply to every measure whose fact table can reach the filtered field through a relationship; other measures are unaffected.\n- Previous period = the immediately preceding period of equal length.\n`,
      [`Reporting Foundation v${p.foundationVersion}`],
    );
  }

  // 5. Functional spec
  const spec = d?.spec ?? p.design?.spec;
  if (spec) {
    let md = header('Dashboard Functional Specification') + `**Design version:** v${p.design?.version ?? '—'} (${p.design?.status ?? '—'}${p.design?.approvedAt ? `, approved ${fmtDate(p.design.approvedAt)}` : ''})  \n**Dashboard build:** ${d ? `v${d.version} generated ${fmtDateTime(d.generatedAt)}` : 'not yet generated'}\n\n`;
    md += `## Navigation\nThe dashboard has ${spec.pages.length} page(s) accessed via tabs: ${spec.pages.map((x) => x.name).join(' · ')}.\n\n## Global filters\n` + table(['Filter', 'Type', 'Field'], spec.filters.map((x) => [x.label, x.type === 'period' ? 'Date period' : 'Multi-select', x.field ? fieldName(x.field) : 'Activity dates'])) + `\nDefault period: ${PERIOD_LABELS[spec.defaultPeriod]}. Default trend grain: ${spec.timeGrain}.\n\n`;
    md += `## Interaction behaviour\n- Clicking a category in a bar/donut chart or a row in a table cross-filters every related visual; clicking again clears it.\n- KPI cards show current vs previous period change where enabled.\n- Tables support search, column sorting and CSV export.\n- Tooltips show category / period and formatted value.\n\n`;
    for (const pg of spec.pages) {
      md += `## Page: ${pg.name}\n${pg.description}\n\n` + table(['#', 'Component', 'Type', 'Measures', 'Dimension', 'Width (of 12)', 'Description'], pg.components.map((c, i) => [i + 1, c.title, CHART_LABELS[c.type], c.measureIds.map(mname).join(', '), c.dimension ? fieldName(c.dimension) + (c.series ? ` × ${splitRef(c.series).column}` : '') : c.timeGrain ? `Time (${c.timeGrain})` : '—', c.width, c.description])) + '\n';
    }
    push('functional', 'Dashboard Functional Specification', md, [`Design v${p.design?.version}`, d ? `Dashboard v${d.version}` : 'No build']);
  }

  // 6. Test cases
  if (t) {
    const md =
      header('Test Case Document') +
      `## Technical test cases\n` + table(['ID', 'Category', 'Page', 'Component', 'Objective', 'Expected result', 'Actual result', 'Status', 'Type', 'Priority'], t.cases.filter((c) => c.suite === 'technical').map((c) => [c.id, c.category, c.page, c.component, c.objective, c.expected, c.actual || '—', c.status, c.execution, c.priority])) +
      `\n## Business QC scenarios\n` + table(['ID', 'Section', 'QC category', 'Business validation', 'Expected outcome', 'Actual result', 'Status'], t.cases.filter((c) => c.suite === 'qc').map((c) => [c.id, c.component, c.category, c.objective, c.expected, c.actual || '—', c.status])) +
      `\n## Execution evidence (automated)\n` + table(['ID', 'Evidence'], t.cases.filter((c) => c.evidence).map((c) => [c.id, c.evidence])) +
      `\n## Defects\n` + table(['ID', 'Title', 'Test', 'Severity', 'Status', 'Resolution'], t.defects.map((x) => [x.id, x.title, x.testId, x.severity, x.status, x.resolution ?? '—']));
    push('tests', 'Test Case Document', md, [`Test suite v${t.version}`]);

    // 7. UAT sign-off
    const s = summarize(t.cases);
    const open = t.defects.filter((x) => x.status === 'Open' || x.status === 'In Progress');
    push(
      'uat',
      'UAT Sign-off Document',
      header('UAT Sign-off Document') +
        `## Testing summary\n` + table(['Metric', 'Value'], [['Total test cases', s.total], ['Automated', s.automated], ['Manual', s.manual], ['Passed', s.passed], ['Failed', s.failed], ['Blocked', s.blocked], ['Not started / in progress', s.pending], ['Execution %', `${s.execPct.toFixed(1)}%`], ['Pass %', `${s.passPct.toFixed(1)}%`], ['Open defects', open.length]]) +
        `\n## Analyst feedback\n` + list(t.cases.flatMap((c) => c.comments.map((m) => `**${c.id}** (${m.by}, ${fmtDateTime(m.at)}): ${m.text}`))) +
        `\n## Open issues\n` + table(['Defect', 'Severity', 'Status', 'Description'], open.map((x) => [`${x.id} ${x.title}`, x.severity, x.status, x.description])) +
        `\n## Approval status\n- Status: **${t.signoff.status.toUpperCase()}**\n- Signed by: ${t.signoff.by ?? '—'} ${t.signoff.role ? `(${t.signoff.role})` : ''}\n- Date: ${fmtDateTime(t.signoff.at)}\n- Comments: ${t.signoff.comments ?? '—'}\n\n## Outstanding risks\n${t.signoff.acceptedRisks ? `- ${t.signoff.acceptedRisks}\n` : ''}${list(open.map((x) => `${x.id}: ${x.title} (${x.severity})`))}`,
      [`Test suite v${t.version}`, 'UAT records'],
    );
  }

  // 8. Technical documentation
  const s = t ? summarize(t.cases) : null;
  push(
    'technical',
    'Final Reporting Technical Documentation',
    header('Final Reporting Technical Documentation') +
      `## 1. Overall architecture\nCelestra is a single-page React/TypeScript application. A central **Workflow Orchestrator** maintains project state, enforces approval gates and invokes seven modular agents, each with structured inputs and outputs:\n\n` +
      table(['Agent', 'Consumes', 'Produces'], AGENTS.map((a) => [a.name, a.inputs.join(', '), a.outputs.join(', ')])) +
      `\nAll agents in this POC run as **deterministic rules engines** (no external LLM is called). The provider interface (\`src/agents/llm.ts\`) allows an LLM to be connected later.\n\n` +
      `## 2. Data flow\n1. Files (CSV/XLSX/JSON) are parsed in the browser and stored locally (IndexedDB).\n2. The Data Intelligence Agent profiles each dataset and infers relationships.\n3. The Reporting Foundation Agent defines a logical star schema and KPI logic (no physical data mart).\n4. The dashboard renderer evaluates the approved, configuration-driven dashboard specification with the semantic query engine (\`src/lib/engine.ts\`), joining fact rows to dimension rows at query time.\n5. The Testing Agent reconciles dashboard outputs against an independent calculation over raw source rows.\n\n` +
      `## 3. Dashboard components\n${d ? `${d.summary.pages} pages, ${d.summary.kpis} KPI cards, ${d.summary.charts} charts, ${d.summary.tables} tables, ${d.summary.filters} filters (build v${d.version}).` : 'Dashboard not yet generated.'}\n\n### Transformations applied\n${list(d?.transformations ?? [])}\n` +
      `## 4. Calculation logic\n${table(['KPI', 'Logic'], (f?.measures ?? []).map((m) => [m.name, m.logic]))}\n` +
      `## 5. Testing approach\n- Technical tests per component (functional, UI/UX, filter, navigation, calculation, data validation, interaction).\n- Business QC scenarios (data integrity, mapping, period comparison, outliers, roll-ups, defaults).\n- Automated tests are only marked Passed after an actual reconciliation; manual tests require analyst confirmation.\n${s ? `- Current results: ${s.passed}/${s.total} passed, ${s.failed} failed, ${s.pending} pending (${s.execPct.toFixed(0)}% executed).\n` : ''}\n` +
      `## 6. ${FEATURES.rowLevelSecurity ? 'Access & release' : 'Release'}\n${FEATURES.rowLevelSecurity && p.release?.securityField ? `Row-level security on **${p.release.securityField.split('::')[1]}**.\n\n${table(['User', 'Role', 'Can see'], p.release.users.map((x) => [x.name, x.role, x.values.length ? x.values.join(', ') : 'All data']))}` : FEATURES.rowLevelSecurity ? 'No row-level security configured.\n' : ''}\n${p.release?.published ? `Published dashboard v${p.release.published.dashboardVersion} on ${fmtDateTime(p.release.published.at)} by ${p.release.published.by}.\n` : 'Not yet published.\n'}\n` +
      `## 7. Limitations\n- POC runs entirely in the browser; data volumes are limited by browser memory.\n- Agents use deterministic heuristics; inference quality depends on descriptive column names.\n- No physical data mart, Fabric lakehouse or Power BI artefact is produced.\n- UI/UX tests are manual; browser automation (Playwright) covers the application itself.\n\n` +
      `## 8. Release-readiness summary\n${table(['Gate', 'Status'], [['Requirements approved', p.requirementsStatus === 'approved' ? 'Yes' : 'No'], ['Reporting foundation reviewed', p.stages.foundation.status === 'approved' ? 'Yes' : 'No'], ['Design approved', p.design?.status === 'approved' ? `Yes (v${p.design.version})` : 'No'], ['Dashboard generated', d ? `Yes (v${d.version})` : 'No'], ['Automated testing completed', t?.automatedCompletedAt ? 'Yes' : 'No'], ['UAT signed off', t?.signoff.status === 'approved' ? 'Yes' : 'No'], ['Open defects', String(t?.defects.filter((x) => x.status === 'Open' || x.status === 'In Progress').length ?? 0)]])}\n` +
      `**Overall:** ${t?.signoff.status === 'approved' ? 'Ready for release.' : 'Not yet ready for release — UAT sign-off pending.'}\n`,
    ['All artifacts'],
  );
  return docs;
}

export function summarize(cases: { status: string; execution: string }[]) {
  const total = cases.length;
  const passed = cases.filter((c) => c.status === 'Passed').length;
  const failed = cases.filter((c) => c.status === 'Failed').length;
  const blocked = cases.filter((c) => c.status === 'Blocked').length;
  const executed = passed + failed + blocked;
  return { total, automated: cases.filter((c) => c.execution === 'Automated').length, manual: cases.filter((c) => c.execution === 'Manual').length, passed, failed, blocked, pending: total - executed, execPct: total ? (executed / total) * 100 : 0, passPct: executed ? (passed / executed) * 100 : 0 };
}

/** Signature of the upstream artifacts that documentation depends on. */
export function docBasis(p: Project) {
  const t = p.testing;
  const s = t ? summarize(t.cases) : null;
  return [p.requirementsVersion, p.requirementsStatus, p.foundationVersion, p.design?.version, p.design?.status, p.dashboard?.version, t?.version, s?.passed, s?.failed, s?.pending, t?.defects.filter((d) => d.status === 'Open' || d.status === 'In Progress').length, t?.signoff.status].join('|');
}
