import { describe, it, expect } from 'vitest';
import { coerce, IngestError, parseCsvText, parseJsonText } from './ingest';
import { parseDate, previousPeriod, resolvePeriod, toIsoDate, bucketOf, bucketRange } from './dates';

describe('ingestion', () => {
  it('parses CSV and coerces values without losing leading zeros', () => {
    const t = parseCsvText('ID,Zip,Qty,Note\nA1,02134,3,\nA2,10001,4.5,ok\n', 'x.csv');
    expect(t.columns).toEqual(['ID', 'Zip', 'Qty', 'Note']);
    expect(t.rows[0]).toEqual({ ID: 'A1', Zip: '02134', Qty: 3, Note: null });
    expect(t.rows[1].Qty).toBe(4.5);
  });
  it('rejects empty CSV and invalid JSON with an explanation', () => {
    expect(() => parseCsvText('a,b\n', 'e.csv')).toThrow(IngestError);
    expect(() => parseJsonText('{oops', 'bad.json')).toThrow(/not valid JSON/);
    expect(() => parseJsonText('{"a":1}', 'obj.json')).toThrow(/array of records/);
  });
  it('accepts wrapped JSON arrays and flattens one level', () => {
    const t = parseJsonText('{"data":[{"id":1,"geo":{"region":"N"}}]}', 'w.json');
    expect(t.rows[0]).toEqual({ id: 1, geo_region: 'N' });
  });
  it('coerces nulls', () => expect([coerce('N/A'), coerce(''), coerce(' 7 ')]).toEqual([null, null, 7]));
});

describe('dates', () => {
  it('parses common formats', () => {
    expect(toIsoDate(parseDate('2026-03-04')!.t)).toBe('2026-03-04');
    expect(toIsoDate(parseDate('03/04/2026')!.t)).toBe('2026-03-04');
    expect(toIsoDate(parseDate('25/04/2026')!.t)).toBe('2026-04-25');
    expect(parseDate('2026-02-30')).toBeNull();
    expect(parseDate('hello')).toBeNull();
  });
  it('previous period is adjacent and equal length', () => {
    const anchor = parseDate('2026-10-30')!.t;
    const p = resolvePeriod('r13w', anchor, 0)!;
    const q = previousPeriod(p);
    expect(toIsoDate(p.start)).toBe('2026-08-01');
    expect(p.start - q.end).toBe(86_400_000);
    expect(p.end - p.start).toBe(q.end - q.start);
  });
  it('buckets weeks from Monday and fills ranges', () => {
    expect(bucketOf(parseDate('2026-11-08')!.t, 'week')).toBe('2026-11-02');
    expect(bucketRange('2025-11', '2026-02', 'month')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(bucketRange('2025-Q4', '2026-Q2', 'quarter')).toEqual(['2025-Q4', '2026-Q1', '2026-Q2']);
  });
});
