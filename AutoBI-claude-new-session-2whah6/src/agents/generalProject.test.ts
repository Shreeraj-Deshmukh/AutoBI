import { describe, it, expect } from 'vitest';
import type { Row } from '@/types';
import { runDemoPipeline } from '@/lib/powerbi/demoPipeline';
import { emptyFilters } from '@/lib/engine';
import { projectBrief } from './aiAgents';

/**
 * A project outside the built-in kits: B2B sales with order LINES (no unique row id), a product catalogue keyed
 * by SKU, customers that carry an onboarding date, and monthly targets per rep.
 */
function salesData() {
  const reps = ['R1', 'R2', 'R3'].map((id, i) => ({ Rep_ID: id, Rep_Name: `Rep ${i + 1}`, Region: i < 2 ? 'North' : 'South', Hire_Date: `2020-0${i + 1}-15` }));
  const customers = Array.from({ length: 12 }, (_, i) => ({ Customer_ID: `C${i + 1}`, Customer_Name: `Customer ${i + 1}`, Segment: ['Enterprise', 'SMB'][i % 2], Account_Owner_Rep_ID: reps[i % 3].Rep_ID, Onboarded_Date: `2023-0${(i % 9) + 1}-10` }));
  const products = Array.from({ length: 6 }, (_, i) => ({ SKU: `SKU-${i + 1}`, Product_Name: `Product ${i + 1}`, Category: ['Snacks', 'Beverages', 'Home Care'][i % 3], List_Price: 50 + i * 10, Launch_Date: `2021-0${i + 1}-01` }));
  const lines: Row[] = [];
  for (let o = 1; o <= 120; o++) {
    const status = o % 10 === 0 ? 'Cancelled' : o % 7 === 0 ? 'Returned' : 'Delivered';
    const c = customers[o % 12];
    for (let l = 1; l <= (o % 3) + 1; l++) {
      const p = products[(o + l) % 6];
      const qty = 2 + ((o * l) % 9);
      lines.push({ Order_ID: `SO-${o}`, Line_No: l, Order_Date: `2026-${String((o % 9) + 1).padStart(2, '0')}-${String((o % 27) + 1).padStart(2, '0')}`, Customer_ID: c.Customer_ID, SKU: p.SKU, Rep_ID: c.Account_Owner_Rep_ID, Channel: ['Direct', 'Distributor'][o % 2], Quantity: qty, Unit_Price: p.List_Price, Discount_Pct: [0, 5, 10][o % 3], Net_Amount: qty * p.List_Price, Order_Status: status });
    }
  }
  const targets = reps.flatMap((r) => Array.from({ length: 9 }, (_, m) => ({ Month: `2026-0${m + 1}-01`, Rep_ID: r.Rep_ID, Target_Net_Sales: 20000 })));
  return [
    { name: 'sales_orders', rows: lines },
    { name: 'product_catalog', rows: products as Row[] },
    { name: 'customers', rows: customers as Row[] },
    { name: 'sales_reps', rows: reps as Row[] },
    { name: 'sales_targets', rows: targets as Row[] },
  ];
}

const BRIEF = 'We need a sales dashboard. Track net sales, number of orders, average order value and units sold, monthly. Track the cancellation rate and the return rate. Exclude cancelled orders from sales. Identify the top 10 customers by net sales. Filter by region, channel and segment.';

