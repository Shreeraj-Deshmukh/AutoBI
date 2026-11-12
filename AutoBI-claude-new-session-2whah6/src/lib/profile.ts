import type { ColumnProfile, ColumnRole, ColumnType, DatasetKind, DatasetMeta, DatasetProfile, DQIssue, Relationship, Row } from '@/types';
import { parseDate, toIsoDate } from './dates';
import { humanize, normalizeToken, uid } from './util';

const ID_RE = /(^id$|_id$|id$|_key$|_code$|^key$)/i;
const STATUS_RE = /(status|flag|opened|delivered|clicked|active|outcome|result)/i;

export function profileColumns(rows: Row[], columns: string[]): ColumnProfile[] {
  const n = rows.length;
  return columns.map((name) => {
    const values = rows.map((r) => r[name]);
    const nonNull = values.filter((v) => v != null && v !== '');
    const missing = n - nonNull.length;
    const counts = new Map<string, number>();
    for (const v of nonNull) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
    const distinct = counts.size;

    // type inference by majority vote
    let nums = 0;
    let ints = 0;
    let dates = 0;
    let bools = 0;
    const fmts = new Map<string, number>();
    for (const v of nonNull) {
      if (typeof v === 'number') {
        nums++;
        if (Number.isInteger(v)) ints++;
      } else if (typeof v === 'boolean') bools++;
      else {
        const d = parseDate(v);
        if (d) {
          dates++;
          fmts.set(d.format, (fmts.get(d.format) ?? 0) + 1);
        } else if (/^(true|false|yes|no|y|n)$/i.test(String(v))) bools++;
      }
    }
    const m = nonNull.length || 1;
    let type: ColumnType = 'string';
    let valid = nonNull.length;
    if (nums / m >= 0.9) {
      type = ints === nums ? 'integer' : 'number';
      valid = nums;
    } else if (dates / m >= 0.9) {
      type = 'date';
      valid = dates;
    } else if (bools / m >= 0.95 && distinct <= 2) {
      type = 'boolean';
      valid = bools;
    }
    const invalid = type === 'string' ? 0 : nonNull.length - valid;

    const p: ColumnProfile = {
      name,
      type,
      role: 'attribute',
      missing,
      missingPct: n ? (missing / n) * 100 : 0,
      distinct,
      uniquePct: nonNull.length ? (distinct / nonNull.length) * 100 : 0,
      invalid,
      topValues: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([value, count]) => ({ value, count })),
      businessDefinition: '',
    };
    if (type === 'integer' || type === 'number') {
      const ns = nonNull.filter((v): v is number => typeof v === 'number');
      p.min = Math.min(...ns);
      p.max = Math.max(...ns);
      p.mean = ns.reduce((s, x) => s + x, 0) / (ns.length || 1);
    }
    if (type === 'date') {
      const ts = nonNull.map((v) => parseDate(v)?.t).filter((t): t is number => t != null);
      p.dateMin = toIsoDate(Math.min(...ts));
      p.dateMax = toIsoDate(Math.max(...ts));
      p.dateFormats = [...fmts.keys()];
    }
    p.role = inferRole(p, n);
    return p;
  });
}

function inferRole(p: ColumnProfile, n: number): ColumnRole {
  if (p.type === 'date') return 'date';
  if (ID_RE.test(p.name) && (p.type !== 'number' || p.uniquePct > 50)) return p.uniquePct >= 99 && p.missing === 0 ? 'identifier' : 'foreign_key';
  if (p.type === 'boolean') return 'status';
  if (p.type === 'integer' || p.type === 'number') {
    if (p.distinct <= 12 && n > 50 && p.type === 'integer' && !/(amount|count|qty|quantity|value|revenue|sales|units|score|cost|price|trx|nrx|nbrx|rx$|scripts?|samples?|dropped|volume|patients|visits|minutes|hours|spend)/i.test(p.name)) return 'dimension';
    return 'measure';
  }
  if (p.distinct <= 6 && STATUS_RE.test(p.name)) return 'status';
  if (p.distinct <= Math.max(60, n * 0.05) && p.uniquePct < 60) return 'dimension';
  return 'attribute';
}

