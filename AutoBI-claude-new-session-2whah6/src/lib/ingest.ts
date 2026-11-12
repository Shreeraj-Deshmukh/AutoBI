import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { Cell, DataFormat, Row } from '@/types';

export interface ParsedTable {
  name: string;
  fileName: string;
  format: DataFormat;
  rows: Row[];
  columns: string[];
  sizeBytes: number;
}

export class IngestError extends Error {
  constructor(
    message: string,
    public impact: string,
    public suggestion: string,
  ) {
    super(message);
  }
}

const NUMERIC = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function coerce(v: unknown): Cell {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v).trim();
  if (s === '' || /^(null|n\/a|na|nan|none)$/i.test(s)) return null;
  if (NUMERIC.test(s) && s.length < 16) return Number(s);
  return s;
}

function normalize(raw: Record<string, unknown>[]): { rows: Row[]; columns: string[] } {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, 500))
    for (const k of Object.keys(r)) {
      const key = k.trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  const rows = raw.map((r) => {
    const o: Row = {};
    for (const [k, v] of Object.entries(r)) {
      const key = k.trim();
      if (!key) continue;
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        // flatten one level of nesting for JSON sources
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
          const fk = `${key}_${k2}`;
          o[fk] = coerce(v2);
          if (!seen.has(fk)) {
            seen.add(fk);
            columns.push(fk);
          }
        }
        continue;
      }
      o[key] = coerce(v);
    }
    return o;
  });
  return { rows, columns: columns.filter((c) => rows.some((r) => c in r)) };
}

const baseName = (f: string) => f.replace(/\.[^.]+$/, '');

export async function parseFile(file: File): Promise<ParsedTable[]> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (file.size === 0) throw new IngestError(`"${file.name}" is empty (0 bytes).`, 'No records can be profiled or reported on.', 'Re-export the file from the source system and upload again.');
  if (ext === 'csv' || ext === 'txt') {
    const text = await file.text();
    return [parseCsvText(text, file.name, file.size)];
  }
  if (ext === 'json') {
    const text = await file.text();
    return [parseJsonText(text, file.name, file.size)];
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const out: ParsedTable[] = [];
    for (const sheetName of wb.SheetNames) {
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: null, raw: true });
      if (!raw.length) continue;
      const { rows, columns } = normalize(raw);
      out.push({ name: wb.SheetNames.length > 1 ? `${baseName(file.name)} – ${sheetName}` : baseName(file.name), fileName: file.name, format: 'xlsx', rows, columns, sizeBytes: file.size });
    }
    if (!out.length) throw new IngestError(`"${file.name}" contains no populated worksheets.`, 'The workbook cannot be used as a reporting source.', 'Check that data starts in cell A1 with a header row.');
    return out;
  }
  throw new IngestError(`Unsupported file format ".${ext}" for "${file.name}".`, 'The file was not ingested.', 'Upload CSV, XLSX/XLS or JSON files.');
}

export function parseCsvText(text: string, fileName: string, size = text.length): ParsedTable {
  const res = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: 'greedy', dynamicTyping: false });
  const fatal = res.errors.filter((e) => e.type === 'Delimiter' || e.code === 'UndetectableDelimiter');
  if (!res.data.length) throw new IngestError(`"${fileName}" has a header but no data rows.`, 'No records can be profiled or reported on.', 'Confirm the export included data rows.');
  if (fatal.length && (res.meta.fields?.length ?? 0) < 2) throw new IngestError(`Could not detect a delimiter in "${fileName}".`, 'Columns could not be separated.', 'Save the file as comma-separated CSV with a header row.');
  const { rows, columns } = normalize(res.data);
  if (!columns.length) throw new IngestError(`"${fileName}" has no column headers.`, 'Fields cannot be identified.', 'Add a header row as the first line.');
  return { name: baseName(fileName), fileName, format: 'csv', rows, columns, sizeBytes: size };
}

export function parseJsonText(text: string, fileName: string, size = text.length): ParsedTable {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new IngestError(`"${fileName}" is not valid JSON (${(e as Error).message}).`, 'The file was not ingested.', 'Validate the JSON and upload an array of records.');
  }
  let arr: unknown = data;
  if (!Array.isArray(arr) && arr && typeof arr === 'object') arr = Object.values(arr as object).find(Array.isArray);
  if (!Array.isArray(arr) || !arr.length || typeof arr[0] !== 'object')
    throw new IngestError(`"${fileName}" does not contain an array of records.`, 'Rows and columns cannot be identified.', 'Provide JSON as [{...}, {...}] or {"data": [{...}]}.');
  const { rows, columns } = normalize(arr as Record<string, unknown>[]);
  return { name: baseName(fileName), fileName, format: 'json', rows, columns, sizeBytes: size };
}
