// ───────────────────────────────────────────────────────────────────────────
// Celestra domain model. Every agent consumes and produces these structures.
// ───────────────────────────────────────────────────────────────────────────

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

/** A field reference across datasets: `${datasetId}::${column}` */
export type FieldRef = string;

// ── Workflow ───────────────────────────────────────────────────────────────
export type StageId =
  | 'requirements'
  | 'data'
  | 'foundation'
  | 'design'
  | 'development'
  | 'testing'
  | 'documentation';

export type StageStatus = 'not_started' | 'in_progress' | 'pending_approval' | 'approved' | 'completed' | 'blocked';

export interface StageState {
  status: StageStatus;
  /** Set when an upstream artifact changed after this stage was approved/completed. */
  needsReview?: string;
  updatedAt?: string;
}

export type Milestone =
  | 'Requirements Draft'
  | 'Requirements Approved'
  | 'Data Ingested'
  | 'Data Understanding Complete'
  | 'Reporting Foundation Reviewed'
  | 'Wireframe Generated'
  | 'Design Approved'
  | 'Development Started'
  | 'Dashboard Generated'
  | 'Testing Generated'
  | 'Automated Testing Completed'
  | 'UAT Completed'
  | 'Documentation Generated'
  | 'Project Completed';

export interface HistoryEvent {
  id: string;
  at: string;
  actor: string; // agent name or "User"
  kind: 'agent' | 'user' | 'gate' | 'system' | 'warning';
  message: string;
  stage?: StageId;
}

export interface VersionEntry<T> {
  version: number;
  status: 'draft' | 'approved' | 'superseded';
  at: string;
  note: string;
  snapshot: T;
}

// ── Agents ────────────────────────────────────────────────────────────────
export type AgentId =
  | 'requirement'
  | 'data'
  | 'foundation'
  | 'design'
  | 'development'
  | 'testing'
  | 'documentation';

export interface AgentStep {
  label: string;
  status: 'pending' | 'running' | 'done' | 'warning' | 'error';
  detail?: string;
}

export interface AgentRun {
  id: string;
  agentId: AgentId;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'completed_with_warnings';
  engine: string; // e.g. "Deterministic rules engine" – never claims a real LLM unless one is configured
  summary?: string;
  steps: AgentStep[];
  inputs: string[];
  outputs: string[];
  warnings: string[];
  errors: string[];
}

// ── Project & requirements ────────────────────────────────────────────────
export interface ProjectInfo {
  name: string;
  client: string;
  domain: string;
  objective: string;
  audience: string;
  problem: string;
  frequency: string;
  period: string;
  keyQuestions: string[];
}

export interface ReqItem {
  id: string;
  text: string;
  source: 'extracted' | 'user' | 'clarification' | 'default' | 'catalogue';
}

export type ClarificationField = 'timeGrain' | 'audience' | 'period' | 'comparison' | 'generic';

export interface Clarification {
  id: string;
  field: ClarificationField;
  question: string;
  options: string[];
  answer?: string;
}

export interface RequirementSpec {
  objectives: ReqItem[];
  kpis: ReqItem[];
  dimensions: ReqItem[];
  filters: ReqItem[];
  visuals: ReqItem[];
  datasets: ReqItem[];
  rules: ReqItem[];
  pages: ReqItem[];
  stories: ReqItem[];
  ambiguities: Clarification[];
  missing: string[];
  timeGrain: 'week' | 'month' | 'quarter' | null;
  comparison: boolean;
}

export type RequirementSection = 'objectives' | 'stories' | 'kpis' | 'dimensions' | 'filters' | 'visuals' | 'datasets' | 'rules' | 'pages';

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  at: string;
  options?: string[];
  clarificationId?: string;
}

// ── Data ingestion & profiling ────────────────────────────────────────────
export type DataFormat = 'csv' | 'xlsx' | 'json' | 'sample' | 'databricks' | 'snowflake';

export interface DatasetMeta {
  id: string;
  name: string; // business label, e.g. "Account Master"
  fileName: string;
  format: DataFormat;
  rowCount: number;
  columnCount: number;
  columns: string[];
  uploadedAt: string;
  status: 'uploaded' | 'profiling' | 'profiled' | 'error';
  error?: string;
  isSample: boolean;
  sizeBytes?: number;
}

export type ColumnType = 'string' | 'integer' | 'number' | 'date' | 'boolean';
export type ColumnRole = 'identifier' | 'foreign_key' | 'date' | 'measure' | 'dimension' | 'status' | 'attribute';

