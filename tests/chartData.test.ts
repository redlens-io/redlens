import { describe, expect, it } from 'vitest';
import { numericColumns, suggestChartSpec, buildChartModel, MAX_CHART_POINTS, type ChartColumn } from '../src/grid/chartData';

const COLS: ChartColumn[] = [
  { name: 'eventname', typeName: 'varchar' },
  { name: 'tickets', typeName: 'int4' },
  { name: 'total', typeName: 'numeric' },
];
const ROWS: unknown[][] = [
  ['Concert A', 10, 250.5],
  ['Concert B', 20, 480],
  ['Concert A', 5, 100],
];

describe('numericColumns', () => {
  it('detects numeric columns by type and by sampling', () => {
    expect(numericColumns(COLS, ROWS)).toEqual([1, 2]);
  });
  it('treats numeric strings as numeric', () => {
    const cols: ChartColumn[] = [{ name: 'k', typeName: 'varchar' }, { name: 'v', typeName: 'varchar' }];
    expect(numericColumns(cols, [['a', '1'], ['b', '2']])).toEqual([1]);
  });

  it('does not treat interval/timestamp as numeric via substring (anchored type match)', () => {
    // 'interval' contains 'int' but must NOT be numeric; sampled values are non-numeric.
    const cols: ChartColumn[] = [{ name: 'd', typeName: 'interval' }, { name: 't', typeName: 'timestamp' }];
    expect(numericColumns(cols, [['1 day 02:03:04', '2026-01-01 10:00:00']])).toEqual([]);
  });
});

describe('suggestChartSpec', () => {
  it('picks the first non-numeric column as label and numerics as series', () => {
    expect(suggestChartSpec(COLS, ROWS)).toEqual({ type: 'bar', labelColumn: 0, valueColumns: [1, 2] });
  });
  it('returns undefined when nothing is numeric', () => {
    expect(suggestChartSpec([{ name: 'a', typeName: 'varchar' }], [['x']])).toBeUndefined();
  });

  it('when all columns are numeric, uses column 0 as label and excludes it from values', () => {
    const cols: ChartColumn[] = [{ name: 'id', typeName: 'int4' }, { name: 'amount', typeName: 'numeric' }];
    expect(suggestChartSpec(cols, [[1, 10], [2, 20]])).toEqual({ type: 'bar', labelColumn: 0, valueColumns: [1] });
  });
});

describe('buildChartModel', () => {
  it('builds bar/line series aligned to labels', () => {
    const m = buildChartModel(COLS, ROWS, { type: 'bar', labelColumn: 0, valueColumns: [1, 2] });
    expect(m.labels).toEqual(['Concert A', 'Concert B', 'Concert A']);
    expect(m.series).toEqual([
      { name: 'tickets', values: [10, 20, 5] },
      { name: 'total', values: [250.5, 480, 100] },
    ]);
    expect(m.omitted).toBe(0);
  });

  it('aggregates by label for pie and sorts by size', () => {
    // Concert A = 10 + 5 = 15, Concert B = 20 → B first (sorted desc).
    const m = buildChartModel(COLS, ROWS, { type: 'pie', labelColumn: 0, valueColumns: [1] });
    expect(m.labels).toEqual(['Concert B', 'Concert A']);
    expect(m.series[0]!.values).toEqual([20, 15]);
  });

  it('caps points and reports how many were omitted', () => {
    const many = Array.from({ length: MAX_CHART_POINTS + 10 }, (_, i) => [`r${i}`, i]);
    const m = buildChartModel([{ name: 'k', typeName: 'varchar' }, { name: 'v', typeName: 'int4' }], many, {
      type: 'line', labelColumn: 0, valueColumns: [1],
    });
    expect(m.labels).toHaveLength(MAX_CHART_POINTS);
    expect(m.omitted).toBe(10);
  });

  it('coerces non-numeric cells to 0 and null labels to a placeholder', () => {
    const m = buildChartModel(COLS, [[null, 'x', 5]], { type: 'bar', labelColumn: 0, valueColumns: [1, 2] });
    expect(m.labels).toEqual(['∅']);
    expect(m.series[0]!.values).toEqual([0]); // 'x' → 0
    expect(m.series[1]!.values).toEqual([5]);
  });
});
