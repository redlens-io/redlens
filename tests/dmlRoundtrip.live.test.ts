import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgWireTransport } from '../src/transport/pgWire';
import { queryAll } from '../src/query/collect';
import { emptyEditState, recordUpdate, toggleDelete, addInsert, toChangeSet, type EditableSource } from '../src/edit/editModel';
import { buildChangeSetSql } from '../src/edit/dmlBuilder';

const HOST = process.env.REDLENS_PG_HOST;

/**
 * End-to-end proof of inline-data-edit: grid edits → editModel → dmlBuilder →
 * a real transaction against pg-compat. Covers UPDATE + INSERT + DELETE in one
 * change-set and asserts the resulting table state, plus atomic rollback on a
 * failing statement.
 */
describe.runIf(Boolean(HOST))('DML round-trip (live against pg-compat)', () => {
  const transport = new PgWireTransport({
    host: HOST ?? '',
    port: Number.parseInt(process.env.REDLENS_PG_PORT ?? '15439', 10),
    database: process.env.REDLENS_PG_DB ?? 'redlens',
    user: process.env.REDLENS_PG_USER ?? 'redlens',
    password: process.env.REDLENS_PG_PASSWORD ?? 'redlens',
    ssl: false,
  });
  const SOURCE: EditableSource = { schema: 'redlens_edit_test', table: 'widget', pkColumns: ['id'] };

  async function exec(sql: string): Promise<void> {
    const id = await transport.execute(sql);
    transport.releaseResult(id);
  }
  async function widgets(): Promise<unknown[][]> {
    const { rows } = await queryAll(transport, 'SELECT id, name, qty FROM redlens_edit_test.widget ORDER BY id');
    return rows;
  }

  beforeAll(async () => {
    await transport.connect();
    await exec(`
      DROP SCHEMA IF EXISTS redlens_edit_test CASCADE;
      CREATE SCHEMA redlens_edit_test;
      CREATE TABLE redlens_edit_test.widget (id int PRIMARY KEY, name varchar(40), qty int);
      INSERT INTO redlens_edit_test.widget VALUES (1, 'alpha', 10), (2, 'beta', 20), (3, 'gamma', 30);
    `);
  });

  afterAll(async () => {
    await exec('DROP SCHEMA IF EXISTS redlens_edit_test CASCADE');
    await transport.dispose();
  });

  it('applies UPDATE + INSERT + DELETE atomically and reflects the new state', async () => {
    const cols = ['id', 'name', 'qty'];
    const rows = await widgets();
    const state = emptyEditState();

    // Edit row id=1 qty 10→99; delete row id=2; add a new row id=4.
    recordUpdate(state, { id: 1 }, 'qty', 99, 10);
    toggleDelete(state, { id: 2 });
    const ins = addInsert(state, cols);
    state.inserts[ins]!.id = 4;
    state.inserts[ins]!.name = "O'Neil";
    state.inserts[ins]!.qty = 40;
    void rows;

    const sql = buildChangeSetSql(toChangeSet(SOURCE, state));
    expect(sql.startsWith('BEGIN;')).toBe(true);
    await exec(sql);

    const after = await widgets();
    expect(after).toEqual([
      [1, 'alpha', 99], // updated
      [3, 'gamma', 30], // untouched
      [4, "O'Neil", 40], // inserted, apostrophe survived quoting
    ]);
  });

  it('rolls the whole change-set back when one statement fails (atomicity)', async () => {
    const before = await widgets();
    // A duplicate-PK insert must abort the transaction, leaving the table intact.
    const badSql = ['BEGIN;',
      "UPDATE redlens_edit_test.widget SET name = 'should-not-persist' WHERE id = 1;",
      "INSERT INTO redlens_edit_test.widget (id, name, qty) VALUES (3, 'dup', 1);",
      'COMMIT;'].join('\n');
    await expect(transport.execute(badSql)).rejects.toThrow();
    expect(await widgets()).toEqual(before);
  });
});
