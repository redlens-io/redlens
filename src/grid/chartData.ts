/**
 * Chart data prep (M5 `result-charts`): turns a result set + a chart spec into
 * a render-ready model. Pure/testable; the webview draws it as inline SVG
 * (CSP-safe, no external chart library). Bar/line share the same series shape;
 * pie aggregates the first value column by label.
 */
export type ChartType = 'bar' | 'line' | 'pie';

export interface ChartColumn {
  name: string;
  typeName: string;
}

export interface ChartSpec {
  type: ChartType;
  /** Column index used for x-axis labels / pie slices. */
  labelColumn: number;
  /** Column indices plotted as series (must be numeric). */
  valueColumns: number[];
}

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartModel {
  type: ChartType;
  labels: string[];
  series: ChartSeries[];
  /** Rows beyond this were dropped for readability (0 = none). */
  omitted: number;
}

/** Hard cap so a huge result doesn't produce an unreadable/huge chart. */
export const MAX_CHART_POINTS = 50;

// Exact type names (anchored) so substrings like "interval"/"point" are NOT
// treated as numeric — anything not listed still falls through to value sampling.
const NUMERIC_TYPE = /^(int2|int4|int8|integer|smallint|bigint|numeric|decimal|real|double precision|float4|float8|money|serial|bigserial|smallserial)$/i;

export function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Indices of columns that are numeric (by type name, or by sampling values). */
export function numericColumns(columns: ChartColumn[], rows: unknown[][]): number[] {
  const sample = rows.slice(0, 25);
  const out: number[] = [];
  columns.forEach((col, i) => {
    if (NUMERIC_TYPE.test(col.typeName)) {
      out.push(i);
      return;
    }
    const vals = sample.map((r) => r[i]).filter((v) => v !== null && v !== undefined);
    if (vals.length > 0 && vals.every((v) => toNumber(v) !== undefined)) {
      out.push(i);
    }
  });
  return out;
}

/**
 * A sensible default chart for a result: the first non-numeric column as the
 * label and up to 3 numeric columns as bar series. Returns undefined when there
 * is nothing numeric to plot.
 */
export function suggestChartSpec(columns: ChartColumn[], rows: unknown[][]): ChartSpec | undefined {
  const numeric = numericColumns(columns, rows);
  if (numeric.length === 0) {
    return undefined;
  }
  const numericSet = new Set(numeric);
  const firstText = columns.findIndex((_, i) => !numericSet.has(i));
  // When every column is numeric, use column 0 as the label axis and exclude
  // it from the value series (don't plot the label column against itself).
  const labelColumn = firstText >= 0 ? firstText : 0;
  const values = numeric.filter((i) => i !== labelColumn).slice(0, 3);
  return {
    type: 'bar',
    labelColumn,
    valueColumns: values.length > 0 ? values : numeric.slice(0, 3),
  };
}

function labelText(value: unknown): string {
  if (value === null || value === undefined) {
    return '∅';
  }
  return String(value);
}

/** Build the render model for a chart spec (pie aggregates by label). */
export function buildChartModel(columns: ChartColumn[], rows: unknown[][], spec: ChartSpec): ChartModel {
  const capped = rows.slice(0, MAX_CHART_POINTS);
  const omitted = rows.length - capped.length;

  if (spec.type === 'pie') {
    const valueCol = spec.valueColumns[0];
    const totals = new Map<string, number>();
    if (valueCol !== undefined) {
      for (const row of rows) {
        const label = labelText(row[spec.labelColumn]);
        const n = toNumber(row[valueCol]) ?? 0;
        totals.set(label, (totals.get(label) ?? 0) + n);
      }
    }
    const entries = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_CHART_POINTS);
    const pieOmitted = totals.size - entries.length;
    return {
      type: 'pie',
      labels: entries.map((e) => e[0]),
      series: [{ name: columns[valueCol ?? 0]?.name ?? 'value', values: entries.map((e) => e[1]) }],
      omitted: pieOmitted > 0 ? pieOmitted : 0,
    };
  }

  const labels = capped.map((row) => labelText(row[spec.labelColumn]));
  const series: ChartSeries[] = spec.valueColumns.map((c) => ({
    name: columns[c]?.name ?? `col ${c}`,
    values: capped.map((row) => toNumber(row[c]) ?? 0),
  }));
  return { type: spec.type, labels, series, omitted: omitted > 0 ? omitted : 0 };
}
