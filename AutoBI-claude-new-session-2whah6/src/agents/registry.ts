import type { AgentId, StageId } from '@/types';

export interface AgentMeta {
  id: AgentId;
  name: string;
  short: string;
  role: string;
  stage: StageId;
  inputs: string[];
  outputs: string[];
}

export const AGENTS: AgentMeta[] = [
  {
    id: 'requirement',
    name: 'Requirement Intelligence Agent',
    short: 'Requirements',
    role: 'Understands natural-language business requirements, extracts objectives, KPIs, dimensions, filters and pages, and asks clarification questions.',
    stage: 'requirements',
    inputs: ['Project brief', 'Natural-language requirement'],
    outputs: ['Requirements Specification'],
  },
  {
    id: 'data',
    name: 'Data Intelligence Agent',
    short: 'Data',
    role: 'Profiles uploaded datasets, infers what each dataset represents, detects keys, relationships and data-quality issues, and maps requirements to fields.',
    stage: 'data',
    inputs: ['Requirements Specification', 'Uploaded datasets'],
    outputs: ['Data Understanding Report'],
  },
  {
    id: 'foundation',
    name: 'Reporting Foundation Agent',
    short: 'Foundation',
    role: 'Proposes a logical reporting model (facts & dimensions), source-to-reporting field mappings and KPI calculation logic.',
    stage: 'foundation',
    inputs: ['Requirements Specification', 'Data Understanding Report'],
    outputs: ['Reporting Foundation'],
  },
  {
    id: 'design',
    name: 'Dashboard Design Agent',
    short: 'Design',
    role: 'Generates a multi-page dashboard wireframe from approved requirements and the reporting foundation, and applies design change requests.',
    stage: 'design',
    inputs: ['Requirements Specification', 'Reporting Foundation'],
    outputs: ['Dashboard Wireframe', 'Approved Design Specification'],
  },
  {
    id: 'development',
    name: 'Dashboard Development Agent',
    short: 'Development',
    role: 'Builds the interactive dashboard from the approved design specification, wires KPI logic, filters and cross-filtering, and validates every component.',
    stage: 'development',
    inputs: ['Approved Design Specification', 'Reporting Foundation', 'Datasets'],
    outputs: ['Generated Dashboard', 'Development Summary'],
  },
  {
    id: 'testing',
    name: 'Testing & UAT Agent',
    short: 'Testing',
    role: 'Generates technical test cases and business QC scenarios from dashboard components, executes automated validations against source data, and supports analyst UAT.',
    stage: 'testing',
    inputs: ['Generated Dashboard', 'Requirements Specification', 'Datasets'],
    outputs: ['Test Case Library', 'Test Results', 'UAT Sign-off'],
  },
  {
    id: 'documentation',
    name: 'Documentation Agent',
    short: 'Documentation',
    role: 'Consolidates all project artifacts into business, data, KPI, functional, testing, UAT and technical documentation.',
    stage: 'documentation',
    inputs: ['All approved artifacts', 'Test Results'],
    outputs: ['Documentation Package'],
  },
];

export const agentMeta = (id: AgentId) => AGENTS.find((a) => a.id === id)!;

export const STAGES: { id: StageId; label: string; agent: AgentId; short: string }[] = [
  { id: 'requirements', label: 'Requirements', agent: 'requirement', short: 'Req' },
  { id: 'data', label: 'Data Intelligence', agent: 'data', short: 'Data' },
  { id: 'foundation', label: 'Reporting Foundation', agent: 'foundation', short: 'Model' },
  { id: 'design', label: 'Design Studio', agent: 'design', short: 'Design' },
  { id: 'development', label: 'Development', agent: 'development', short: 'Build' },
  { id: 'testing', label: 'Testing & UAT', agent: 'testing', short: 'Test' },
  { id: 'documentation', label: 'Documentation', agent: 'documentation', short: 'Docs' },
];

export const ARTIFACT_FLOW: { from: string; to: AgentId; artifact: string }[] = [
  { from: 'requirement', to: 'data', artifact: 'Requirements Specification' },
  { from: 'data', to: 'foundation', artifact: 'Data Understanding Report' },
  { from: 'foundation', to: 'design', artifact: 'Reporting Foundation' },
  { from: 'design', to: 'development', artifact: 'Approved Wireframe' },
  { from: 'development', to: 'testing', artifact: 'Generated Dashboard' },
  { from: 'testing', to: 'documentation', artifact: 'Test Results + Approved Dashboard' },
];