describe('a general project (B2B sales with order lines, SKU catalogue, targets)', () => {
  const data = salesData();
  const r = runDemoPipeline('Sales Performance', BRIEF, data);
  const prof = (label: string) => r.u.profiles.find((p) => p.label === label)!;
  const measure = (name: string) => r.f.measures.find((m) => m.name === name)!;
  const value = (name: string) => r.engine.kpi(measure(name).id, emptyFilters('all')).current!;
  const lines = data[0].rows;

  it('names every metric in the brief as a KPI and keeps exclusions as business rules', () => {
    const kpis = r.spec.kpis.map((k) => k.text.toLowerCase());
    for (const k of ['net sales', 'average order value', 'units sold', 'cancellation rate', 'return rate']) expect(kpis).toContain(k);
    expect(r.spec.rules.some((x) => /exclude cancelled orders/i.test(x.text))).toBe(true);
    // "top 10 customers by net sales" ranks by a metric: net sales is not a breakdown
    expect(r.spec.dimensions.some((d) => /net sales/i.test(d.text))).toBe(false);
  });

  it('recognises a SKU-keyed catalogue and masters that carry a date', () => {
    expect(prof('Product Master').primaryKey).toBe('SKU');
    expect(prof('Customer Master').kind).toBe('master');
    expect(prof('Customer Master').dateField).toBeUndefined(); // an onboarding date does not make customers transactional
    const links = r.u.relationships.map((x) => `${x.fromField}>${r.u.profiles.find((p) => p.datasetId === x.toDataset)!.label}`);
    expect(links).toEqual(expect.arrayContaining(['SKU>Product Master', 'Customer_ID>Customer Master', 'Rep_ID>Rep Master']));
  });

  it('counts orders once on line-level data', () => {
    const orders = prof('Order Activity');
    expect(orders.recordKey).toBe('Order_ID');
    expect(measure('Total Orders').kind).toBe('countDistinct');
    expect(value('Total Orders')).toBe(120);
    expect(value('Total Order Lines')).toBe(lines.length);
    // a line counter is neither summed nor used to slice
    expect(orders.columns.find((c) => c.name === 'Line_No')!.role).toBe('attribute');
  });

  it('does not add up prices or percentages', () => {
    expect(r.f.measures.some((m) => m.kind === 'sum' && /Unit_Price|Discount_Pct/.test(m.field ?? ''))).toBe(false);
    expect(measure('Avg Unit Price').kind).toBe('avg');
  });

  it('applies the exclusion rule to amounts and builds rates on orders', () => {
    const net = measure('Total Net Amount');
    expect(net.logic).toContain("Order_Status ≠ 'Cancelled'");
    expect(value('Total Net Amount')).toBe(lines.filter((l) => l.Order_Status !== 'Cancelled').reduce((s, l) => s + Number(l.Net_Amount), 0));
    expect(value('Cancellation Rate')).toBeCloseTo((12 / 120) * 100, 5);
    expect(value('Average Order Value')).toBeCloseTo(value('Total Net Amount') / 120, 5);
  });

  it('compares actual sales with the targets table', () => {
    const att = r.f.measures.find((m) => /Target Attainment$/.test(m.name))!;
    expect(att.kind).toBe('ratio');
    expect(r.f.measures.find((m) => m.id === att.numeratorId)!.field).toBe('Net_Amount');
    expect(r.f.measures.find((m) => m.id === att.denominatorId)!.field).toBe('Target_Net_Sales');
  });

  it('builds a dashboard in which every visual has data', () => {
    expect(r.build.validations.filter((v) => !v.ok)).toEqual([]);
    expect(r.build.spec.pages[0].components[0].title).toBe('Total Net Amount');
  });

  it('gives the AI agents one picture of the engagement', () => {
    const text = projectBrief({ info: { name: 'Sales Performance', client: 'Consumer Goods', domain: 'B2B sales', objective: '', audience: 'Sales managers', problem: '', frequency: 'Monthly', period: '', keyQuestions: [] }, requirements: r.spec, understanding: r.u, history: [{ role: 'user', text: 'Add a brand filter' }] }, ['engagement', 'requirements', 'data', 'history']);
    expect(text).toContain('Audience: Sales managers');
    expect(text).toContain('Exclude cancelled orders from sales');
    expect(text).toContain('several lines per order, Order_ID repeats');
    expect(text).toContain('User: Add a brand filter');
  });
});
