import { describe, expect, it } from 'vitest';
import { transpose, groupRows, columnRange, heatIntensity } from '../src/grid/gridViews';
import type { ChartColumn } from '../src/grid/chartData';

const COLS: ChartColumn[] = [
  { name: 'city', typeName: 'varchar' },
  { name: 'tickets', typeName: 'int4' },
  { name: 'total', typeName: 'numeric' },
];
const ROWS: unknown[][] = [
  ['Austin', 10, 100],
  ['Denver', 20, 250],
  ['Austin', 5, 50],
];

describe('transpose', () => {
  it('turns columns into rows with a leading column-name column', () => {
    const t = transpose(COLS, ROWS);
    expect(t.columns.map((c) => c.name)).toEqual(['column', 'row 1', 'row 2', 'row 3']);
    expect(t.rows[0]).toEqual(['city', 'Austin', 'Denver', 'Austin']);
    expect(t.rows[1]).toEqual(['tickets', 10, 20, 5]);
    expect(t.rows[2]).toEqual(['total', 100, 250, 50]);
  });
  it('caps the number of rows turned into columns', () => {
    const many = Array.from({ length: 100 }, (_, i) => ['x', i]);
    const t = transpose([{ name: 'a', typeName: 'varchar' }, { name: 'b', typeName: 'int4' }], many, 5);
    expect(t.columns).toHaveLength(1 + 5);
    expect(t.rows[1]).toEqual(['b', 0, 1, 2, 3, 4]);
  });
});

describe('groupRows', () => {
  it('groups by a column, counts, and sums numeric columns', () => {
    const g = groupRows(COLS, ROWS, 0);
    expect(g.columns.map((c) => c.name)).toEqual(['city', 'count', 'sum(tickets)', 'sum(total)']);
    // Austin: count 2, tickets 15, total 150; Denver: count 1, 20, 250
    expect(g.rows).toEqual([
      ['Austin', 2, 15, 150],
      ['Denver', 1, 20, 250],
    ]);
  });
  it('does not aggregate the group column itself and preserves first-seen order', () => {
    const g = groupRows(COLS, [['B', 1, 1], ['A', 2, 2]], 0);
    expect(g.rows.map((r) => r[0])).toEqual(['B', 'A']);
    expect(g.columns.some((c) => c.name === 'sum(city)')).toBe(false);
  });

  it('groups object/SUPER values by shape, not by String() (which collapses them)', () => {
    const cols: ChartColumn[] = [{ name: 'doc', typeName: 'super' }, { name: 'amt', typeName: 'int4' }];
    const g = groupRows(cols, [[{ id: 1 }, 10], [{ id: 2 }, 20], [{ id: 1 }, 5]], 0);
    // Two distinct docs → two groups (not one collapsed "[object Object]").
    expect(g.rows).toHaveLength(2);
    expect(g.rows[0]).toEqual([{ id: 1 }, 2, 15]);
    expect(g.rows[1]).toEqual([{ id: 2 }, 1, 20]);
  });

  it('does not collide number 1, string "1", and array [1]', () => {
    const cols: ChartColumn[] = [{ name: 'k', typeName: 'varchar' }, { name: 'v', typeName: 'int4' }];
    const g = groupRows(cols, [[1, 10], ['1', 20], [[1], 30]], 0);
    expect(g.rows).toHaveLength(3);
  });
});

describe('columnRange / heatIntensity', () => {
  it('computes numeric min/max, ignoring non-numeric', () => {
    expect(columnRange([[1], ['x'], [3], [null]], 0)).toEqual({ min: 1, max: 3 });
    expect(columnRange([['a'], [null]], 0)).toBeUndefined();
  });
  it('scales a value into 0..1 within the range', () => {
    const r = { min: 0, max: 10 };
    expect(heatIntensity(0, r)).toBe(0);
    expect(heatIntensity(5, r)).toBe(0.5);
    expect(heatIntensity(10, r)).toBe(1);
    expect(heatIntensity(-5, r)).toBe(0); // clamped
    expect(heatIntensity(50, r)).toBe(1); // clamped
  });
  it('returns 0.5 for a flat range', () => {
    expect(heatIntensity(7, { min: 7, max: 7 })).toBe(0.5);
  });
});
