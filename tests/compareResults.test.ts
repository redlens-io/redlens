import { describe, expect, it } from 'vitest';
import { compareResults, type ResultSnapshot } from '../src/grid/compareResults';

const cols = [{ name: 'id' }, { name: 'name' }, { name: 'qty' }];

describe('compareResults (keyed by PK)', () => {
  const base: ResultSnapshot = { columns: cols, rows: [[1, 'a', 10], [2, 'b', 20], [3, 'c', 30]] };
  const cur: ResultSnapshot = { columns: cols, rows: [[1, 'a', 10], [2, 'b', 25], [4, 'd', 40]] };

  it('classifies added / removed / changed / unchanged by key column', () => {
    const d = compareResults(base, cur, [0]);
    expect({ a: d.added, r: d.removed, c: d.changed, u: d.unchanged }).toEqual({ a: 1, r: 1, c: 1, u: 1 });
    const changed = d.rows.find((x) => x.kind === 'changed')!;
    expect(changed.row).toEqual([2, 'b', 25]);
    expect(changed.before).toEqual([2, 'b', 20]);
    expect(changed.changedColumns).toEqual([2]); // only qty changed
    expect(d.rows.find((x) => x.kind === 'added')!.row).toEqual([4, 'd', 40]);
    expect(d.rows.find((x) => x.kind === 'removed')!.row).toEqual([3, 'c', 30]);
  });
});

describe('compareResults (no key = full-row)', () => {
  it('a modified row shows as one removed + one added', () => {
    const base: ResultSnapshot = { columns: cols, rows: [[1, 'a', 10], [2, 'b', 20]] };
    const cur: ResultSnapshot = { columns: cols, rows: [[1, 'a', 10], [2, 'b', 99]] };
    const d = compareResults(base, cur);
    expect(d.changed).toBe(0);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.unchanged).toBe(1);
  });

  it('identical results are all unchanged', () => {
    const s: ResultSnapshot = { columns: cols, rows: [[1, 'a', 1]] };
    const d = compareResults(s, { columns: cols, rows: [[1, 'a', 1]] });
    expect(d).toMatchObject({ added: 0, removed: 0, changed: 0, unchanged: 1 });
  });

  it('handles object cells without collapsing (structural key)', () => {
    const c2 = [{ name: 'doc' }];
    const base: ResultSnapshot = { columns: c2, rows: [[{ id: 1 }], [{ id: 2 }]] };
    const cur: ResultSnapshot = { columns: c2, rows: [[{ id: 1 }], [{ id: 3 }]] };
    const d = compareResults(base, cur);
    expect(d.added).toBe(1); // {id:3}
    expect(d.removed).toBe(1); // {id:2}
    expect(d.unchanged).toBe(1); // {id:1}
  });

  it('counts duplicate rows with multiset semantics (a lost duplicate is removed)', () => {
    const c1 = [{ name: 'a' }];
    // baseline has [1] twice, current once → one copy removed.
    expect(compareResults({ columns: c1, rows: [[1], [1]] }, { columns: c1, rows: [[1]] }))
      .toMatchObject({ added: 0, removed: 1, changed: 0, unchanged: 1 });
    // baseline once, current twice → one copy added.
    expect(compareResults({ columns: c1, rows: [[1]] }, { columns: c1, rows: [[1], [1]] }))
      .toMatchObject({ added: 1, removed: 0, changed: 0, unchanged: 1 });
  });

  it('does not collide distinct rows whose cell contents contain a type token', () => {
    const c2 = [{ name: 'x' }, { name: 'y' }];
    const base: ResultSnapshot = { columns: c2, rows: [['a', 'string:b']] };
    const cur: ResultSnapshot = { columns: c2, rows: [['astring:', 'b']] };
    const d = compareResults(base, cur); // full-row
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.unchanged).toBe(0);
  });
});
