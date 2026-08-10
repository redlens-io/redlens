import { describe, expect, it } from 'vitest';
import { decideRun, isWrite } from '../src/edit/writeGuard';
import { buildUpdate, buildInsert, buildDelete, buildChangeSetSql } from '../src/edit/dmlBuilder';

describe('isWrite', () => {
  it('classifies writes vs reads', () => {
    expect(isWrite('SELECT * FROM t')).toBe(false);
    expect(isWrite('WITH x AS (SELECT 1) SELECT * FROM x')).toBe(false);
    expect(isWrite('UPDATE t SET a=1 WHERE id=1')).toBe(true);
    expect(isWrite('DELETE FROM t WHERE id=1')).toBe(true);
    expect(isWrite('COPY t FROM ...')).toBe(true);
    expect(isWrite('VACUUM t')).toBe(true);
  });

  it('is not fooled by a write keyword inside a string', () => {
    expect(isWrite("SELECT 'DELETE FROM x' AS s")).toBe(false);
  });
});

describe('decideRun', () => {
  it('blocks writes on read-only connections', () => {
    const d = decideRun('DELETE FROM t WHERE id=1', { readOnly: true, production: false });
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/READ-ONLY/);
  });

  it('confirms writes on production connections', () => {
    const d = decideRun('UPDATE t SET a=1 WHERE id=1', { readOnly: false, production: true });
    expect(d.allow).toBe(true);
    expect(d.needsConfirm).toBe(true);
    expect(d.reason).toMatch(/PRODUCTION/);
  });

  it('allows reads freely regardless of flags', () => {
    expect(decideRun('SELECT 1', { readOnly: true, production: true })).toEqual({ allow: true, needsConfirm: false });
  });
});

describe('dmlBuilder', () => {
  it('builds an UPDATE with PK where-clause and safe quoting', () => {
    const sql = buildUpdate('tickit.sales', { pk: { salesid: 1 }, changes: { pricepaid: 99.5, note: "O'Brien" } });
    expect(sql).toContain('UPDATE tickit.sales SET');
    expect(sql).toContain('pricepaid = 99.5');
    expect(sql).toContain("note = 'O''Brien'");
    expect(sql).toContain('WHERE salesid = 1;');
  });

  it('builds INSERT and DELETE', () => {
    expect(buildInsert('t', { id: 1, name: 'x' })).toBe("INSERT INTO t (id, name) VALUES (1, 'x');");
    expect(buildDelete('t', { id: 5 })).toBe('DELETE FROM t WHERE id = 5;');
  });

  it('throws when there is no primary key', () => {
    expect(() => buildDelete('t', {})).toThrow(/primary key/);
  });

  it('wraps a change-set in a transaction', () => {
    const sql = buildChangeSetSql({
      table: 'tickit.sales',
      updates: [{ pk: { salesid: 1 }, changes: { qtysold: 2 } }],
      inserts: [{ salesid: 99, qtysold: 1 }],
      deletes: [{ salesid: 2 }],
    });
    expect(sql.startsWith('BEGIN;')).toBe(true);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(sql).toContain('UPDATE');
    expect(sql).toContain('INSERT');
    expect(sql).toContain('DELETE');
  });

  it('reports no changes for an empty change-set', () => {
    expect(buildChangeSetSql({ table: 't', updates: [], inserts: [], deletes: [] })).toBe('-- no pending changes');
  });
});
