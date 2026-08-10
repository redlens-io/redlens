import { describe, expect, it } from 'vitest';
import { buildCreateTable, buildInsert, buildSelect, ident } from '../src/scripting/ddl';

const cols = [
  { name: 'salesid', typeName: 'int4', nullable: false },
  { name: 'pricepaid', typeName: 'numeric', nullable: true },
];

describe('ident', () => {
  it('quotes only names that need it', () => {
    expect(ident('sales')).toBe('sales');
    expect(ident('Weird Name')).toBe('"Weird Name"');
    expect(ident('a"b')).toBe('"a""b"');
  });
});

describe('buildCreateTable', () => {
  it('emits aligned DDL with NOT NULL', () => {
    const ddl = buildCreateTable('tickit', 'sales', cols);
    expect(ddl).toContain('CREATE TABLE tickit.sales (');
    expect(ddl).toMatch(/salesid\s+int4\s+NOT NULL,/);
    expect(ddl).toMatch(/pricepaid\s+numeric/);
    expect(ddl.trimEnd().endsWith(');')).toBe(true);
  });

  it('handles no columns gracefully', () => {
    expect(buildCreateTable('s', 't', [])).toContain('no column metadata');
  });
});

describe('buildSelect', () => {
  it('lists columns and adds LIMIT', () => {
    const sql = buildSelect('tickit', 'sales', cols);
    expect(sql).toContain('SELECT');
    expect(sql).toContain('salesid');
    expect(sql).toContain('FROM tickit.sales');
    expect(sql).toContain('LIMIT 100;');
  });
});

describe('buildInsert', () => {
  it('generates an INSERT with :param placeholders', () => {
    const sql = buildInsert('tickit', 'sales', cols);
    expect(sql).toContain('INSERT INTO tickit.sales (salesid, pricepaid)');
    expect(sql).toContain('VALUES (:salesid, :pricepaid);');
  });
});
