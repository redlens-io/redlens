import { describe, expect, it } from 'vitest';
import { SavedQueries } from '../src/query/savedQueries';
import { extractParams, substituteParams } from '../src/language/parameters';
import type { MementoLike } from '../src/query/history';

function fakeMemento(): MementoLike {
  const store = new Map<string, unknown>();
  return {
    get: <T>(k: string, d: T) => (store.has(k) ? (store.get(k) as T) : d),
    update: (k, v) => { store.set(k, v); return Promise.resolve(); },
  };
}

describe('SavedQueries', () => {
  it('saves, upserts by name, lists sorted, removes', async () => {
    const s = new SavedQueries(fakeMemento());
    await s.save('b-query', 'SELECT 2', '2026-07-23T00:00:00Z');
    await s.save('a-query', 'SELECT 1', '2026-07-23T00:00:00Z');
    await s.save('a-query', 'SELECT 1 v2', '2026-07-23T00:01:00Z'); // upsert
    expect(s.list().map((q) => q.name)).toEqual(['a-query', 'b-query']);
    expect(s.list()[0]?.sql).toBe('SELECT 1 v2');
    await s.remove('a-query');
    expect(s.list().map((q) => q.name)).toEqual(['b-query']);
  });
});

describe('extractParams', () => {
  it('finds :name params, unique, in order', () => {
    expect(extractParams('SELECT * FROM t WHERE a = :a AND b = :b AND c = :a')).toEqual(['a', 'b']);
  });

  it('ignores ::type casts and params inside literals', () => {
    expect(extractParams("SELECT id::int FROM t WHERE note = ':notaparam' AND x = :real")).toEqual(['real']);
  });

  it('returns empty when there are no params', () => {
    expect(extractParams('SELECT 1')).toEqual([]);
  });
});

describe('substituteParams', () => {
  it('substitutes numbers raw and strings quoted', () => {
    const out = substituteParams('SELECT * FROM t WHERE id = :id AND name = :name', { id: '42', name: "O'Brien" });
    expect(out).toContain('id = 42');
    expect(out).toContain("name = 'O''Brien'");
  });

  it('leaves ::type casts alone', () => {
    expect(substituteParams('SELECT x::int, :v', { v: '1' })).toContain('x::int');
  });

  it('quotes leading-zero all-digit values instead of dropping the zeros (UXD-042)', () => {
    expect(substituteParams('WHERE zip = :z', { z: '01234' })).toContain("zip = '01234'");
    expect(substituteParams('WHERE n = :n', { n: '0' })).toContain('n = 0'); // lone 0 still raw
  });
});
