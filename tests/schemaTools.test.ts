import { describe, expect, it } from 'vitest';
import { generateMockInserts } from '../src/schema/mockData';

const source = {
  schema: 'prod',
  tables: [
    { name: 'users', columns: [{ name: 'id', typeName: 'int4', nullable: false }, { name: 'name', typeName: 'varchar', nullable: true }] },
    { name: 'legacy', columns: [{ name: 'x', typeName: 'int4', nullable: true }] },
  ],
};
const target = {
  schema: 'staging',
  tables: [
    { name: 'users', columns: [{ name: 'id', typeName: 'int8', nullable: false }, { name: 'email', typeName: 'varchar', nullable: false }] },
    { name: 'orders', columns: [{ name: 'oid', typeName: 'int4', nullable: false }] },
  ],
};

describe('generateMockInserts', () => {
  const cols = [{ name: 'id', typeName: 'int4' }, { name: 'name', typeName: 'varchar' }, { name: 'active', typeName: 'bool' }, { name: 'created', typeName: 'date' }];

  it('is deterministic for a given seed', () => {
    const a = generateMockInserts('tickit', 'users', cols, 3, 42);
    const b = generateMockInserts('tickit', 'users', cols, 3, 42);
    expect(a).toBe(b);
  });

  it('produces one INSERT with N value rows, typed literals', () => {
    const sql = generateMockInserts('tickit', 'users', cols, 2, 7);
    expect(sql.startsWith('INSERT INTO tickit.users (id, name, active, created) VALUES')).toBe(true);
    expect(sql.trimEnd().endsWith(';')).toBe(true);
    expect((sql.match(/^ {2}\(/gm) ?? []).length).toBe(2); // 2 value rows
    expect(sql).toMatch(/'2026-\d\d-\d\d'/); // a date literal
    expect(sql).toMatch(/(true|false)/); // a bool
  });

  it('quotes text values as SQL string literals', () => {
    const sql = generateMockInserts('s', 't', [{ name: 'c', typeName: 'varchar' }], 1, 1);
    expect(sql).toMatch(/\('[a-z]+_0_0'\)/); // text value wrapped in single quotes
  });

  it('handles empty columns / zero rows', () => {
    expect(generateMockInserts('s', 't', [], 5, 1)).toMatch(/nothing to generate/);
    expect(generateMockInserts('s', 't', cols, 0, 1)).toMatch(/nothing to generate/);
  });
});