export interface ColumnProfile {
  name: string;
  type: ColumnType;
  role: ColumnRole;
  missing: number;
  missingPct: number;
  distinct: number;
  uniquePct: number;
  min?: number;
  max?: number;
  mean?: number;
  dateMin?: string;
  dateMax?: string;
  dateFormats?: string[];
  invalid: number; // values that do not match the inferred type
  topValues: { value: string; count: number }[];
  businessDefinition: string;
  /** The user changed the role or meaning; kept when the agent re-runs. */
  edited?: boolean;
}

export type DatasetKind = 'master' | 'activity' | 'reference' | 'unknown';

export interface DatasetProfile {
  datasetId: string;
  rowCount: number;
  columnCount: number;
  duplicateRows: number;
  primaryKey?: string;
  entity: string;
  kind: DatasetKind;
  label: string;
  inference: string;
  confidence: number;
  dateField?: string;
  columns: ColumnProfile[];
  /** The user renamed the dataset or changed its kind; kept when the agent re-runs. */
  labelEdited?: boolean;
  kindEdited?: boolean;
}

export interface Relationship {
  id: string;
  fromDataset: string; // many side
  fromField: string;
  toDataset: string; // one side
  toField: string;
  matchRate: number;
  unmatched: number;
  confidence: number;
  status: 'suggested' | 'confirmed' | 'rejected';
  /** Added or edited by the user (not detected by the agent). */
  manual?: boolean;
}

export interface DQIssue {
  id: string;
  datasetId: string;
  column?: string;
  severity: 'info' | 'warning' | 'error';
  type: string;
  message: string;
  impact: string;
  suggestion: string;
  count: number;
  resolved?: boolean;
}

export type MappingStatus = 'available' | 'join_required' | 'calculation_required' | 'missing' | 'clarification';

export interface ReqMapping {
  id: string;
  requirement: string;
  kind: 'kpi' | 'dimension' | 'filter';
  sources: string[]; // dataset labels
  fields: string[];
  status: MappingStatus;
  note: string;
  /** Set by the user; kept when requirements are re-mapped. */
  userEdited?: boolean;
}

export interface DataUnderstanding {
  generatedAt: string;
  profiles: DatasetProfile[];
  relationships: Relationship[];
  issues: DQIssue[];
  mappings: ReqMapping[];
  suggestedMetrics: string[];
  missingInfo: string[];
  summary: string;
}

// ── Reporting foundation ──────────────────────────────────────────────────
export interface FieldMap {
  id: string;
  sourceDataset: string;
  sourceField: string;
  reportingTable: string;
  reportingField: string;
  dataType: string;
  role: ColumnRole;
  included: boolean;
}

export interface ModelTable {
  id: string;
  name: string;
  kind: 'fact' | 'dimension';
  sourceDatasetId: string | null;
  grain: string;
  fields: string[];
  description: string;
}

export interface MeasureCondition {
  field: string; // column of the measure's dataset
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'notnull';
  values: string[];
}

export type MeasureFormat = 'number' | 'percent' | 'decimal' | 'currency';

export interface MeasureDef {
  id: string;
  name: string;
  description: string;
  kind: 'count' | 'countDistinct' | 'sum' | 'avg' | 'median' | 'ratio';
  datasetId?: string;
  field?: string;
  condition?: MeasureCondition;
  /** Additional conditions, all of which must hold (AND). */
  conditions?: MeasureCondition[];
  numeratorId?: string;
  denominatorId?: string;
  format: MeasureFormat;
  logic: string;
  assumptions: string[];
  requirementRef?: string;
  userModified?: boolean;
  /** Recipe this measure was bound from (ProcDNA KPI Catalogue metric, FRM report measure or helper). */
  catalogueRef?: string;
}

// ── ProcDNA KPI catalogue ─────────────────────────────────────────────────
export interface CatalogueMetric {
  category: string;
  name: string;
  definition: string;
  computation: string;
  dataSource: string;
  vendors: string;
  isKpi: boolean;
  visuals: string;
  granularity: { geographyLevel: boolean; geographyName: boolean; product: boolean; payer: boolean; accountType: boolean };
}

export interface CatalogueCoverage {
  metric: string;
  category: string;
  isKpi: boolean;
  status: 'computed' | 'same_as' | 'needs_data';
  /** Measure that computes it (status computed / same_as). */
  measureId?: string;
  note: string;
}

export interface Foundation {
  generatedAt: string;
  tables: ModelTable[];
  fieldMaps: FieldMap[];
  measures: MeasureDef[];
  gaps: string[];
  assumptions: string[];
  /** How the ProcDNA KPI catalogue maps onto the uploaded data. */
  catalogue?: CatalogueCoverage[];
}

