import { describe, expect, it } from 'vitest';
import {
  emptyEditState,
  pkOf,
  rowKey,
  coerceEdit,
  recordUpdate,
  toggleDelete,
  addInsert,
  removeInsert,
  editCount,
  toChangeSet,
  qualifyTable,
  type EditableSource,
} from '../src/edit/editModel';
import { buildChangeSetSql } from '../src/edit/dmlBuilder';

const SOURCE: EditableSource = { schema: 'tickit', table: 'sales', pkColumns: ['salesid'] };
const COLS = ['salesid', 'pricepaid', 'note'];

describe('pk helpers', () => {
  it('extracts a pk object and a stable key', () => {
    const pk = pkOf(COLS, [1, 99.5, 'x'], ['salesid']);
    expect(pk).toEqual({ salesid: 1 });
    expect(rowKey(pk)).toBe(rowKey({ salesid: 1 }));
    expect(rowKey({ a: 1, b: 2 })).toBe(rowKey({ b: 2, a: 1 })); // order-independent
  });

  it('throws if a pk column is missing from the result', () => {
    expect(() => pkOf(['pricepaid'], [10], ['salesid'])).toThrow(/salesid/);
  });
});

describe('coerceEdit', () => {
  it('keeps numbers numeric so SQL stays unquoted', () => {
    expect(coerceEdit('99.5', 42)).toBe(99.5);
  });
  it('maps a blank on a null cell to NULL', () => {
    expect(coerceEdit('', null)).toBeNull();
  });
  it('parses booleans, leaves text alone', () => {
    expect(coerceEdit('true', false)).toBe(true);
    expect(coerceEdit("O'Brien", 'x')).toBe("O'Brien");
  });
});

describe('recordUpdate', () => {
  it('records a change and reverts when set back to original', () => {
    const s = emptyEditState();
    recordUpdate(s, { salesid: 1 }, 'pricepaid', 99.5, 42);
    expect(editCount(s)).toBe(1);
    recordUpdate(s, { salesid: 1 }, 'pricepaid', 42, 42); // revert
    expect(editCount(s)).toBe(0);
  });

  it('accumulates multiple columns on one row', () => {
    const s = emptyEditState();
    recordUpdate(s, { salesid: 1 }, 'pricepaid', 99.5, 42);
    recordUpdate(s, { salesid: 1 }, 'note', "O'Brien", null);
    expect(editCount(s)).toBe(1);
    expect(Object.values(s.updates)[0]!.changes).toEqual({ pricepaid: 99.5, note: "O'Brien" });
  });

  it('ignores edits to a row scheduled for deletion', () => {
    const s = emptyEditState();
    toggleDelete(s, { salesid: 1 });
    recordUpdate(s, { salesid: 1 }, 'pricepaid', 99.5, 42);
    expect(Object.keys(s.updates)).toHaveLength(0);
  });
});

describe('toggleDelete / inserts', () => {
  it('toggles delete and clears any pending update on that row', () => {
    const s = emptyEditState();
    recordUpdate(s, { salesid: 1 }, 'pricepaid', 99.5, 42);
    expect(toggleDelete(s, { salesid: 1 })).toBe(true);
    expect(Object.keys(s.updates)).toHaveLength(0);
    expect(editCount(s)).toBe(1); // now a delete
    expect(toggleDelete(s, { salesid: 1 })).toBe(false); // un-delete
    expect(editCount(s)).toBe(0);
  });

  it('adds and removes blank insert rows', () => {
    const s = emptyEditState();
    const idx = addInsert(s, COLS);
    expect(editCount(s)).toBe(1);
    removeInsert(s, idx);
    expect(editCount(s)).toBe(0);
  });
});

describe('toChangeSet → SQL', () => {
  it('produces a transactional change-set covering all three ops', () => {
    const s = emptyEditState();
    recordUpdate(s, { salesid: 1 }, 'pricepaid', 99.5, 42);
    toggleDelete(s, { salesid: 2 });
    const ins = addInsert(s, COLS);
    s.inserts[ins]!.salesid = 99;
    s.inserts[ins]!.pricepaid = 10;

    const cs = toChangeSet(SOURCE, s);
    expect(cs.table).toBe('tickit.sales');
    const sql = buildChangeSetSql(cs);
    expect(sql).toContain('UPDATE tickit.sales SET pricepaid = 99.5 WHERE salesid = 1;');
    expect(sql).toContain('INSERT INTO tickit.sales (salesid, pricepaid) VALUES (99, 10);');
    expect(sql).toContain('DELETE FROM tickit.sales WHERE salesid = 2;');
    expect(sql.startsWith('BEGIN;')).toBe(true);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  it('drops fully-blank insert rows', () => {
    const s = emptyEditState();
    addInsert(s, COLS); // never filled
    const cs = toChangeSet(SOURCE, s);
    expect(cs.inserts).toHaveLength(0);
    expect(buildChangeSetSql(cs)).toBe('-- no pending changes');
  });

  it('quotes a schema/table that need it', () => {
    expect(qualifyTable({ schema: 'my schema', table: 'sales', pkColumns: ['id'] })).toBe('"my schema".sales');
  });
});
