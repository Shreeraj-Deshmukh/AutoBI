import { describe, it, expect } from 'vitest';
import { generateAccessData, ACCESS_NARRATIVE } from '@/lib/sampleData';
import { runDemoPipeline } from '@/lib/powerbi/demoPipeline';
import { applyDesignCommand } from './designAgent';
import { classifyDesignMessage, explainKpiQuestion, findKpis, type KpiContext } from './kpiExplainer';

/** The Design assistant explains KPIs (meaning, logic, formula) and still makes design edits exactly as before. */
describe('KPI explainer in the Design assistant (FRM)', () => {
  const d = generateAccessData();
  const r = runDemoPipeline('Sanofi FRM', ACCESS_NARRATIVE, [
    { name: 'sp_patient_journey', rows: d.journey },
    { name: 'payer_plan_pbm', rows: d.plans },
    { name: 'hcps', rows: d.hcps },
    { name: 'frm_territories', rows: d.territories },
    { name: 'frm_cases', rows: d.cases },
    { name: 'product_master', rows: d.products },
  ]);
  const ctx: KpiContext = { u: r.u, f: r.f, spec: r.design, activePageId: r.design.pages[0].id };
  const cat = (ref: string) => r.f.measures.find((m) => m.catalogueRef === ref)!;
  const dax: Record<string, string> = {};
  for (const [id, v] of r.pbi.model.measureOf) dax[id] = `${v.name} = ${r.pbi.model.table(v.table)!.measures.find((x) => x.name === v.name)!.expression}`;
  const ask = (q: string, opts: Parameters<typeof explainKpiQuestion>[2] = {}) => explainKpiQuestion(q, ctx, opts);

  describe('edit or question', () => {
    const EDITS = [
      // the demo script
      'Add a payer filter',
      'Add a time period filter',
      'Add a specialty filter',
      // every command form of the assistant
      'Move Open Case Aging to FRM Performance',
      'Remove the market filter',
      'Replace Open Case Aging with a bar chart',
      'Rename Priority Prescribers to Priority HCPs',
      'Add a weekly comparison',
      'Weekly comparison',
      'Add page Regional Deep Dive',
      'Add KPI Escalated Cases',
      'Add bar chart Open Case Backlog by Payer',
      'Show prescribers with more than 5 Open Case Backlog',
      'Remove Open Case Aging',
      'Make Open Case Aging full width',
      'Open Case Aging full width',
      // polite forms
      'Can you add a payer filter?',
      'Please rename Cases to Case Summary',
      'How about adding a payer filter?',
      'Could we move Case Overview to FRM Performance?',
    ];
    it.each(EDITS)('"%s" is a design edit', (t) => expect(classifyDesignMessage(t, ctx)).toBe('edit'));

    const QUESTIONS = [
      'How is Case Closure Rate calculated?',
      'What does Open Case Backlog mean?',
      'Explain the Cases card',
      'Which columns does Time to First Fill use?',
      'Does the open backlog include escalated cases?',
      'Can you explain First Response Time?',
      'Show me the formula for Case Closure Rate',
      'List the KPIs on this page',
      "What's the DAX for Open Case Backlog?",
      'How many open cases are there?',
      'closure rate formula',
    ];
    it.each(QUESTIONS)('"%s" is a question', (t) => expect(classifyDesignMessage(t, ctx)).toBe('question'));

    it.each(['Open Case Backlog by payer', 'closure rate'])('"%s" (a KPI, no verb, no question) asks which is meant', (t) => expect(classifyDesignMessage(t, ctx)).toBe('unclear'));

    it('the demo filter commands still change the design exactly as before', () => {
      for (const t of ['Add a payer filter', 'Add a specialty filter']) {
        const res = applyDesignCommand(r.design, t, { u: r.u, f: r.f });
        expect(res.changed, t).toBe(true);
      }
    });
  });

  describe('explaining a KPI', () => {
    it('a ratio is explained through its parts, with the period and the data it uses', () => {
      const a = ask('How is Case Closure Rate calculated?');
      expect(a.kind).toBe('definition');
      expect(a.kpis.map((m) => m.id)).toEqual([cat('Case Closure Rate (%)').id]);
      expect(a.reply).toContain('Total Cases Closed ÷ Total Cases Received, shown as a percentage');
      expect(a.reply).toContain('Case Status is "Closed"');
      expect(a.reply).toContain('selects Case Activity records by Case Open Date');
      expect(a.reply).toMatch(/Data used: Case Activity: Case ID, Case Status, Case Open Date$/m);
    });

    it('states where this dashboard differs from the ProcDNA catalogue', () => {
      const a = ask('What does Open Case Backlog mean?');
      expect(a.reply).toContain('Case Status is "Open" or "Escalated"');
      expect(a.reply).toContain("COUNT(case_id) WHERE case_status IN ('Open','Pending')");
      expect(a.reply).toContain('The data has no Case Status "Pending"');
      expect(a.reply).toContain('Case Status "Escalated" is also counted here');
      expect(a.reply).toMatch(/as of the end of the period; here records are selected by Case Open Date/);
    });

    it('says where the KPI is shown, by its label on a card', () => {
      const a = ask('What is Open in the Cases card?');
      expect(a.kpis[0].id).toBe(cat('Open Case Backlog').id);
      expect(a.reply).toContain('"Open" in Cases');
    });

    it('answers "does it include …" from the KPI conditions', () => {
      expect(ask('Does the open backlog include escalated cases?').reply).toMatch(/^Yes: records with Case Status "Escalated" are counted in Open Case Backlog/);
      expect(ask('Does Open Case Backlog include closed cases?').reply).toMatch(/^No: Open Case Backlog only counts records where Case Status is "Open" or "Escalated"/);
    });

    it('a catalogue alias is answered by the KPI that computes it, with the catalogue note', () => {
      const a = ask('What is FRM Cycle Time?');
      expect(a.kpis[0].id).toBe(cat('Average Case Resolution Time (days)').id);
      expect(a.reply).toContain('"FRM Cycle Time" in the ProcDNA catalogue is answered by this KPI');
    });

    it('compares two KPIs', () => {
      const a = ask('What is the difference between average and median resolution time?');
      expect(a.kind).toBe('difference');
      expect(a.kpis.map((m) => m.id).sort()).toEqual([cat('Average Case Resolution Time (days)').id, cat('Median Case Resolution Time (days)').id].sort());
      expect(a.reply).toMatch(/Main difference: Both use Days to Resolution/);
    });

    it('a name that fits two KPIs equally shows both; a full name shows one', () => {
      expect(ask('How is resolution time calculated?').kind).toBe('several');
      const one = ask('How is Time to First Fill calculated?');
      expect(one.kind).toBe('definition');
      expect(one.kpis.map((m) => m.id)).toEqual([cat('Time to First Fill (days)').id]);
    });

    it('lists the KPIs of the page', () => {
      const a = ask('Which KPIs are on this page?');
      expect(a.kind).toBe('list');
      expect(a.reply).toMatch(/^KPIs on "Field Reimbursement Management":/);
      for (const n of ['Total Cases Received', 'Open Case Backlog', 'Case Closure Rate']) expect(a.reply).toContain(`• ${n}`);
    });

    it('shows the Power BI DAX only when asked, exactly as exported', () => {
      const m = cat('Open Case Backlog');
      expect(ask('What does Open Case Backlog mean?', { dax }).reply).not.toContain('DAX');
      const a = ask("What's the DAX for Open Case Backlog?", { dax });
      expect(a.reply).toContain(`Power BI (DAX): ${dax[m.id]}`);
      expect(dax[m.id]).toMatch(/^Open Case Backlog = CALCULATE\(COUNTA\('Fact_Case_Activity'\[Case ID\]\)/);
    });

    it('raw column names are shown by their reporting names', () => {
      expect(ask('Explain First Response Time').reply).not.toMatch(/\b[A-Z][a-z]+_[A-Z]/);
    });

    it('every FRM dashboard KPI can be explained by its name', () => {
      const shown = [...new Set(r.design.pages.filter((p) => p.template === 'frm').flatMap((p) => p.components.flatMap((c) => c.measureIds)))].map((id) => r.f.measures.find((m) => m.id === id)!);
      expect(shown.length).toBeGreaterThan(8);
      for (const m of shown) {
        const a = ask(`How is ${m.name} calculated?`);
        expect(a.kpis.map((k) => k.id), m.name).toContain(m.id);
        expect(a.reply, m.name).toContain("How it's calculated: ");
      }
    });

    it('never changes the design', () => {
      const before = JSON.stringify(r.design);
      for (const q of ['How is Case Closure Rate calculated?', 'Which KPIs are on this page?', 'What is average patient age?']) ask(q, { dax });
      expect(JSON.stringify(r.design)).toBe(before);
    });
  });

  describe('what it does not answer', () => {
    it('values are on the dashboard', () => {
      for (const q of ['How many cases are open?', 'Which region has the lowest closure rate?', 'What was the backlog last month?']) {
        const a = ask(q);
        expect(a.kind, q).toBe('value');
        expect(a.reply).toMatch(/I don't look up its values/);
      }
    });

    it('a KPI the data cannot provide is said to be missing, not matched to a near one', () => {
      const a = ask('What is average patient age?');
      expect(a.kind).toBe('missing');
      expect(a.kpis).toEqual([]);
      expect(a.reply).toMatch(/no "age" values/);
      expect(a.reply).toContain('"average patient age"');
    });

    it('a requirement left out of the dashboard says why', () => {
      const withGap: KpiContext = { ...ctx, u: { ...r.u, mappings: [...r.u.mappings, { id: 'x', requirement: 'Average copay amount per patient', kind: 'kpi', sources: [], fields: [], status: 'missing', note: 'The data has no "amount" values (no numeric column for it).' }] } };
      const a = explainKpiQuestion('Why is average copay amount per patient not shown?', withGap);
      expect(a.kind).toBe('missing');
      expect(a.reply).toMatch(/^"Average copay amount per patient" isn't on this dashboard: the uploaded data can't support it\./);
    });

    it('a catalogue metric this data cannot calculate names the data it needs', () => {
      const a = ask('What is Cases per Case Manager?');
      expect(a.kind).toBe('missing');
      expect(a.reply).toMatch(/ProcDNA KPI Catalogue metric.*this data can't calculate it\. Needs /);
    });

    it('an unknown name lists the KPIs of the page', () => {
      const a = ask('What is the zebra index?');
      expect(a.kpis).toEqual([]);
      expect(a.reply).toContain('KPIs on this page: Total Cases Received');
    });

    it('finds nothing for an edit-only message', () => {
      expect(findKpis('Add a payer filter', ctx)).toEqual([]);
    });
  });
});
