/**
 * Product feature switches. Turning a feature off hides it from the app, tests
 * and generated documents; its implementation stays in place.
 */
export const FEATURES = {
  /** Per-user row-level security (e.g. FRMs see only their territory) with "View as". */
  rowLevelSecurity: false,
  /** "Dataset library" dropdown in the Data step that loads a sample kit's files (off: sample files are uploaded manually). */
  datasetLibrary: true,
  /** Sample kits offered in the app (New project, Dataset library, Projects page downloads): access | brand | hcp | retail. */
  sampleKits: ['access'] as string[],
  /**
   * Demo storyline: filters the FRM report starts WITHOUT, for the presenter to add with the design
   * assistant ("Add a payer filter", "Add a time period filter"). Once added back, the dashboard and the
   * Power BI export are exactly the full FRM report. 'period' = Time Period + Custom Date; others name a
   * filter of the FRM template ('payer', 'pbm', 'market', 'product', 'account', 'sales territory', 'region', 'frm territory').
   * Empty list: the FRM report starts with every filter.
   */
  frmHeldBackFilters: ['period', 'payer'] as string[],
};
