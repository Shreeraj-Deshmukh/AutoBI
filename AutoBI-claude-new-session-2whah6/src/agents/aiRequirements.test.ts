import { describe, it, expect, vi } from 'vitest';
import { ACCESS_NARRATIVE } from '@/lib/sampleData';
import { extractRequirements } from './requirementAgent';
import type { ProjectInfo } from '@/types';

// the model's reply: two catalogue KPIs Celestra cannot calculate (they need CRM / claims data) next to ones it can
const chat = vi.fn();
vi.mock('./llm', () => ({ chatJSON: (...a: unknown[]) => chat(...a) }));
const { aiExtractRequirements } = await import('./aiAgents');

const info = { name: 'FRM', client: 'Sanofi', domain: 'Patient access', objective: '', audience: 'FRMs', frequency: '', period: '', keyQuestions: [] } as unknown as ProjectInfo;
const reply = { kpis: ['Open Case Backlog', 'PA Submission Rate (FRM-driven) (%)', 'PA Approval Rate (FRM-driven) (%)', 'PA Approval Rate (%)'], dimensions: ['Where patient is stuck'], filters: ['Territory'], pages: [], objectives: ['Track access cases'] };

describe('AI requirements for the FRM brief', () => {
  it('drops catalogue KPIs Celestra cannot calculate unless the user named them', async () => {
    chat.mockResolvedValue(reply);
    const spec = await aiExtractRequirements(ACCESS_NARRATIVE, info, extractRequirements(ACCESS_NARRATIVE, { audience: 'FRMs' }));
    const kpis = spec.kpis.map((k) => k.text);
    expect(kpis).toEqual(expect.arrayContaining(['Open Case Backlog', 'PA Approval Rate (%)']));
    expect(kpis).not.toContain('PA Submission Rate (FRM-driven) (%)');
    expect(kpis).not.toContain('PA Approval Rate (FRM-driven) (%)');
    // the prompt only offers metrics Celestra can calculate
    expect(String(chat.mock.calls[0][0])).not.toContain('PA Submission Rate (FRM-driven)');
  });

  it('keeps one the user asked for by name (it is then reported as needing other data)', async () => {
    chat.mockResolvedValue(reply);
    const text = `${ACCESS_NARRATIVE}\n- Also show PA Submission Rate (FRM-driven) (%).`;
    const spec = await aiExtractRequirements(text, info, extractRequirements(text, { audience: 'FRMs' }));
    expect(spec.kpis.map((k) => k.text)).toContain('PA Submission Rate (FRM-driven) (%)');
  });
});
