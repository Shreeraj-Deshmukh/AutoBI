import { useEffect, useState } from 'react';
import { Database, Snowflake, Loader2, Lock, ServerCog } from 'lucide-react';
import { Button, Field, Modal, cx } from './ui';
import { importWarehouseTables, listWarehouseTables, type WarehouseRequest } from '@/store/orchestrator';

type Provider = 'databricks' | 'snowflake';
interface Status {
  configured: boolean;
  host?: string;
  account?: string;
  catalog?: string;
  database?: string;
  schema?: string;
}

const FIELDS: Record<Provider, { key: string; label: string; placeholder: string; secret?: boolean; select?: string[] }[]> = {
  databricks: [
    { key: 'host', label: 'Workspace URL', placeholder: 'adb-1234567890123456.7.azuredatabricks.net' },
    { key: 'token', label: 'Personal access token', placeholder: 'dapi…', secret: true },
    { key: 'warehouseId', label: 'SQL warehouse ID', placeholder: '1a2b3c4d5e6f7g8h' },
  ],
  snowflake: [
    { key: 'account', label: 'Account identifier', placeholder: 'myorg-myaccount' },
    { key: 'token', label: 'Access token', placeholder: 'Programmatic access token or OAuth token', secret: true },
    { key: 'tokenType', label: 'Token type', placeholder: '', select: ['PROGRAMMATIC_ACCESS_TOKEN', 'OAUTH', 'KEYPAIR_JWT'] },
    { key: 'warehouse', label: 'Warehouse', placeholder: 'COMPUTE_WH' },
    { key: 'role', label: 'Role (optional)', placeholder: 'ANALYST' },
  ],
};

export default function ConnectSource({ pid, onClose }: { pid: string; onClose: () => void }) {
  const [provider, setProvider] = useState<Provider>('databricks');
  const [status, setStatus] = useState<Record<Provider, Status> | null>(null);
  const [useServer, setUseServer] = useState(true);
  const [conn, setConn] = useState<Record<string, string>>({});
  const [catalog, setCatalog] = useState('');
  const [schema, setSchema] = useState('');
  const [tables, setTables] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [limit, setLimit] = useState(50000);
  const [busy, setBusy] = useState<'browse' | 'import' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('api/warehouse/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setStatus(j))
      .catch(() => setStatus(null));
  }, []);
  const st = status?.[provider];
  const serverConfigured = !!st?.configured;
  useEffect(() => {
    setTables(null);
    setPicked([]);
    setError('');
    setCatalog((provider === 'databricks' ? st?.catalog : st?.database) ?? '');
    setSchema(st?.schema ?? '');
    setUseServer(serverConfigured);
  }, [provider, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const req = (): WarehouseRequest => ({ provider, catalog, schema, connection: useServer && serverConfigured ? undefined : conn });
  const browse = async () => {
    setBusy('browse');
    setError('');
    try {
      const t = await listWarehouseTables(req());
      setTables(t);
      setPicked([]);
      if (!t.length) setError('No tables found in this schema.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const doImport = async () => {
    setBusy('import');
    const errors = await importWarehouseTables(pid, req(), picked, limit);
    setBusy(null);
    if (errors.length < picked.length) onClose();
    else setError(errors.join(' '));
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Connect a data source"
      wide
      footer={
        <>
          <span className="mr-auto flex items-center gap-1.5 text-[0.6875rem] text-slate-500"><Lock className="h-3 w-3" />Credentials are used by the Celestra server for this request only and are never stored in the browser.</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!picked.length} loading={busy === 'import'} onClick={doImport}>Import {picked.length || ''} table{picked.length === 1 ? '' : 's'}</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {(['databricks', 'snowflake'] as const).map((pv) => (
          <button key={pv} onClick={() => setProvider(pv)} className={cx('flex items-center gap-3 rounded-lg border p-3 text-left transition', provider === pv ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300')}>
            <span className={cx('flex h-9 w-9 items-center justify-center rounded-lg', pv === 'databricks' ? 'bg-orange-50 text-orange-600' : 'bg-brand-50 text-brand-600')}>{pv === 'databricks' ? <Database className="h-4.5 w-4.5 h-[1.125rem] w-[1.125rem]" /> : <Snowflake className="h-[1.125rem] w-[1.125rem]" />}</span>
            <span>
              <span className="block text-sm font-semibold text-navy-900">{pv === 'databricks' ? 'Databricks' : 'Snowflake'}</span>
              <span className="block text-[0.6875rem] text-slate-500">{pv === 'databricks' ? 'Unity Catalog via SQL warehouse' : 'Tables via the Snowflake SQL API'}</span>
            </span>
            {status?.[pv]?.configured && <span className="ml-auto rounded bg-emerald-50 px-1.5 py-0.5 text-[0.625rem] font-medium text-emerald-700">Configured</span>}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-4">
        {serverConfigured && (
          <label className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <ServerCog className="h-4 w-4 text-slate-500" />
            <input type="checkbox" checked={useServer} onChange={(e) => setUseServer(e.target.checked)} />
            Use the connection configured on the server ({st?.host ?? st?.account})
          </label>
        )}
        {!(useServer && serverConfigured) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS[provider].map((f) => (
              <Field key={f.key} label={f.label}>
                {f.select ? (
                  <select className="input" value={conn[f.key] ?? f.select[0]} onChange={(e) => setConn({ ...conn, [f.key]: e.target.value })}>{f.select.map((o) => <option key={o}>{o}</option>)}</select>
                ) : (
                  <input className="input" type={f.secret ? 'password' : 'text'} autoComplete="off" placeholder={f.placeholder} value={conn[f.key] ?? ''} onChange={(e) => setConn({ ...conn, [f.key]: e.target.value })} />
                )}
              </Field>
            ))}
          </div>
        )}
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Field label={provider === 'databricks' ? 'Catalog' : 'Database'}><input className="input" value={catalog} onChange={(e) => setCatalog(e.target.value)} placeholder={provider === 'databricks' ? 'main' : 'ANALYTICS'} /></Field>
          <Field label="Schema"><input className="input" value={schema} onChange={(e) => setSchema(e.target.value)} placeholder={provider === 'databricks' ? 'commercial' : 'PUBLIC'} /></Field>
          <Button onClick={browse} loading={busy === 'browse'} disabled={!catalog || !schema}>Browse tables</Button>
        </div>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {tables && tables.length > 0 && (
          <div className="rounded-lg border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
              <label className="flex items-center gap-2"><input type="checkbox" checked={picked.length === tables.length} onChange={(e) => setPicked(e.target.checked ? tables : [])} />{tables.length} tables in {catalog}.{schema}</label>
              <label className="flex items-center gap-2">Rows per table <input type="number" min={100} max={200000} step={1000} className="input w-28 py-1 text-xs" value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></label>
            </div>
            <div className="grid max-h-56 gap-1 overflow-y-auto p-2 sm:grid-cols-2">
              {tables.map((t) => (
                <label key={t} className="flex items-center gap-2 rounded px-2 py-1 font-mono text-xs hover:bg-slate-50">
                  <input type="checkbox" checked={picked.includes(t)} onChange={() => setPicked(picked.includes(t) ? picked.filter((x) => x !== t) : [...picked, t])} />
                  {t}
                </label>
              ))}
            </div>
          </div>
        )}
        {busy === 'import' && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Importing {picked.length} table(s)…</div>}
      </div>
    </Modal>
  );
}
