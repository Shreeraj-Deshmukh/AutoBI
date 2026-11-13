import type { DashboardSpec, FilterDef, PeriodPreset } from '@/types';
import { uid } from './util';

/** Whether the dashboard has the Time Period filter (preset + Custom Date). */
export const hasPeriodFilter = (spec: Pick<DashboardSpec, 'filters'>) => spec.filters.some((f) => f.type === 'period');

/**
 * Period the dashboard opens on: its default period when it has a Time Period filter, otherwise all time
 * (with no period control the numbers must not be silently limited to a period).
 */
export const activePeriod = (spec: Pick<DashboardSpec, 'filters' | 'defaultPeriod'>): PeriodPreset => (hasPeriodFilter(spec) ? spec.defaultPeriod : 'all');

/** The Time Period filter definition (always the first filter of a dashboard). */
export const periodFilterDef = (): FilterDef => ({ id: uid('flt'), label: 'Reporting Period', type: 'period' });
