import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgWireTransport } from '../src/transport/pgWire';
import { queryAll } from '../src/query/collect';

const HOST = process.env.REDLENS_PG_HOST;

/**
 * transaction-control: proves that BEGIN / COMMIT / ROLLBACK issued as separate
 * execute() calls span the same session (RedLens' manual-commit mode keeps one
 * persistent connection). ROLLBACK undoes; COMMIT persists.
 */
describe.runIf(Boolean(HOST))('manual transaction control (live against pg-compat)', () => {
  const transport = new PgWireTransport({
    host: HOST ?? '',
    port: Number.parseInt(process.env.REDLENS_PG_PORT ?? '15439', 10),
    database: process.env.REDLENS_PG_DB ?? 'redlens',
    user: process.env.REDLENS_PG_USER ?? 'redlens',
    password: process.env.REDLENS_PG_PASSWORD ?? 'redlens',
    ssl: false,
  });

  async function exec(sql: string): Promise<void> {
    const id = await transport.execute(sql);
    transport.releaseResult(id);
  }
  async function qty(): Promise<number> {
    const { rows } = await queryAll(transport, 'SELECT qty FROM redlens_txn_test.item WHERE id = 1');
    return Number(rows[0]![0]);
  }

  beforeAll(async () => {
    await transport.connect();
    await exec(`
      DROP SCHEMA IF EXISTS redlens_txn_test CASCADE;
      CREATE SCHEMA redlens_txn_test;
      CREATE TABLE redlens_txn_test.item (id int PRIMARY KEY, qty int);
      INSERT INTO redlens_txn_test.item VALUES (1, 100);
    `);
  });

  afterAll(async () => {
    await exec('DROP SCHEMA IF EXISTS redlens_txn_test CASCADE');
    await transport.dispose();
  });

  it('ROLLBACK undoes changes made after BEGIN', async () => {
    await exec('BEGIN');
    await exec('UPDATE redlens_txn_test.item SET qty = 1 WHERE id = 1');
    expect(await qty()).toBe(1); // visible inside the transaction
    await exec('ROLLBACK');
    expect(await qty()).toBe(100); // undone
  });

  it('COMMIT persists changes made after BEGIN', async () => {
    await exec('BEGIN');
    await exec('UPDATE redlens_txn_test.item SET qty = 42 WHERE id = 1');
    await exec('COMMIT');
    expect(await qty()).toBe(42);
  });
});
