import type { AccessUser, DataUnderstanding, ReleaseState, Row } from '@/types';
import { ref } from './engine';
import { uid } from './util';

/**
 * Row-level security proposal: find a roster (a master table with a person
 * column such as FRM_Name / Rep_Name) and the territory-like field it owns,
 * then create one user per person restricted to their territory.
 */
export function detectRoster(u: DataUnderstanding) {
  for (const p of u.profiles.filter((x) => x.kind === 'master' || x.kind === 'reference')) {
    const person = p.columns.find((c) => /(frm|rep|manager|owner|user|kam|msl)s?_?name$/i.test(c.name) || /^(frm|rep|owner)$/i.test(c.name));
    const terr = p.columns.find((c) => /territor/i.test(c.name) && /name/i.test(c.name)) ?? p.columns.find((c) => /territor|district|region/i.test(c.name) && c.role !== 'identifier');
    if (person && terr) return { datasetId: p.datasetId, personCol: person.name, territoryCol: terr.name, label: p.label };
  }
  return null;
}

export function proposeRelease(u: DataUnderstanding, rowsOf: (id: string) => Row[]): ReleaseState | null {
  const r = detectRoster(u);
  if (!r) return null;
  const byPerson = new Map<string, Set<string>>();
  for (const row of rowsOf(r.datasetId)) {
    const n = row[r.personCol];
    const t = row[r.territoryCol];
    if (n == null || t == null) continue;
    if (!byPerson.has(String(n))) byPerson.set(String(n), new Set());
    byPerson.get(String(n))!.add(String(t));
  }
  const role = /frm/i.test(r.personCol) ? 'Field Reimbursement Manager' : /rep/i.test(r.personCol) ? 'Sales Representative' : 'Field user';
  const users: AccessUser[] = [{ id: uid('usr'), name: 'Brand & Access Lead', role: 'All data', values: [] }, ...[...byPerson].map(([name, vals]) => ({ id: uid('usr'), name, role, values: [...vals] }))];
  return { securityField: ref(r.datasetId, r.territoryCol), users };
}
