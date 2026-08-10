import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgWireTransport } from '../src/transport/pgWire';
import { SqlMetadataSource } from '../src/metadata/sqlSource';

const HOST = process.env.REDLENS_PG_HOST;

describe.runIf(Boolean(HOST))('SqlMetadataSource compat (live against pg-compat)', () => {
  const transport = new PgWireTransport({
    host: HOST ?? '',
    port: Number.parseInt(process.env.REDLENS_PG_PORT ?? '15439', 10),
    database: process.env.REDLENS_PG_DB ?? 'redlens',
    user: process.env.REDLENS_PG_USER ?? 'redlens',
    password: process.env.REDLENS_PG_PASSWORD ?? 'redlens',
    ssl: false,
  });
  const source = new SqlMetadataSource(transport, 'compat');

  beforeAll(async () => {
    await transport.connect();
    const setup = await transport.execute(`
      DROP SCHEMA IF EXISTS redlens_meta_test CASCADE;
      CREATE SCHEMA redlens_meta_test;
      CREATE TABLE redlens_meta_test.orders (id int4 NOT NULL, amount numeric, note varchar(50));
      CREATE VIEW redlens_meta_test.big_orders AS SELECT * FROM redlens_meta_test.orders WHERE amount > 100;
    `);
    transport.releaseResult(setup);
  });

  afterAll(async () => {
    const cleanup = await transport.execute('DROP SCHEMA IF EXISTS redlens_meta_test CASCADE');
    transport.releaseResult(cleanup);
    await transport.dispose();
  });

  it('lists schemas without pg_* noise and including the test schema', async () => {
    const schemas = await source.listSchemas();
    expect(schemas).toContain('redlens_meta_test');
    expect(schemas).toContain('public');
    expect(schemas.some((s) => s.startsWith('pg_'))).toBe(false);
    expect(schemas).not.toContain('information_schema');
  });

  it('lists tables and views with correct kinds', async () => {
    const tables = await source.listTables('redlens_meta_test');
    const byName = new Map(tables.map((t) => [t.name, t]));
    expect(byName.get('orders')?.kind).toBe('table');
    expect(byName.get('big_orders')?.kind).toBe('view');
  });

  it('lists columns in ordinal order with types and nullability', async () => {
    const columns = await source.listColumns('redlens_meta_test', 'orders');
    expect(columns.map((c) => c.name)).toEqual(['id', 'amount', 'note']);
    expect(columns[0]?.nullable).toBe(false);
    expect(columns[1]?.typeName).toBe('numeric');
    expect(columns[2]?.typeName).toBe('character varying');
  });

  it('escapes hostile identifiers in literals (no injection via schema names)', async () => {
    const tables = await source.listTables(`redlens'; DROP TABLE x; --`);
    expect(tables).toEqual([]);
  });

  it('lists foreign keys from the catalog (fk-navigation)', async () => {
    const fks = await source.listForeignKeys('tickit', 'sales');
    const eventFk = fks.find((f) => f.column === 'eventid');
    expect(eventFk).toEqual({ column: 'eventid', refSchema: 'tickit', refTable: 'event', refColumn: 'eventid' });

    const eventFks = await source.listForeignKeys('tickit', 'event');
    expect(eventFks.find((f) => f.column === 'venueid')?.refTable).toBe('venue');

    // A table without FKs returns empty, not an error.
    expect(await source.listForeignKeys('tickit', 'venue')).toEqual([]);
  });

  it('lists the primary key columns (for inline edit / DML)', async () => {
    expect(await source.listPrimaryKey('tickit', 'sales')).toEqual(['salesid']);
    expect(await source.listPrimaryKey('tickit', 'event')).toEqual(['eventid']);
    // public.app_notes has a serial PK 'id'
    expect(await source.listPrimaryKey('public', 'app_notes')).toEqual(['id']);
  });

  // Guardia del seed: lo que el usuario DEBE ver al conectar compat (la
  // experiencia visible, no solo las queries — lección del 2026-07-22).
  it('pg-compat ships seeded content: tickit schema + non-empty public', async () => {
    const schemas = await source.listSchemas();
    expect(schemas).toContain('tickit');

    const tickit = await source.listTables('tickit');
    expect(tickit.map((t) => t.name).sort()).toEqual(['event', 'event_sales', 'sales', 'users', 'venue']);
    expect(tickit.find((t) => t.name === 'event_sales')?.kind).toBe('view');

    const publicTables = await source.listTables('public');
    expect(publicTables.map((t) => t.name)).toContain('app_notes');
  });
});
