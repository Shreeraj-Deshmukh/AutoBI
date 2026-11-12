import { get, set, del } from 'idb-keyval';
import type { Row } from '@/types';
import { generateSampleData } from './sampleData';

/**
 * Dataset rows live outside the (localStorage-persisted) project state, because
 * they can be large. Uploaded rows are persisted to IndexedDB; synthetic sample
 * rows are regenerated deterministically on demand.
 */
const mem = new Map<string, Row[]>();
const listeners = new Set<() => void>();
let version = 0;
/** Increments whenever any dataset's rows are replaced — used to invalidate derived caches. */
export const rowsVersion = () => version;

export const SAMPLE_PREFIX = 'sample:';

function sampleRows(id: string): Row[] | undefined {
  const key = id.split(':')[1] as keyof ReturnType<typeof generateSampleData>;
  return generateSampleData()[key];
}

export function getRows(id: string): Row[] {
  if (mem.has(id)) return mem.get(id)!;
  if (id.startsWith(SAMPLE_PREFIX)) {
    const rows = sampleRows(id) ?? [];
    mem.set(id, rows);
    return rows;
  }
  return [];
}

export function hasRows(id: string) {
  return mem.has(id) || id.startsWith(SAMPLE_PREFIX);
}

export async function putRows(id: string, rows: Row[]) {
  mem.set(id, rows);
  version++;
  if (!id.startsWith(SAMPLE_PREFIX)) {
    try {
      await set(`rows:${id}`, rows);
    } catch {
      /* IndexedDB unavailable – rows remain in memory for this session */
    }
  }
  listeners.forEach((l) => l());
}

export async function deleteRows(id: string) {
  mem.delete(id);
  try {
    await del(`rows:${id}`);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/** Load persisted rows for the given dataset ids (called on project open). */
export async function loadRows(ids: string[]) {
  let changed = false;
  for (const id of ids) {
    if (hasRows(id)) continue;
    try {
      const rows = (await get(`rows:${id}`)) as Row[] | undefined;
      if (rows) {
        mem.set(id, rows);
        changed = true;
      }
    } catch {
      /* ignore */
    }
  }
  if (changed) listeners.forEach((l) => l());
}

export function subscribeRows(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