function entityFromKey(key: string) {
  return humanize(key.replace(/(_?id|_?key|_?code)$/i, '')) || 'Record';
}

export function profileDataset(meta: DatasetMeta, rows: Row[]): DatasetProfile {
  const columns = profileColumns(rows, meta.columns);
  const seen = new Set<string>();
  let dup = 0;
  for (const r of rows) {
    const k = JSON.stringify(meta.columns.map((c) => r[c]));
    if (seen.has(k)) dup++;
    else seen.add(k);
  }
  // primary key: prefer an identifier column whose name matches the file, else first identifier
  const ids = columns.filter((c) => c.role === 'identifier');
  const fileTok = normalizeToken(meta.fileName);
  const pk = ids.find((c) => fileTok.includes(normalizeToken(c.name.replace(/_?id$/i, '')))) ?? ids[0];
  // Columns that are ID-like and unique but not the PK are probably foreign keys in a 1:1 relationship – keep as identifier.
  const dateCols = columns.filter((c) => c.role === 'date');
  const entity = pk ? entityFromKey(pk.name) : humanize(meta.name);
  return {
    datasetId: meta.id,
    rowCount: rows.length,
    columnCount: meta.columns.length,
    duplicateRows: dup,
    primaryKey: pk?.name,
    entity,
    kind: 'unknown',
    label: humanize(meta.name),
    inference: '',
    confidence: 0.5,
    dateField: dateCols[0]?.name,
    columns,
  };
}

/** Detect many-to-one relationships between datasets by name similarity + value overlap. */
export function detectRelationships(profiles: DatasetProfile[], rowsOf: (id: string) => Row[]): Relationship[] {
  const rels: Relationship[] = [];
  for (const target of profiles) {
    if (!target.primaryKey) continue;
    const keySet = new Set(rowsOf(target.datasetId).map((r) => String(r[target.primaryKey!])));
    const pkTok = normalizeToken(target.primaryKey);
    for (const src of profiles) {
      if (src.datasetId === target.datasetId) continue;
      for (const col of src.columns) {
        if (col.name === src.primaryKey) continue;
        const tok = normalizeToken(col.name);
        const nameMatch = tok === pkTok || (tok.endsWith(pkTok) && pkTok.length > 3);
        if (!nameMatch && !ID_RE.test(col.name)) continue;
        const vals = rowsOf(src.datasetId)
          .map((r) => r[col.name])
          .filter((v) => v != null && v !== '');
        if (!vals.length) continue;
        let hit = 0;
        for (const v of vals) if (keySet.has(String(v))) hit++;
        const matchRate = hit / vals.length;
        if ((nameMatch && matchRate >= 0.3) || matchRate >= 0.8) {
          rels.push({
            id: uid('rel'),
            fromDataset: src.datasetId,
            fromField: col.name,
            toDataset: target.datasetId,
            toField: target.primaryKey,
            matchRate,
            unmatched: vals.length - hit,
            confidence: Math.min(0.99, (nameMatch ? 0.5 : 0.2) + matchRate * 0.49),
            status: 'suggested',
          });
          if (col.role !== 'identifier') col.role = 'foreign_key';
        }
      }
    }
  }
  return rels;
}