// ── Dashboard design & spec ───────────────────────────────────────────────
export type ComponentType =
  | 'kpi'
  | 'bar'
  | 'hbar'
  | 'stacked'
  | 'line'
  | 'area'
  | 'donut'
  | 'table'
  | 'funnel'
  /** One card with several values (e.g. Cases: Total / Open / Closed / Closure %), or one measure split by `dimension`. */
  | 'kpiGroup'
  /** Highest / lowest category of a measure (e.g. closure rate by territory). */
  | 'extremes'
  /** Row-level list of the records behind a count measure (e.g. each open case). */
  | 'records'
  /** Two measures plotted against each other per category. */
  | 'scatter'
  /** Hierarchical drill-down through `levels` (decomposition tree). */
  | 'drilldown';
export type TimeGrain = 'week' | 'month' | 'quarter';
export type PeriodPreset = 'all' | 'last4w' | 'r13w' | 'last6m' | 'ytd' | 'last12m' | 'custom';

export interface DashComponent {
  id: string;
  type: ComponentType;
  title: string;
  description: string;
  measureIds: string[];
  dimension?: FieldRef; // for bar/donut/stacked/table group
  /** bar / stacked / scatter: one bar segment (stacked), bar (bar) or point colour (scatter) per value of this field. */
  series?: FieldRef;
  /**
   * line / area: the time grain. bar / stacked: the outer axis level is the period (e.g. month) of the measure's date,
   * with `subDimension` inside it and no `dimension`.
   */
  timeGrain?: TimeGrain;
  /** bar / stacked: inner axis level under `dimension` (or under the period), e.g. Product within Territory. */
  subDimension?: FieldRef;
  comparison?: boolean; // KPI current vs previous
  width: 3 | 4 | 6 | 8 | 12;
  tableColumns?: FieldRef[]; // attribute columns for tables
  topN?: number;
  /** Visual section heading, e.g. "Patient Funnel" (consecutive components share a section). */
  section?: string;
  /** Only show categories where the first measure exceeds this value (e.g. HCPs with > 5 delayed patients). */
  threshold?: { op: 'gt' | 'gte'; value: number };
  /** kpiGroup: label shown above each measure's value. */
  labels?: string[];
  /** extremes: lower values are better (e.g. resolution time → Fastest / Slowest). */
  lowIsBest?: boolean;
  /** extremes: only show the top category, with this attribute beside it (e.g. HCP + account). */
  topOnly?: FieldRef;
  /** table: priority flags on the first measure (≥ high → two flags, ≥ medium → one flag). Thresholds left out follow the data: top 10% → two flags, next 25% → one flag. */
  flags?: { high?: number; medium?: number };
  /** records: optional toggle that narrows the list (e.g. escalated cases only). */
  toggle?: { label: string; filter: MeasureCondition[]; /** name of the un-narrowed view, e.g. "Overall Cases" (default "All") */ allLabel?: string };
  /** records: column the list is sorted by, descending. */
  sortBy?: FieldRef;
  /** drilldown: hierarchy levels, outermost first. `dimension` mirrors levels[0]. */
  levels?: FieldRef[];
}

export interface DashPage {
  id: string;
  name: string;
  description: string;
  components: DashComponent[];
  /** Pages laid out from a ProcDNA standard template (e.g. the FRM report). */
  template?: 'frm';
}

export interface FilterDef {
  id: string;
  label: string;
  type: 'period' | 'multi';
  field?: FieldRef;
}

export interface DashboardSpec {
  pages: DashPage[];
  filters: FilterDef[];
  defaultPeriod: PeriodPreset;
  timeGrain: TimeGrain;
  /**
   * "Geo Level" selector: geography fields, broadest first (e.g. Region, Territory). On pages that show it,
   * every component whose `dimension` or `series` is one of these fields follows the selected level.
   * Exported to Power BI as a field parameter.
   */
  geoLevels?: { fields: FieldRef[]; default: FieldRef; pages: string[] };
}

export interface DesignState {
  spec: DashboardSpec;
  version: number;
  status: 'draft' | 'approved';
  approvedAt?: string;
  savedAt?: string;
}

export interface ComponentValidation {
  componentId: string;
  title: string;
  page: string;
  ok: boolean;
  message: string;
}

export interface DashboardBuild {
  generatedAt: string;
  designVersion: number;
  version: number;
  spec: DashboardSpec;
  summary: { pages: number; kpis: number; charts: number; tables: number; filters: number };
  validations: ComponentValidation[];
  warnings: string[];
  transformations: string[];
}

// ── Testing & UAT ─────────────────────────────────────────────────────────
export type TestStatus = 'Not Started' | 'In Progress' | 'Passed' | 'Failed' | 'Blocked' | 'Requires Retesting';
export type Priority = 'Critical' | 'High' | 'Medium' | 'Low';

