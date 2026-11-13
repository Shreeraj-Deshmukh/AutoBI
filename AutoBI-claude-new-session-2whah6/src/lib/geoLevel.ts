import type { DashComponent, DashboardSpec, FieldRef, Foundation } from '@/types';
import { fieldLabel } from './fieldLabels';

/** Name of a geography level as the selector shows it ("Territory Name" → "Territory"). */
export const geoName = (foundation: Foundation | null | undefined, ref: FieldRef) => fieldLabel(foundation, ref).replace(/ Name$/, '');

/**
 * Geo Level selector: a component whose dimension or series is one of the geography levels follows the selected
 * level, and its title names that level ("Closure Rate by Region (%)" → "Closure Rate by Territory (%)").
 */
export function followGeo(c: DashComponent, spec: DashboardSpec, level: FieldRef, foundation: Foundation | null | undefined): DashComponent {
  const g = spec.geoLevels;
  if (!g) return c;
  const from = [c.dimension, c.series].find((x) => x && g.fields.includes(x) && x !== level);
  if (!from) return c;
  const swap = (x?: FieldRef) => (x && g.fields.includes(x) ? level : x);
  return { ...c, dimension: swap(c.dimension), series: swap(c.series), title: c.title.replace(geoName(foundation, from), geoName(foundation, level)) };
}
