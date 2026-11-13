import { useMemo, useSyncExternalStore } from 'react';
import type { Project } from '@/types';
import { Engine } from '@/lib/engine';
import { getRows, subscribeRows } from '@/lib/rowStore';

let rowsVersion = 0;
subscribeRows(() => rowsVersion++);
const useRowsVersion = () => useSyncExternalStore(subscribeRows, () => rowsVersion);

const cache = new Map<string, Engine>();

export function engineFor(p: Project): Engine | null {
  if (!p.understanding || !p.foundation) return null;
  const key = `${p.id}|${p.understanding.generatedAt}|${p.foundation.generatedAt}|${JSON.stringify(p.foundation.measures)}|${p.understanding.relationships.map((r) => `${r.fromDataset}.${r.fromField}>${r.toDataset}.${r.toField}:${r.status}`).join()}|${rowsVersion}|${p.datasets.map((d) => getRows(d.id).length).join()}`;
  let e = cache.get(key);
  if (!e) {
    e = new Engine({ profiles: p.understanding.profiles, relationships: p.understanding.relationships, measures: p.foundation.measures, rowsOf: getRows });
    if (cache.size > 12) cache.clear();
    cache.set(key, e);
  }
  return e;
}

export function useEngine(p: Project | undefined) {
  const v = useRowsVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (p ? engineFor(p) : null), [p?.understanding, p?.foundation, p?.datasets, v]);
}

export { useRowsVersion };
