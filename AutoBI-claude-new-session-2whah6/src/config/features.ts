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
};
