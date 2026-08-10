import { describe, expect, it } from 'vitest';
import { csvToInserts } from '../src/schema/csvImport';
import { buildRedshiftCreateTable, createTableTemplate, type TableDef } from '../src/schema/tableDesigner';

describe('csvToInserts', () => {
  it('uses the header as columns and types cells (numeric/null/text)', () => {
    const csv = 'id,name,amount\n1,alpha,10.5\n2,,\n3,"O\'Brien",7';
    const sql = csvToInserts(csv, 'staging', 'people', { hasHeader: true });
    expect(sql).toContain('INSERT INTO staging.people (id, name, amount) VALUES');
    expect(sql).toContain("(1, 'alpha', 10.5)");
    expect(sql).toContain('(2, NULL, NULL)'); // empty cells → NULL
    expect(sql).toContain("(3, 'O''Brien', 7)"); // quote escaped
  });

  it('synthesizes col1..colN when there is no header', () => {
    const sql = csvToInserts('1\ta\n2\tb', 's', 't', { hasHeader: false }); // TSV
    expect(sql).toContain('(col1, col2) VALUES');
    expect((sql.match(/^ {2}\(/gm) ?? []).length).toBe(2);
  });

  it('pads short rows to the header width so the INSERT stays valid', () => {
    const sql = csvToInserts('a,b,c\n1,2', 's', 't', { hasHeader: true });
    expect(sql).toContain('(1, 2, NULL)');
  });

  it('caps rows and notes the omission', () => {
    const csv = 'n\n' + Array.from({ length: 10 }, (_, i) => i).join('\n');
    const sql = csvToInserts(csv, 's', 't', { hasHeader: true, maxRows: 3 });
    expect((sql.match(/^ {2}\(/gm) ?? []).length).toBe(3);
    expect(sql).toMatch(/7 more rows omitted/);
  });

  it('quotes leading-zero all-digit strings (ZIP/phone) instead of unquoting them', () => {
    const sql = csvToInserts('zip,n\n007,0\n0123,3.5', 's', 't', { hasHeader: true });
    expect(sql).toContain("('007', 0)"); // zip kept as string, lone 0 stays numeric
    expect(sql).toContain("('0123', 3.5)"); // leading-zero quoted, decimal numeric
  });

  it('handles an empty file', () => {
    expect(csvToInserts('', 's', 't', { hasHeader: true })).toMatch(/empty CSV/);
  });
});

describe('buildRedshiftCreateTable', () => {
  const def: TableDef = {
    schema: 'analytics', table: 'orders', diststyle: 'KEY',
    columns: [
      { name: 'order_id', type: 'bigint', nullable: false, distkey: true },
      { name: 'customer', type: 'varchar(128)', encode: 'zstd' },
      { name: 'created_at', type: 'timestamp', nullable: false, sortkey: 1 },
      { name: 'shipped_at', type: 'timestamp', sortkey: 2 },
    ],
  };

  it('emits columns with ENCODE/NOT NULL/DISTKEY and a compound SORTKEY + DISTSTYLE', () => {
    const sql = buildRedshiftCreateTable(def);
    expect(sql).toContain('CREATE TABLE analytics.orders (');
    expect(sql).toContain('order_id bigint DISTKEY NOT NULL'); // Redshift order: DISTKEY before constraints
    expect(sql).toContain('customer varchar(128) ENCODE zstd');
    expect(sql).toContain('DISTSTYLE KEY');
    expect(sql).toMatch(/SORTKEY\(created_at, shipped_at\)/); // ordered by sortkey position
  });

  it('handles no columns', () => {
    expect(buildRedshiftCreateTable({ schema: 's', table: 't', columns: [] })).toMatch(/add at least one column/);
  });

  it('template scaffold includes CREATE TABLE and Redshift tips', () => {
    const t = createTableTemplate('public', 'my_table');
    expect(t).toContain('CREATE TABLE public.my_table (');
    expect(t).toMatch(/DISTKEY/);
    expect(t).toMatch(/SORTKEY/);
  });
});
