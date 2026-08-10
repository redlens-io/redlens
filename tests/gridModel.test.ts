import { describe, expect, it } from 'vitest';
import { applyView, emptyViewState, visibleColumnOrder, cellText } from '../src/grid/gridModel';

const rows: unknown[][] = [
  [3, 'gamma', null],
  [1, 'alpha', 10],
  [2, 'beta', 20],
  [10, 'delta', 5],
];

describe('applyView', () => {
  it('returns identity order with an empty view', () => {
    expect(applyView(rows, emptyViewState())).toEqual([0, 1, 2, 3]);
  });

  it('sorts numerically ascending and descending', () => {
    const asc = applyView(rows, { ...emptyViewState(), sort: { columnIndex: 0, direction: 'asc' } });
    expect(asc.map((i) => rows[i]?.[0])).toEqual([1, 2, 3, 10]);
    const desc = applyView(rows, { ...emptyViewState(), sort: { columnIndex: 0, direction: 'desc' } });
    expect(desc.map((i) => rows[i]?.[0])).toEqual([10, 3, 2, 1]);
  });

  it('sorts text and puts NULL first ascending', () => {
    const asc = applyView(rows, { ...emptyViewState(), sort: { columnIndex: 2, direction: 'asc' } });
    expect(rows[asc[0] ?? 0]?.[2]).toBeNull();
  });

  it('filters by column substring (case-insensitive)', () => {
    const out = applyView(rows, { ...emptyViewState(), filters: [{ columnIndex: 1, text: 'A' }] });
    expect(out.map((i) => rows[i]?.[1]).sort()).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    const beta = applyView(rows, { ...emptyViewState(), filters: [{ columnIndex: 1, text: 'bet' }] });
    expect(beta.map((i) => rows[i]?.[1])).toEqual(['beta']);
  });

  it('global search matches any column incl. numbers', () => {
    const out = applyView(rows, { ...emptyViewState(), search: '10' });
    // matches row [1,'alpha',10] and row [10,'delta',5]
    expect(out.length).toBe(2);
  });

  it('combines filter + search + sort', () => {
    const out = applyView(rows, {
      filters: [{ columnIndex: 0, text: '' }],
      search: 'a',
      hidden: [],
      sort: { columnIndex: 0, direction: 'desc' },
    });
    // all 4 names contain 'a'; desc by col0 (10,3,2,1) → delta,gamma,beta,alpha
    expect(out.map((i) => rows[i]?.[1])).toEqual(['delta', 'gamma', 'beta', 'alpha']);
  });
});

describe('visibleColumnOrder', () => {
  it('honors hidden columns and custom order', () => {
    expect(visibleColumnOrder(3, { ...emptyViewState(), hidden: [1] })).toEqual([0, 2]);
    expect(visibleColumnOrder(3, { ...emptyViewState(), order: [2, 0, 1] })).toEqual([2, 0, 1]);
    expect(visibleColumnOrder(3, { ...emptyViewState(), order: [2, 0, 1], hidden: [0] })).toEqual([2, 1]);
  });
});

describe('cellText', () => {
  it('renders NULL, objects as JSON, primitives as string', () => {
    expect(cellText(null)).toBe('NULL');
    expect(cellText({ a: 1 })).toBe('{"a":1}');
    expect(cellText(42)).toBe('42');
  });
});
