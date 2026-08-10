/**
 * Aggregate panel (M1 `aggregate-panel`): summarize a selection of cell values.
 * Non-numeric values are ignored for numeric stats; count is over non-null.
 */
export interface Aggregates {
  count: number;
  nulls: number;
  numeric: number;
  sum?: number;
  avg?: number;
  min?: number;
  max?: number;
  median?: number;
}

export function aggregate(values: readonly unknown[]): Aggregates {
  let nulls = 0;
  const nums: number[] = [];
  for (const v of values) {
    if (v === null || v === undefined) {
      nulls++;
      continue;
    }
    if (typeof v === 'number') {
      nums.push(v);
    } else if (typeof v !== 'boolean') {
      const n = Number(v);
      if (!Number.isNaN(n) && String(v).trim() !== '') {
        nums.push(n);
      }
    }
  }
  const result: Aggregates = { count: values.length - nulls, nulls, numeric: nums.length };
  if (nums.length > 0) {
    const sum = nums.reduce((a, b) => a + b, 0);
    result.sum = sum;
    result.avg = sum / nums.length;
    result.min = Math.min(...nums);
    result.max = Math.max(...nums);
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    result.median = sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : sorted[mid] ?? 0;
  }
  return result;
}