export type CheckSpec =
  | { kind: 'kpi_recompute'; measureId: string }
  | { kind: 'ratio_bounds'; measureId: string }
  | { kind: 'group_recompute'; componentId: string; measureId?: string }
  | { kind: 'records'; componentId: string }
  | { kind: 'extremes'; componentId: string }
  | { kind: 'catalogue'; measureId: string }
  | { kind: 'group_rollup'; componentId: string }
  | { kind: 'series_recompute'; componentId: string }
  | { kind: 'table_total'; componentId: string }
  | { kind: 'filter_apply'; filterId: string }
  | { kind: 'multi_filter' }
  | { kind: 'period_logic' }
  | { kind: 'default_period' }
  | { kind: 'fk_integrity'; relationshipId: string }
  | { kind: 'attribute_mapping'; relationshipId: string; field: string }
  | { kind: 'row_count'; datasetId: string }
  | { kind: 'duplicates'; datasetId: string }
  | { kind: 'timeline'; measureId: string }
  | { kind: 'outlier'; componentId: string }
  | { kind: 'spec_integrity'; pageId: string }
  | { kind: 'correlation'; measureA: string; measureB: string }
  | { kind: 'unique_count'; measureId: string }
  | { kind: 'funnel'; componentId: string }
  | { kind: 'rls' };

export interface TestComment {
  id: string;
  at: string;
  by: string;
  text: string;
}

export interface TestCase {
  id: string;
  suite: 'technical' | 'qc';
  category: string;
  page: string;
  component: string;
  elementType: string;
  objective: string;
  preconditions: string;
  steps: string[];
  testData: string;
  expected: string;
  actual: string;
  status: TestStatus;
  priority: Priority;
  execution: 'Automated' | 'Manual';
  evidence: string;
  comments: TestComment[];
  attachments: { name: string; size: number; dataUrl?: string }[];
  check?: CheckSpec;
  lastRunAt?: string;
  executedBy?: string;
  runCount: number;
  userAdded?: boolean;
}

export interface Defect {
  id: string;
  title: string;
  testId: string;
  severity: Priority;
  status: 'Open' | 'In Progress' | 'Resolved' | 'Closed';
  description: string;
  createdAt: string;
  raisedBy: string;
  resolution?: string;
}

export interface TestRunRecord {
  at: string;
  label: string;
  executed: number;
  passed: number;
  failed: number;
}

export interface UatSignoff {
  status: 'pending' | 'approved' | 'rejected';
  by?: string;
  role?: string;
  at?: string;
  comments?: string;
  acceptedRisks?: string;
}

export interface TestingState {
  generatedAt: string;
  dashboardVersion: number;
  version: number;
  cases: TestCase[];
  defects: Defect[];
  runs: TestRunRecord[];
  signoff: UatSignoff;
  automatedCompletedAt?: string;
}

// ── Documentation ─────────────────────────────────────────────────────────
export interface DocArtifact {
  id: string;
  title: string;
  markdown: string;
  generatedAt: string;
  version: number;
  basedOn: string[];
}

export interface DocumentationState {
  generatedAt: string;
  version: number;
  final: boolean;
  docs: DocArtifact[];
  /** Signature of the artifact versions the package was built from (to detect staleness). */
  basis?: string;
}

// ── Project aggregate ─────────────────────────────────────────────────────
export interface Project {
  id: string;
  createdAt: string;
  updatedAt: string;
  isDemo: boolean;
  info: ProjectInfo;
  narrative: string;
  chat: ChatMessage[];
  requirements: RequirementSpec | null;
  requirementsStatus: 'none' | 'draft' | 'approved';
  requirementsVersion: number;
  datasets: DatasetMeta[];
  understanding: DataUnderstanding | null;
  foundation: Foundation | null;
  foundationVersion: number;
  design: DesignState | null;
  designChat: ChatMessage[];
  dashboard: DashboardBuild | null;
  testing: TestingState | null;
  documentation: DocumentationState | null;
  /** Release & access: row-level security by user and publish record. */
  release?: ReleaseState;
  stages: Record<StageId, StageState>;
  milestones: { name: Milestone; at: string }[];
  history: HistoryEvent[];
  runs: AgentRun[];
  versions: {
    requirements: VersionEntry<RequirementSpec>[];
    foundation: VersionEntry<Foundation>[];
    design: VersionEntry<DashboardSpec>[];
    dashboard: VersionEntry<{ summary: DashboardBuild['summary']; designVersion: number }>[];
    tests: VersionEntry<{ total: number; passed: number; failed: number }>[];
    documentation: VersionEntry<{ docs: string[]; final: boolean }>[];
  };
}

export interface AccessUser {
  id: string;
  name: string;
  role: string;
  /** Allowed values of the security field (e.g. their territory). Empty = all data. */
  values: string[];
}

export interface ReleaseState {
  securityField?: FieldRef;
  users: AccessUser[];
  published?: { at: string; by: string; dashboardVersion: number; url: string };
}
