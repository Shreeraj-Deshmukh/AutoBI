import { describe, it, expect, vi, beforeEach } from 'vitest';

// the model's replies are scripted; only what is sent and what is accepted is tested
const chat = vi.fn();
vi.mock('./llm', () => ({ chatJSON: (...a: unknown[]) => chat(...a) }));
const { aiPickKpis, aiKpiLead } = await import('./aiAgents');

describe('KPI explainer: AI helpers', () => {
  beforeEach(() => chat.mockReset());
  const names = ['Open Case Backlog', 'Case Closure Rate', 'Total Cases Received'];

  it('picks only KPIs from the list, copied by name', async () => {
    chat.mockResolvedValue({ kpis: ['case closure rate', 'Made Up KPI', 'Case Closure Rate'] });
    expect(await aiPickKpis('how fast do we close stuff', names)).toEqual(['Case Closure Rate']);
    const [system, user] = chat.mock.calls[0] as [string, string];
    expect(system).toMatch(/ONLY names from the list/);
    expect(user).toContain('Open Case Backlog\nCase Closure Rate\nTotal Cases Received');
  });

  it('the direct answer is built from the explanation text only', async () => {
    const facts = 'Open Case Backlog\nHow it\'s calculated: Number of case records in Case Activity, where Case Status is "Open" or "Escalated".';
    chat.mockResolvedValue({ answer: 'Yes, escalated cases count as open.' });
    expect(await aiKpiLead('Are escalated cases in the backlog?', facts)).toBe('Yes, escalated cases count as open.');
    const [, user] = chat.mock.calls[0] as [string, string];
    expect(user).toBe(`Facts:\n${facts}\n\nQuestion: Are escalated cases in the backlog?`);
  });

  it('a direct answer with a number that is not in the facts is dropped', async () => {
    chat.mockResolvedValue({ answer: 'There are 282 open cases right now.' });
    expect(await aiKpiLead('How big is the backlog?', 'Open Case Backlog: count of open cases.')).toBeNull();
  });

  it('an empty or overlong answer is dropped', async () => {
    chat.mockResolvedValue({ answer: '' });
    expect(await aiKpiLead('q', 'facts')).toBeNull();
    chat.mockResolvedValue({ answer: 'x'.repeat(500) });
    expect(await aiKpiLead('q', 'facts')).toBeNull();
  });
});
