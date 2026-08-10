import { describe, expect, it } from 'vitest';
import { DemoTransport } from '../src/transport/demoTransport';
import { FIXTURE_TABLES, FixtureMetadataSource } from '../src/demo/fixtures';

describe('DemoTransport', () => {
  const transport = new DemoTransport();

  it('previews fixture tables with LIMIT, quoted or not', async () => {
    const id = await transport.execute('SELECT * FROM "tickit"."sales" LIMIT 10');
    const page = await transport.fetchPage(id);
    expect(page.rows).toHaveLength(10);
    expect(page.columns.map((c) => c.name)).toContain('pricepaid');
    transport.releaseResult(id);

    const id2 = await transport.execute('select * from tickit.users limit 5;');
    const page2 = await transport.fetchPage(id2);
    expect(page2.rows).toHaveLength(5);
    transport.releaseResult(id2);
  });

  it('answers SELECT 1 (connection tests)', async () => {
    const id = await transport.execute('SELECT 1');
    const page = await transport.fetchPage(id);
    expect(page.rows).toEqual([[1]]);
    transport.releaseResult(id);
  });

  it('rejects arbitrary SQL with an actionable message', async () => {
    await expect(transport.execute('SELECT count(*) FROM tickit.sales GROUP BY eventid')).rejects.toThrow(
      /Demo mode runs table previews/,
    );
  });

  it('rejects unknown tables', async () => {
    await expect(transport.execute('SELECT * FROM nope.missing LIMIT 5')).rejects.toThrow(/demo table not found/);
  });
});

describe('FixtureMetadataSource', () => {
  const source = new FixtureMetadataSource();

  it('exposes the fixture schemas, tables and columns coherently', async () => {
    const schemas = await source.listSchemas();
    expect(schemas).toEqual(['spectrum_demo', 'tickit']);

    const tables = await source.listTables('tickit');
    expect(tables.map((t) => t.name).sort()).toEqual(['event', 'sales', 'users', 'venue', 'venue_last_week']);

    const external = await source.listTables('spectrum_demo');
    expect(external[0]?.kind).toBe('external');

    const columns = await source.listColumns('tickit', 'sales');
    expect(columns.map((c) => c.name)).toEqual(['salesid', 'eventid', 'qtysold', 'pricepaid', 'saletime']);
  });

  it('fixture rows match their declared column count', () => {
    for (const table of FIXTURE_TABLES) {
      for (const row of table.rows) {
        expect(row).toHaveLength(table.columns.length);
      }
    }
  });

  it('exposes fixture foreign keys (fk-navigation in demo mode)', async () => {
    const salesFks = await source.listForeignKeys('tickit', 'sales');
    expect(salesFks).toContainEqual({ column: 'eventid', refSchema: 'tickit', refTable: 'event', refColumn: 'eventid' });
    expect(await source.listForeignKeys('tickit', 'venue')).toEqual([]);
  });

  it('single-set transport reports resultSetCount 1', async () => {
    const t = new DemoTransport();
    const id = await t.execute('SELECT 1');
    expect(t.resultSetCount(id)).toBe(1);
    expect(t.getCellValue(id, 0, 0, 0)).toBe(1);
    t.releaseResult(id);
  });
});