/** Infer what each dataset represents (master vs activity) once relationships are known. */
export function classifyDatasets(profiles: DatasetProfile[], rels: Relationship[]) {
  for (const p of profiles) {
    const outgoing = rels.filter((r) => r.fromDataset === p.datasetId);
    const incoming = rels.filter((r) => r.toDataset === p.datasetId);
    const hasDate = !!p.dateField;
    const dims = p.columns.filter((c) => c.role === 'dimension' || c.role === 'attribute').map((c) => c.name);
    let kind: DatasetKind = 'unknown';
    const reasons: string[] = [];
    if (outgoing.length && hasDate) {
      kind = 'activity';
      reasons.push(`each row is a dated ${p.entity.toLowerCase()} event (${p.dateField})`, `it references ${outgoing.map((r) => r.fromField).join(', ')} from other datasets`);
    } else if (incoming.length && p.primaryKey) {
      kind = 'master';
      reasons.push(`${p.primaryKey} is unique on every row`, `other datasets reference it (${incoming.length} relationship${incoming.length > 1 ? 's' : ''})`);
      if (dims.length) reasons.push(`it carries descriptive attributes such as ${dims.slice(0, 4).join(', ')}`);
    } else if (hasDate && p.primaryKey) {
      kind = 'activity';
      reasons.push(`each row has a unique ${p.primaryKey} and a date (${p.dateField})`);
    } else if (p.primaryKey) {
      kind = 'reference';
      reasons.push(`${p.primaryKey} is unique and the table has no dated events`);
    }
    p.kind = kind;
    p.label = kind === 'master' ? `${p.entity} Master` : kind === 'activity' ? `${p.entity} Activity` : kind === 'reference' ? `${p.entity} Reference` : p.label;
    p.confidence = kind === 'unknown' ? 0.4 : Math.min(0.97, 0.7 + 0.08 * reasons.length);
    p.inference =
      kind === 'unknown'
        ? 'Could not confidently determine the grain of this dataset: no unique identifier was found. Treat as a flat reference table until clarified.'
        : `Likely a ${kind === 'master' ? 'master / dimension' : kind === 'activity' ? 'transactional activity (fact)' : 'reference'} dataset describing ${p.entity.toLowerCase()} records — ${reasons.join('; ')}.`;
    for (const c of p.columns) c.businessDefinition = defineColumn(c, p);
  }
}

function defineColumn(c: ColumnProfile, p: DatasetProfile): string {
  const nice = humanize(c.name);
  if (c.name === p.primaryKey) return `Unique identifier of each ${p.entity.toLowerCase()} record (primary key).`;
  switch (c.role) {
    case 'foreign_key':
      return `Reference to the related ${humanize(c.name.replace(/_?id$/i, '')).toLowerCase()} record (join key).`;
    case 'date':
      return `Date on which the ${p.entity.toLowerCase()} ${p.kind === 'activity' ? 'event occurred' : 'attribute applies'} (${c.dateMin} → ${c.dateMax}).`;
    case 'status':
      return `Status flag for the ${p.entity.toLowerCase()}; values: ${c.topValues.map((v) => v.value).join(', ')}.`;
    case 'dimension':
      return `Categorical attribute "${nice}" used to slice reporting (${c.distinct} distinct values).`;
    case 'measure':
      return `Numeric value "${nice}" that can be aggregated (range ${c.min}–${c.max}).`;
    case 'identifier':
      return `Identifier "${nice}".`;
    default:
      return `Descriptive attribute "${nice}" (${c.distinct} distinct values).`;
  }
}

