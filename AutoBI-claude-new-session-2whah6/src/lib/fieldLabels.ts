import type { DatasetProfile, FieldRef, Foundation } from '@/types';
import { splitRef } from './engine';

/**
 * Field mapping is the single source of truth for how a source field appears in
 * reporting: its reporting name is the label used on filters, axes, legends,
 * table headers and exports, and unticked ("excluded") fields are not offered
 * for dashboards.
 */
const mapOf = (f: Foundation | null | undefined, ref: FieldRef) => {
  const { datasetId, column } = splitRef(ref);
  return f?.fieldMaps.find((m) => m.sourceDataset === datasetId && m.sourceField === column && m.reportingTable !== 'Dim_Date');
};

export const prettify = (name: string) => name.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();

export function fieldLabel(f: Foundation | null | undefined, ref: FieldRef): string {
  return prettify(mapOf(f, ref)?.reportingField || splitRef(ref).column);
}

export function fieldIncluded(f: Foundation | null | undefined, ref: FieldRef): boolean {
  return mapOf(f, ref)?.included ?? true;
}

/** Profiles with excluded fields removed — what the design tools are allowed to use. */
export function visibleProfiles(profiles: DatasetProfile[], f: Foundation | null | undefined): DatasetProfile[] {
  if (!f) return profiles;
  return profiles.map((p) => ({ ...p, columns: p.columns.filter((c) => fieldIncluded(f, `${p.datasetId}::${c.name}`)) }));
}
