import { describe, it, expect, vi, afterEach } from 'vitest';
import { convertSnowflake, convertDatabricks, databricksQuery, normalizeDatabricksHost, snowflakeBase, snowflakeQuery, sql } from './warehouses';

afterEach(() => vi.unstubAllGlobals());

describe('warehouse connectors', () => {
  it('only allows real Databricks / Snowflake hosts', () => {
    expect(normalizeDatabricksHost('https://adb-1.2.azuredatabricks.net/sql')).toBe('https://adb-1.2.azuredatabricks.net');
    expect(() => normalizeDatabricksHost('evil.example.com')).toThrow();
    expect(snowflakeBase('myorg-acct')).toBe('https://myorg-acct.snowflakecomputing.com');
    expect(() => snowflakeBase('a/b?c')).toThrow();
  });
  it('quotes identifiers and rejects injection', () => {
    expect(sql.databricksSelect('main', 'sales', 'orders', 100)).toBe('SELECT * FROM `main`.`sales`.`orders` LIMIT 100');
    expect(sql.snowflakeSelect('DB', 'PUBLIC', 'ORDERS', 999999)).toBe('SELECT * FROM "DB"."PUBLIC"."ORDERS" LIMIT 200000');
    expect(() => sql.databricksSelect('main', 'x', 'a; DROP TABLE b', 1)).toThrow();
  });
  it('converts typed values', () => {
    expect(convertSnowflake('19723', 'date')).toBe('2024-01-01');
    expect(convertSnowflake('12.50', 'fixed')).toBe(12.5);
    expect(convertSnowflake('1704067200.000000000', 'timestamp_ntz')).toBe('2024-01-01T00:00:00');
    expect(convertDatabricks('42', 'BIGINT')).toBe(42);
    expect(convertDatabricks('2024-01-01', 'DATE')).toBe('2024-01-01');
  });
  it('runs a Databricks statement and maps the result', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ statement_id: 's1', status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [{ name: 'id', type_name: 'INT' }, { name: 'region', type_name: 'STRING' }] } }, result: { data_array: [['1', 'North'], ['2', null]] } })));
    vi.stubGlobal('fetch', fetchMock);
    const out = await databricksQuery({ host: 'dbc-1.cloud.databricks.com', token: 't', warehouseId: 'w' }, 'SELECT 1');
    expect(out.rows).toEqual([{ id: 1, region: 'North' }, { id: 2, region: null }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://dbc-1.cloud.databricks.com/api/2.0/sql/statements');
    expect(JSON.parse(String(init.body))).toMatchObject({ warehouse_id: 'w', format: 'JSON_ARRAY', disposition: 'INLINE' });
  });
  it('runs a Snowflake statement including extra partitions', async () => {
    const pages = [
      { statementHandle: 'h', resultSetMetaData: { rowType: [{ name: 'ID', type: 'fixed' }, { name: 'D', type: 'date' }], partitionInfo: [{}, {}] }, data: [['1', '19723']] },
      { data: [['2', '19724']] },
    ];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(pages.shift())));
    vi.stubGlobal('fetch', fetchMock);
    const out = await snowflakeQuery({ account: 'org-acct', token: 't', warehouse: 'WH' }, 'SELECT 1');
    expect(out.rows).toEqual([{ ID: 1, D: '2024-01-01' }, { ID: 2, D: '2024-01-02' }]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-Snowflake-Authorization-Token-Type']).toBe('PROGRAMMATIC_ACCESS_TOKEN');
  });
});
