/**
 * Naming, quoting and id helpers shared by the Power BI (PBIP) export.
 *
 * Power BI is strict about names: table, column and measure names must be unique
 * (case-insensitively), TMDL needs single-quoted names, DAX needs ']' escaped and
 * report folders/visual names must be short [A-Za-z0-9_-] ids.
 */

/** Characters kept in table / column / measure names; anything else becomes a space. */
export function cleanName(s: string, fallback = 'Field'): string {
  const out = s
    .replace(/[^\p{L}\p{N} _\-()%#&/+,.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  return (out || fallback).slice(0, 100);
}

/** Reserves names case-insensitively, suffixing duplicates (" 2", " 3"…). */
export class NameRegistry {
  private used = new Set<string>();
  constructor(reserved: Iterable<string> = []) {
    for (const r of reserved) this.used.add(r.toLowerCase());
  }
  has(name: string) {
    return this.used.has(name.toLowerCase());
  }
  /** Mark a name as used without renaming it (it may already be used elsewhere). */
  reserve(name: string) {
    this.used.add(name.toLowerCase());
  }
  /** Reserve `name`; on a clash try `name + suffix`, then numbered variants. */
  take(name: string, suffix = ''): string {
    const candidates = [name, ...(suffix ? [`${name}${suffix}`] : [])];
    let candidate = candidates.find((c) => !this.has(c));
    for (let n = 2; !candidate; n++) if (!this.has(`${name} ${n}`)) candidate = `${name} ${n}`;
    this.used.add(candidate.toLowerCase());
    return candidate;
  }
}

/** TMDL object name: always single-quoted, embedded quotes doubled. */
export const tmdlName = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** DAX table reference. */
export const daxTable = (t: string) => `'${t.replace(/'/g, "''")}'`;
/** DAX column reference. */
export const daxCol = (t: string, c: string) => `${daxTable(t)}[${c.replace(/]/g, ']]')}]`;
/** DAX measure reference. */
export const daxMeasure = (m: string) => `[${m.replace(/]/g, ']]')}]`;
/** DAX string literal. */
export const daxString = (s: string) => `"${s.replace(/"/g, '""')}"`;
/** Power Query (M) text literal. */
export const mString = (s: string) => `"${s.replace(/"/g, '""')}"`;
/** Literal for a report (PBIR) expression: strings are single-quoted. */
export const pbirString = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Deterministic 32-bit hash (FNV-1a) — keeps ids stable when the same project is exported twice. */
function fnv(s: string, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const hex8 = (n: number) => n.toString(16).padStart(8, '0');

/** Stable GUID derived from a key (used for lineage tags, relationship names and logical ids). */
export function guid(key: string): string {
  const h = [fnv(key), fnv(key, 0x9e3779b9), fnv(key, 0x85ebca6b), fnv(key, 0xc2b2ae35)].map(hex8).join('');
  // RFC 4122 layout with version 4 / variant bits so tools accept it as a GUID
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * 12-character hex id for page and visual folder names. (Desktop writes 20, but every
 * character counts against Windows' 260-character path limit: Desktop reports files
 * beyond it as "not found".)
 */
export const shortId = (key: string) => guid(key).replace(/-/g, '').slice(0, 12);

/** File-system friendly project name (used for the .pbip, folders and the zip). */
export const fileSafe = (s: string) => s.replace(/[^\w\- ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/ /g, '_').slice(0, 60) || 'Celestra_Dashboard';

/** Short name for the .Report / .SemanticModel folders (keeps the deepest file path well under 260 characters). */
export const folderSafe = (s: string) => fileSafe(s).slice(0, 20).replace(/[_-]+$/, '') || 'Celestra';
