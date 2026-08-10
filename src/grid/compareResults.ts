/**
 * Result diff (M5 `result-run-compare`, catalog Part E): compares a pinned
 * baseline result against the current one and classifies rows as added /
 * removed / changed / unchanged. Pure/testable; the webview renders the diff.
 *
 * With key columns (e.g. the table's primary key) rows are matched by key so a
 * modified row shows as `changed`. Without a key, rows are matched by their full
 * value with multiset (count-aware) semantics, so a modified row shows as one
 * `removed` + one `added` and duplicate rows are counted, not swallowed.
 */
export interface ResultSnapshot {
  columns: { name: string }[];
  rows: unknown[][];
}

export type DiffKind = 'added' | 'removed' | 'changed';

export interface RowDiff {
  kind: DiffKind;
  row: unknown[];
  /** Previous values for a `changed` row (the baseline row). */
  before?: unknown[];
  /** Column indices that differ, for a `changed` row. */
  changedColumns?: number[];
}

export interface CompareResult {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  rows: RowDiff[];
  keyColumns: number[];
}

function cellKey(v: unknown): string {
  if (v === null || v === undefined) return '~';
  const s = typeof v === 'object' ? `o:${JSON.stringify(v)}` : `${typeof v}:${String(v)}`;
  // Length-prefix so cell boundaries can't shift (distinct rows never collide).
  return `${s.length}:${s}`;
}

function rowKey(row: unknown[], cols: number[]): string {
  return cols.map((c) => cellKey(row[c])).join('|');
}

function sameCell(a: unknown, b: unknown): boolean {
  return cellKey(a) === cellKey(b);
}

export function compareResults(
  base: ResultSnapshot,
  cur: ResultSnapshot,
  keyColumns?: number[],
): CompareResult {
  const width = Math.min(base.columns.length, cur.columns.length) || cur.columns.length;
  const allCols = Array.from({ length: width }, (_, i) => i);
  const keys = keyColumns !== undefined && keyColumns.length > 0 ? keyColumns : allCols;
  const keyed = keyColumns !== undefined && keyColumns.length > 0;

  // Multiset of baseline rows by key: preserves duplicates so they are counted,
  // not collapsed (the default no-PK path frequently has duplicate rows).
  const baseByKey = new Map<string, { rows: unknown[][]; used: number }>();
  for (const row of base.rows) {
    const k = rowKey(row, keys);
    const e = baseByKey.get(k);
    if (e === undefined) {
      baseByKey.set(k, { rows: [row], used: 0 });
    } else {
      e.rows.push(row);
    }
  }

  const rows: RowDiff[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;

  for (const row of cur.rows) {
    const k = rowKey(row, keys);
    const e = baseByKey.get(k);
    if (e === undefined || e.used >= e.rows.length) {
      added += 1;
      rows.push({ kind: 'added', row });
    } else {
      const prev = e.rows[e.used]!;
      e.used += 1;
      if (keyed) {
        const changedColumns = allCols.filter((c) => !sameCell(row[c], prev[c]));
        if (changedColumns.length > 0) {
          changed += 1;
          rows.push({ kind: 'changed', row, before: prev, changedColumns });
        } else {
          unchanged += 1;
        }
      } else {
        unchanged += 1;
      }
    }
  }

  // Baseline rows never matched by a current row are removed (count-aware).
  for (const e of baseByKey.values()) {
    for (let i = e.used; i < e.rows.length; i++) {
      removed += 1;
      rows.push({ kind: 'removed', row: e.rows[i]! });
    }
  }

  return { added, removed, changed, unchanged, rows, keyColumns: keys };
}
