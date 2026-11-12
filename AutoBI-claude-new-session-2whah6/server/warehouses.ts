import type { Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Databricks & Snowflake connectors (server side).
 *
 * Credentials come from environment variables (preferred) or from the
 * connection form in the app; either way they are only used here on the
 * Celestra server and never stored in the browser.
 *
 * Databricks: SQL Statement Execution API (POST /api/2.0/sql/statements)
 *   DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_ID, [DATABRICKS_CATALOG, DATABRICKS_SCHEMA]
 * Snowflake: SQL API v2 (POST /api/v2/statements)
 *   SNOWFLAKE_ACCOUNT, SNOWFLAKE_TOKEN, [SNOWFLAKE_TOKEN_TYPE=PROGRAMMATIC_ACCESS_TOKEN|OAUTH|KEYPAIR_JWT],
 *   SNOWFLAKE_WAREHOUSE, [SNOWFLAKE_DATABASE, SNOWFLAKE_SCHEMA, SNOWFLAKE_ROLE]
 */

export type Provider = 'databricks' | 'snowflake';
type Cell = string | number | boolean | null;

export interface DatabricksConn {
  host: string;
  token: string;
  warehouseId: string;
  catalog?: string;
  schema?: string;
}
export interface SnowflakeConn {
  account: string;
  token: string;
  tokenType?: string;
  warehouse?: string;
  database?: string;
  schema?: string;
  role?: string;
}

export const MAX_ROWS = 200_000;
const IDENT = /^[A-Za-z0-9_$-]{1,255}$/;

export function ident(v: string | undefined, what: string) {
  if (!v || !IDENT.test(v)) throw new HttpError(400, `Invalid ${what} name "${v ?? ''}". Use letters, digits, _ $ or -.`);
  return v;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Only real Databricks workspace hosts are allowed (prevents the proxy being used to reach arbitrary hosts). */
export function normalizeDatabricksHost(h: string) {
  const host = h.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+\.(cloud\.databricks\.com|azuredatabricks\.net|gcp\.databricks\.com)$/i.test(host)) throw new HttpError(400, 'Databricks host must be a workspace URL such as adb-123.4.azuredatabricks.net or dbc-xxxx.cloud.databricks.com.');
  return `https://${host}`;
}

export function snowflakeBase(account: string) {
  const a = account.trim().replace(/^https?:\/\//, '').replace(/\.snowflakecomputing\.com.*$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(a)) throw new HttpError(400, 'Snowflake account identifier must look like orgname-account or xy12345.region.');
  return `https://${a}.snowflakecomputing.com`;
}

export function envConnections(env: Record<string, string | undefined>) {
  const db: DatabricksConn | null = env.DATABRICKS_HOST && env.DATABRICKS_TOKEN && env.DATABRICKS_WAREHOUSE_ID ? { host: env.DATABRICKS_HOST, token: env.DATABRICKS_TOKEN, warehouseId: env.DATABRICKS_WAREHOUSE_ID, catalog: env.DATABRICKS_CATALOG, schema: env.DATABRICKS_SCHEMA } : null;
  const sf: SnowflakeConn | null = env.SNOWFLAKE_ACCOUNT && env.SNOWFLAKE_TOKEN ? { account: env.SNOWFLAKE_ACCOUNT, token: env.SNOWFLAKE_TOKEN, tokenType: env.SNOWFLAKE_TOKEN_TYPE, warehouse: env.SNOWFLAKE_WAREHOUSE, database: env.SNOWFLAKE_DATABASE, schema: env.SNOWFLAKE_SCHEMA, role: env.SNOWFLAKE_ROLE } : null;
  return { databricks: db, snowflake: sf };
}

// ───────────────────────── value conversion ─────────────────────────
const NUMERIC_DB = /^(TINYINT|SMALLINT|INT|INTEGER|BIGINT|LONG|SHORT|BYTE|FLOAT|DOUBLE|DECIMAL|DEC|NUMERIC|REAL)/i;

export function convertDatabricks(v: string | null, type: string): Cell {
  if (v == null) return null;
  if (NUMERIC_DB.test(type)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  if (/^BOOLEAN/i.test(type)) return v === 'true';
  if (/^TIMESTAMP/i.test(type)) return v.replace(' ', 'T').slice(0, 19);
  return v;
}

/** Snowflake SQL API returns every value as a string; dates are days since epoch, timestamps are epoch seconds. */
export function convertSnowflake(v: string | null, type: string): Cell {
  if (v == null) return null;
  const t = type.toLowerCase();
  if (t === 'fixed' || t === 'real') {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  if (t === 'boolean') return v === 'true' || v === '1';
  if (t === 'date') return new Date(Number(v) * 86_400_000).toISOString().slice(0, 10);
  if (t.startsWith('timestamp')) {
    const secs = Number(v.split(' ')[0]);
    return Number.isFinite(secs) ? new Date(secs * 1000).toISOString().slice(0, 19) : v;
  }
  return v;
}

// ───────────────────────── Databricks ─────────────────────────
async function dbRequest(c: DatabricksConn, path: string, init?: RequestInit) {
  const res = await fetch(`${normalizeDatabricksHost(c.host)}${path}`, { ...init, headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(text);
  } catch {
    /* non-JSON error */
  }
  if (!res.ok) throw new HttpError(502, `Databricks returned ${res.status}: ${(j.message as string) ?? text.slice(0, 300)}`);
  return j;
}

interface DbStatement {
  statement_id: string;
  status: { state: string; error?: { message?: string } };
  manifest?: { schema?: { columns?: { name: string; type_name: string }[] }; total_row_count?: number };
  result?: { data_array?: (string | null)[][]; next_chunk_internal_link?: string };
}

export async function databricksQuery(c: DatabricksConn, statement: string, limit = MAX_ROWS) {
  let st = (await dbRequest(c, '/api/2.0/sql/statements', { method: 'POST', body: JSON.stringify({ warehouse_id: c.warehouseId, statement, wait_timeout: '30s', on_wait_timeout: 'CONTINUE', format: 'JSON_ARRAY', disposition: 'INLINE', row_limit: limit }) })) as unknown as DbStatement;
  for (let i = 0; i < 60 && ['PENDING', 'RUNNING'].includes(st.status.state); i++) {
    await new Promise((r) => setTimeout(r, 1000));
    st = (await dbRequest(c, `/api/2.0/sql/statements/${st.statement_id}`)) as unknown as DbStatement;
  }
  if (st.status.state !== 'SUCCEEDED') throw new HttpError(502, `Databricks query ${st.status.state.toLowerCase()}: ${st.status.error?.message ?? ''}`);
  const cols = st.manifest?.schema?.columns ?? [];
  const data: (string | null)[][] = [...(st.result?.data_array ?? [])];
  let next = st.result?.next_chunk_internal_link;
  while (next && data.length < limit) {
    const chunk = (await dbRequest(c, next)) as { data_array?: (string | null)[][]; next_chunk_internal_link?: string };
    data.push(...(chunk.data_array ?? []));
    next = chunk.next_chunk_internal_link;
  }
  return { columns: cols.map((x) => x.name), rows: data.slice(0, limit).map((r) => Object.fromEntries(cols.map((col, i) => [col.name, convertDatabricks(r[i], col.type_name)]))), truncated: data.length >= limit };
}

// ───────────────────────── Snowflake ─────────────────────────
interface SfResult {
  statementHandle?: string;
  message?: string;
  resultSetMetaData?: { rowType: { name: string; type: string }[]; partitionInfo?: unknown[] };
  data?: (string | null)[][];
}

async function sfRequest(c: SnowflakeConn, path: string, init?: RequestInit): Promise<{ status: number; body: SfResult }> {
  const res = await fetch(`${snowflakeBase(c.account)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${c.token}`, 'X-Snowflake-Authorization-Token-Type': c.tokenType || 'PROGRAMMATIC_ACCESS_TOKEN', 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Celestra/1.0', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let body: SfResult = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* ignore */
  }
  if (res.status >= 400) throw new HttpError(502, `Snowflake returned ${res.status}: ${body.message ?? text.slice(0, 300)}`);
  return { status: res.status, body };
}

export async function snowflakeQuery(c: SnowflakeConn, statement: string, limit = MAX_ROWS) {
  let { status, body } = await sfRequest(c, '/api/v2/statements', { method: 'POST', body: JSON.stringify({ statement, timeout: 120, warehouse: c.warehouse || undefined, database: c.database || undefined, schema: c.schema || undefined, role: c.role || undefined }) });
  for (let i = 0; i < 60 && status === 202 && body.statementHandle; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    ({ status, body } = await sfRequest(c, `/api/v2/statements/${body.statementHandle}`));
  }
  const rowType = body.resultSetMetaData?.rowType ?? [];
  const data = [...(body.data ?? [])];
  const parts = body.resultSetMetaData?.partitionInfo?.length ?? 1;
  for (let pi = 1; pi < parts && data.length < limit; pi++) {
    const r = await sfRequest(c, `/api/v2/statements/${body.statementHandle}?partition=${pi}`);
    data.push(...(r.body.data ?? []));
  }
  return { columns: rowType.map((x) => x.name), rows: data.slice(0, limit).map((r) => Object.fromEntries(rowType.map((col, i) => [col.name, convertSnowflake(r[i], col.type)]))), truncated: data.length >= limit };
}

// ───────────────────────── SQL builders ─────────────────────────
export const sql = {
  databricksTables: (catalog: string, schema: string) => `SHOW TABLES IN \`${ident(catalog, 'catalog')}\`.\`${ident(schema, 'schema')}\``,
  databricksSelect: (catalog: string, schema: string, table: string, limit: number) => `SELECT * FROM \`${ident(catalog, 'catalog')}\`.\`${ident(schema, 'schema')}\`.\`${ident(table, 'table')}\` LIMIT ${Math.min(Math.max(1, Math.floor(limit)), MAX_ROWS)}`,
  snowflakeTables: (database: string, schema: string) => `SHOW TABLES IN SCHEMA "${ident(database, 'database')}"."${ident(schema, 'schema')}"`,
  snowflakeSelect: (database: string, schema: string, table: string, limit: number) => `SELECT * FROM "${ident(database, 'database')}"."${ident(schema, 'schema')}"."${ident(table, 'table')}" LIMIT ${Math.min(Math.max(1, Math.floor(limit)), MAX_ROWS)}`,
};

// ───────────────────────── HTTP middleware ─────────────────────────
interface Body {
  provider?: Provider;
  connection?: Partial<DatabricksConn & SnowflakeConn>;
  catalog?: string;
  schema?: string;
  table?: string;
  limit?: number;
}

function readBody(req: IncomingMessage): Promise<string> {
  // Vercel functions hand over an already-parsed body; Vite's server gives the raw stream
  const pre = (req as IncomingMessage & { body?: unknown }).body;
  if (pre != null) return Promise.resolve(typeof pre === 'string' ? pre : Buffer.isBuffer(pre) ? pre.toString('utf8') : JSON.stringify(pre));
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => {
      d += c;
      if (d.length > 100_000) reject(new HttpError(413, 'Request too large'));
    });
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
}
const send = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

function resolveConn(b: Body, env: Record<string, string | undefined>) {
  const e = envConnections(env);
  const c = b.connection ?? {};
  if (b.provider === 'databricks') {
    const conn: DatabricksConn = { ...(e.databricks ?? { host: '', token: '', warehouseId: '' }), ...Object.fromEntries(Object.entries({ host: c.host, token: c.token, warehouseId: c.warehouseId }).filter(([, v]) => v)) };
    if (!conn.host || !conn.token || !conn.warehouseId) throw new HttpError(400, 'Databricks host, access token and SQL warehouse ID are required.');
    return { kind: 'databricks' as const, conn, catalog: b.catalog || conn.catalog || '', schema: b.schema || conn.schema || '' };
  }
  if (b.provider === 'snowflake') {
    const conn: SnowflakeConn = { ...(e.snowflake ?? { account: '', token: '' }), ...Object.fromEntries(Object.entries({ account: c.account, token: c.token, tokenType: c.tokenType, warehouse: c.warehouse, role: c.role }).filter(([, v]) => v)) };
    if (!conn.account || !conn.token) throw new HttpError(400, 'Snowflake account and access token are required.');
    return { kind: 'snowflake' as const, conn, catalog: b.catalog || conn.database || '', schema: b.schema || conn.schema || '' };
  }
  throw new HttpError(400, 'provider must be "databricks" or "snowflake"');
}

export function warehouseMiddleware(env: Record<string, string | undefined>): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (!req.url?.startsWith('/api/warehouse/')) return next();
    try {
      if (req.url.startsWith('/api/warehouse/status') && req.method === 'GET') {
        const e = envConnections(env);
        return send(res, 200, {
          databricks: e.databricks ? { configured: true, host: e.databricks.host.replace(/^https?:\/\//, ''), catalog: e.databricks.catalog ?? '', schema: e.databricks.schema ?? '' } : { configured: false },
          snowflake: e.snowflake ? { configured: true, account: e.snowflake.account, database: e.snowflake.database ?? '', schema: e.snowflake.schema ?? '' } : { configured: false },
        });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      const b = JSON.parse((await readBody(req)) || '{}') as Body;
      const r = resolveConn(b, env);
      if (req.url.startsWith('/api/warehouse/tables')) {
        if (r.kind === 'databricks') {
          const out = await databricksQuery(r.conn, sql.databricksTables(r.catalog, r.schema), 5000);
          return send(res, 200, { tables: out.rows.map((x) => String(x.tableName ?? x.table_name ?? Object.values(x)[1])).filter(Boolean).sort() });
        }
        const out = await snowflakeQuery(r.conn, sql.snowflakeTables(r.catalog, r.schema), 5000);
        return send(res, 200, { tables: out.rows.map((x) => String(x.name ?? '')).filter(Boolean).sort() });
      }
      if (req.url.startsWith('/api/warehouse/import')) {
        const limit = Math.min(Number(b.limit) || 50_000, MAX_ROWS);
        const out = r.kind === 'databricks' ? await databricksQuery(r.conn, sql.databricksSelect(r.catalog, r.schema, b.table ?? '', limit), limit) : await snowflakeQuery(r.conn, sql.snowflakeSelect(r.catalog, r.schema, b.table ?? '', limit), limit);
        return send(res, 200, { ...out, source: `${r.catalog}.${r.schema}.${b.table}` });
      }
      return send(res, 404, { error: 'Unknown warehouse route' });
    } catch (e) {
      const err = e as Error & { status?: number };
      return send(res, err instanceof HttpError ? err.status : 500, { error: err.message });
    }
  };
}
