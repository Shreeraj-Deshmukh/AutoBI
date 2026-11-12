import { strToU8, zipSync } from 'fflate';
import type { DashboardSpec, Project } from '@/types';
import { toIsoDate } from '@/lib/dates';
import { download } from '@/lib/util';
import { getRows } from '@/lib/rowStore';
import { engineFor } from '@/store/engineCache';
import { buildModel, type ExportInput, type PbiModel } from './model';
import { semanticModelFiles } from './tmdl';
import { buildReport, SCHEMA, THEME_VERSION } from './report';
import { BASE_THEME_NAME, CUSTOM_THEME_FILE, baseTheme, celestraTheme } from './theme';
import { fileSafe, folderSafe, guid } from './names';

/**
 * Power BI export: turns a Celestra project into a Power BI Project (PBIP) —
 * a report folder (PBIR) and a semantic model folder (TMDL) with the data embedded —
 * which Power BI Desktop opens directly (File → Open → <name>.pbip, then Refresh).
 */

export interface PowerBiExport {
  /** Project folder / file name. */
  name: string;
  /** Files keyed by path inside the project folder. */
  files: Record<string, string>;
  warnings: string[];
  model: PbiModel;
  summary: { tables: number; measures: number; relationships: number; pages: number; visuals: number };
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const platform = (type: 'Report' | 'SemanticModel', displayName: string) => ({
  $schema: 'https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json',
  metadata: { type, displayName },
  config: { version: '2.0', logicalId: guid(`${type}:${displayName}`) },
});

export function buildPowerBiProject(input: ExportInput & { spec: DashboardSpec }): PowerBiExport {
  const name = fileSafe(input.name);
  const model = buildModel(input);
  const report = buildReport(model, input.spec, input.foundation);
  const short = folderSafe(input.name);
  const R = `${short}.Report`;
  const S = `${short}.SemanticModel`;
  const files: Record<string, string> = {};

  files[`${name}.pbip`] = json({
    $schema: 'https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json',
    version: '1.0',
    artifacts: [{ report: { path: R } }],
    settings: { enableAutoRecovery: true },
  });

  // ── report
  files[`${R}/.platform`] = json(platform('Report', input.name));
  files[`${R}/definition.pbir`] = json({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json', version: '4.0', datasetReference: { byPath: { path: `../${S}` } } });
  files[`${R}/definition/version.json`] = json({ $schema: SCHEMA.version, version: '2.0.0' });
  files[`${R}/definition/report.json`] = json({
    $schema: SCHEMA.report,
    themeCollection: {
      baseTheme: { name: BASE_THEME_NAME, reportVersionAtImport: THEME_VERSION, type: 'SharedResources' },
      customTheme: { name: CUSTOM_THEME_FILE, reportVersionAtImport: THEME_VERSION, type: 'RegisteredResources' },
    },
    resourcePackages: [
      { name: 'SharedResources', type: 'SharedResources', items: [{ name: BASE_THEME_NAME, path: `BaseThemes/${BASE_THEME_NAME}.json`, type: 'BaseTheme' }] },
      { name: 'RegisteredResources', type: 'RegisteredResources', items: [{ name: CUSTOM_THEME_FILE, path: CUSTOM_THEME_FILE, type: 'CustomTheme' }] },
    ],
    settings: { useStylableVisualContainerHeader: true, defaultDrillFilterOtherVisuals: true, allowChangeFilterTypes: true, useEnhancedTooltips: true, useDefaultAggregateDisplayName: true },
  });
  for (const [path, content] of Object.entries(report.files)) files[`${R}/definition/${path}`] = json(content);
  files[`${R}/StaticResources/SharedResources/BaseThemes/${BASE_THEME_NAME}.json`] = json(baseTheme);
  files[`${R}/StaticResources/RegisteredResources/${CUSTOM_THEME_FILE}`] = json(celestraTheme);

  // ── semantic model
  files[`${S}/.platform`] = json(platform('SemanticModel', input.name));
  files[`${S}/definition.pbism`] = json({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json', version: '4.0', settings: {} });
  for (const [path, content] of Object.entries(semanticModelFiles(model, input.name))) files[`${S}/${path}`] = content;

  const warnings = [...model.warnings, ...report.warnings];
  const summary = {
    tables: model.tables.length,
    measures: model.tables.reduce((s, t) => s + t.measures.length, 0),
    relationships: model.relationships.length,
    pages: input.spec.pages.length,
    visuals: Object.keys(report.files).filter((p) => p.endsWith('visual.json')).length,
  };
  files['README.txt'] = readme(name, input, summary, warnings);
  return { name, files, warnings, model, summary };
}

function readme(name: string, input: ExportInput, s: PowerBiExport['summary'], warnings: string[]) {
  return [
    `${input.name} — Power BI project exported from Celestra`,
    `Data as of ${toIsoDate(input.anchor)} (latest activity date). Exported ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
    '',
    'HOW TO OPEN',
    '1. Unzip (keep the files together), e.g. into Downloads or Documents. Avoid deeply nested folders:',
    '   Windows limits file paths to 260 characters and Power BI reports longer ones as "not found".',
    `2. Double-click ${name}.pbip — or in Power BI Desktop: File > Open > ${name}.pbip.`,
    '3. Click Home > Refresh once. The data is embedded in the project, so no connection or credentials are needed.',
    '4. Optional: File > Save as > Power BI file (.pbix) to get a single file to share.',
    '',
    'Requires a 2026 release of Power BI Desktop (Power BI Project files are generally available since September 2026).',
    'If Desktop says the format is not supported, turn on File > Options and settings > Options > Preview features >',
    '"Power BI Project (.pbip) save option" and "Store reports using enhanced metadata format (PBIR)", then reopen.',
    '',
    'WHAT IS INSIDE',
    `- ${s.tables} tables, ${s.measures} DAX measures, ${s.relationships} relationships`,
    `- ${s.pages} report pages with ${s.visuals} visuals (titles, sections and slicers included)`,
    '- "Reporting Period" slicer: the Celestra presets (YTD, R13W, …) resolved against the latest activity date. Clear it for all time.',
    '- Each activity table is filtered by its own event date, as in Celestra (Dim_Date relationships are activated inside each measure).',
    '- Measures keep the Celestra names; catalogue KPIs sit in the "KPI Catalogue" display folder.',
    '',
    'DIFFERENCES FROM THE CELESTRA DASHBOARD',
    '- Records with keys missing from a master table show as "(Blank)" instead of "(Unmatched)".',
    '- The case detail pop-up and journey timeline are not exported; use the case list and the drilldown.',
    '- KPI cards show the change against the previous period as a subtitle.',
    ...(warnings.length ? ['', 'EXPORT NOTES', ...warnings.map((w) => `- ${w}`)] : []),
    '',
  ].join('\r\n');
}

/** Builds the export for a project from its built dashboard (or the current design) and the ingested rows. */
export function projectExport(p: Project): PowerBiExport {
  const engine = engineFor(p);
  const spec = p.dashboard?.spec ?? p.design?.spec;
  if (!engine || !p.understanding || !p.foundation || !spec) throw new Error('Build the dashboard before exporting to Power BI.');
  return buildPowerBiProject({
    name: p.info.name || 'Celestra Dashboard',
    profiles: p.understanding.profiles,
    relationships: p.understanding.relationships,
    foundation: p.foundation,
    spec,
    rowsOf: getRows,
    anchor: engine.anchor,
    minDate: engine.minDate,
  });
}

/** Zip of the project files at the zip root ("Extract all" already creates a folder named after the zip). */
export function zipExport(x: PowerBiExport): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(x.files).map(([path, content]) => [path, strToU8(content)])), { level: 6 });
}

/** Longest file path inside the project (Windows rejects full paths over 260 characters). */
export const longestPath = (x: PowerBiExport) => Math.max(...Object.keys(x.files).map((p) => p.length));

export function downloadPowerBi(p: Project): PowerBiExport {
  const x = projectExport(p);
  const zip = zipExport(x);
  download(`${x.name}_PowerBI.zip`, new Blob([zip], { type: 'application/zip' }));
  return x;
}
