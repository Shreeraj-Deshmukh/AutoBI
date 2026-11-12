import { describe, it, expect } from 'vitest';
import type { DatasetMeta, MeasureDef, Row } from '@/types';
import { Engine, emptyFilters, ref } from './engine';
import { classifyDatasets, detectRelationships, profileDataset } from './profile';

const customers: Row[] = [
  { Customer_ID: 'C1', Customer_Name: 'Acme', Region: 'North', Tier: 'Gold' },
  { Customer_ID: 'C2', Customer_Name: 'Beta', Region: 'South', Tier: 'Silver' },
  { Customer_ID: 'C3', Customer_Name: 'Gamma', Region: 'North', Tier: 'Silver' },
];
const orders: Row[] = [
  { Order_ID: 'O1', Customer_ID: 'C1', Order_Date: '2026-01-05', Status: 'Shipped', Amount: 100 },
  { Order_ID: 'O2', Customer_ID: 'C1', Order_Date: '2026-01-20', Status: 'Cancelled', Amount: 50 },
  { Order_ID: 'O3', Customer_ID: 'C2', Order_Date: '2026-02-03', Status: 'Shipped', Amount: 70 },
  { Order_ID: 'O4', Customer_ID: 'C3', Order_Date: '2026-02-10', Status: 'Shipped', Amount: 30 },
  { Order_ID: 'O5', Customer_ID: 'C9', Order_Date: '2026-02-11', Status: 'Shipped', Amount: 5 },
];
const data: Record<string, Row[]> = { cust: customers, ord: orders };
const meta = (id: string, name: string): DatasetMeta => ({ id, name, fileName: `${name}.csv`, format: 'csv', rowCount: data[id].length, columnCount: Object.keys(data[id][0]).length, columns: Object.keys(data[id][0]), uploadedAt: '', status: 'uploaded', isSample: false });
const profiles = [profileDataset(meta('cust', 'customers'), customers), profileDataset(meta('ord', 'orders'), orders)];
const rels = detectRelationships(profiles, (id) => data[id]);
classifyDatasets(profiles, rels);

const M = (m: Partial<MeasureDef> & { id: string }): MeasureDef => ({ name: m.id, description: '', kind: 'count', format: 'number', logic: '', assumptions: [], ...m });
const measures = [
  M({ id: 'orders', datasetId: 'ord', field: 'Order_ID' }),
  M({ id: 'shipped', datasetId: 'ord', field: 'Order_ID', condition: { field: 'Status', op: 'eq', values: ['Shipped'] } }),
  M({ id: 'rate', kind: 'ratio', numeratorId: 'shipped', denominatorId: 'orders', format: 'percent' }),
  M({ id: 'amount', kind: 'sum', datasetId: 'ord', field: 'Amount' }),
  M({ id: 'customers', datasetId: 'cust', field: 'Customer_ID' }),
];
const engine = new Engine({ profiles, relationships: rels, measures, rowsOf: (id) => data[id] });

describe('profiling & relationships', () => {
  it('infers master vs activity datasets and the join', () => {
    expect(profiles[0].kind).toBe('master');
    expect(profiles[0].label).toBe('Customer Master');
    expect(profiles[1].kind).toBe('activity');
    expect(profiles[1].primaryKey).toBe('Order_ID');
    expect(rels).toHaveLength(1);
    expect(rels[0]).toMatchObject({ fromDataset: 'ord', fromField: 'Customer_ID', toDataset: 'cust', unmatched: 1 });
  });
});

describe('engine calculations', () => {
  const all = emptyFilters();
  it('counts, conditional counts, sums and ratios', () => {
    expect(engine.value('orders', all, null)).toBe(5);
    expect(engine.value('shipped', all, null)).toBe(4);
    expect(engine.value('rate', all, null)).toBeCloseTo(80);
    expect(engine.value('amount', all, null)).toBe(255);
  });
  it('filters through a many-to-one join and keeps unmatched rows visible', () => {
    const f = { ...all, selections: { [ref('cust', 'Region')]: ['North'] } };
    expect(engine.value('orders', f, null)).toBe(3);
    expect(engine.value('amount', f, null)).toBe(180);
    const g = engine.group('orders', ref('cust', 'Region'), all);
    expect(Object.fromEntries(g.map((x) => [x.key, x.value]))).toEqual({ North: 3, South: 1, '(Unmatched)': 1 });
    expect(g.reduce((s, x) => s + x.value, 0)).toBe(5);
  });
  it('does not apply filters to measures that cannot reach the field', () => {
    const f = { ...all, selections: { [ref('ord', 'Status')]: ['Shipped'] } };
    expect(engine.applies('customers', ref('ord', 'Status'))).toBe(false);
    expect(engine.value('customers', f, null)).toBe(3);
  });
  it('groups by time and compares periods', () => {
    expect(engine.series('orders', 'month', all)).toEqual([{ bucket: '2026-01', value: 2 }, { bucket: '2026-02', value: 3 }]);
    const k = engine.kpi('orders', { period: 'last4w', selections: {} });
    // anchor = 2026-02-11 → current 2026-01-15..2026-02-11, previous 2025-12-18..2026-01-14
    expect(k.current).toBe(4);
    expect(k.previous).toBe(1);
    expect(k.delta).toBeCloseTo(300);
  });
  it('builds tables whose totals reconcile', () => {
    const t = engine.table(ref('cust', 'Customer_Name'), ['orders', 'amount'], [ref('cust', 'Tier')], all);
    expect(t.reduce((s, r) => s + (r.orders as number), 0)).toBe(5);
    expect(t.find((r) => r.__key === 'Acme')).toMatchObject({ orders: 2, amount: 150, [ref('cust', 'Tier')]: 'Gold' });
  });
});