export function detectIssues(profiles: DatasetProfile[], rels: Relationship[], labelOf: (id: string) => string): DQIssue[] {
  const issues: DQIssue[] = [];
  for (const p of profiles) {
    if (p.rowCount === 0)
      issues.push({ id: uid('dq'), datasetId: p.datasetId, severity: 'error', type: 'Empty dataset', message: `${p.label} has no rows.`, impact: 'No metrics can be calculated from this dataset.', suggestion: 'Re-upload a populated extract.', count: 0 });
    if (p.duplicateRows > 0)
      issues.push({ id: uid('dq'), datasetId: p.datasetId, severity: 'warning', type: 'Duplicate records', message: `${p.duplicateRows} fully duplicated row(s) found in ${p.label}.`, impact: `Counts based on ${p.label} may be overstated by ${p.duplicateRows}.`, suggestion: 'Confirm with the source owner whether duplicates are valid; otherwise de-duplicate upstream.', count: p.duplicateRows });
    const pkCol = p.columns.find((c) => c.name === p.primaryKey);
    if (pkCol && pkCol.distinct < p.rowCount)
      issues.push({ id: uid('dq'), datasetId: p.datasetId, column: pkCol.name, severity: 'warning', type: 'Duplicate key values', message: `${p.rowCount - pkCol.distinct} ${pkCol.name} value(s) appear more than once in ${p.label}.`, impact: `Counting rows overstates the number of unique ${p.entity.toLowerCase()}s; use a distinct count for ${pkCol.name}.`, suggestion: 'Confirm whether repeated IDs are re-referrals or feed duplicates.', count: p.rowCount - pkCol.distinct });
    if (!p.primaryKey)
      issues.push({ id: uid('dq'), datasetId: p.datasetId, severity: 'warning', type: 'No unique identifier', message: `${p.label} has no column that uniquely identifies each row.`, impact: 'Row-level reconciliation and joins are less reliable.', suggestion: 'Provide a unique record ID column.', count: 0 });
    for (const c of p.columns) {
      if (c.missing > 0) {
        const key = c.role === 'identifier' || c.role === 'foreign_key' || c.role === 'date';
        issues.push({ id: uid('dq'), datasetId: p.datasetId, column: c.name, severity: key ? 'warning' : 'info', type: 'Missing values', message: `${c.missing} missing value(s) in ${p.label}.${c.name} (${c.missingPct.toFixed(1)}%).`, impact: key ? 'Affected rows cannot be joined or placed on the timeline.' : `Rows will appear as "(Blank)" when sliced by ${humanize(c.name)}.`, suggestion: 'Populate the field at source or confirm a default value.', count: c.missing });
      }
      if (c.invalid > 0)
        issues.push({ id: uid('dq'), datasetId: p.datasetId, column: c.name, severity: 'warning', type: 'Invalid data type', message: `${c.invalid} value(s) in ${p.label}.${c.name} do not match the inferred ${c.type} type.`, impact: 'These values are excluded from calculations that rely on this field.', suggestion: 'Correct the values or confirm the intended data type.', count: c.invalid });
      if (c.dateFormats && c.dateFormats.length > 1)
        issues.push({ id: uid('dq'), datasetId: p.datasetId, column: c.name, severity: 'warning', type: 'Inconsistent date formats', message: `${p.label}.${c.name} mixes formats: ${c.dateFormats.join(', ')}.`, impact: 'Ambiguous dates (e.g. 03/04) may be placed in the wrong period.', suggestion: 'Standardise dates to ISO (YYYY-MM-DD) at source.', count: 0 });
      if (c.role === 'measure' && c.min != null && c.min < 0)
        issues.push({ id: uid('dq'), datasetId: p.datasetId, column: c.name, severity: 'info', type: 'Negative values', message: `${p.label}.${c.name} contains negative values (min ${c.min}).`, impact: 'Sums may net off; confirm whether these represent reversals.', suggestion: 'Confirm business meaning of negative values.', count: 0 });
    }
  }
  for (const r of rels) {
    if (r.unmatched > 0)
      issues.push({ id: uid('dq'), datasetId: r.fromDataset, column: r.fromField, severity: 'warning', type: 'Unmatched join keys', message: `${r.unmatched} record(s) in ${labelOf(r.fromDataset)} have a ${r.fromField} that does not exist in ${labelOf(r.toDataset)} (match rate ${(r.matchRate * 100).toFixed(1)}%).`, impact: `These records are counted in totals but appear as "(Unmatched)" when sliced by ${labelOf(r.toDataset)} attributes.`, suggestion: `Add the missing ${r.toField} values to ${labelOf(r.toDataset)} or correct the references at source.`, count: r.unmatched });
  }
  return issues;
}
