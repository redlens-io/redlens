import { describe, expect, it } from 'vitest';
import { HISTORY_LIMIT, QueryHistory, type HistoryEntry, type MementoLike } from '../src/query/history';

function fakeMemento(): MementoLike {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string, def: T) => (store.has(key) ? (store.get(key) as T) : def),
    update: (key, value) => {
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

function entry(sql: string): HistoryEntry {
  return { sql, connectionName: 'test', rowCount: 1, durationMs: 5, at: '2026-07-22T12:00:00Z' };
}

describe('QueryHistory', () => {
  it('stores newest first and deduplicates by SQL', async () => {
    const h = new QueryHistory(fakeMemento());
    await h.add(entry('SELECT 1'));
    await h.add(entry('SELECT 2'));
    await h.add(entry('SELECT 1'));
    expect(h.list().map((e) => e.sql)).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('caps at the history limit', async () => {
    const h = new QueryHistory(fakeMemento());
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      await h.add(entry(`SELECT ${i}`));
    }
    expect(h.list()).toHaveLength(HISTORY_LIMIT);
    expect(h.list()[0]?.sql).toBe(`SELECT ${HISTORY_LIMIT + 19}`);
  });

  it('clears', async () => {
    const h = new QueryHistory(fakeMemento());
    await h.add(entry('SELECT 1'));
    await h.clear();
    expect(h.list()).toEqual([]);
  });
});
