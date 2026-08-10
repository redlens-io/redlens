import { describe, expect, it } from 'vitest';
import { computeSuggestions, type CompletionCache } from '../src/language/completion';

const cache: CompletionCache = {
  schemas: ['tickit', 'public'],
  tables: (schema) =>
    schema === 'tickit'
      ? [
          { name: 'sales', kind: 'table' },
          { name: 'users', kind: 'table' },
        ]
      : [{ name: 'notes', kind: 'table' }],
  columns: (schema, table) =>
    schema === 'tickit' && table === 'sales'
      ? [
          { name: 'salesid', typeName: 'int4' },
          { name: 'pricepaid', typeName: 'numeric' },
        ]
      : [],
};

describe('computeSuggestions', () => {
  it('suggests tables after schema-dot', () => {
    const got = computeSuggestions('SELECT * FROM tickit.', cache);
    expect(got.map((s) => s.label)).toEqual(['sales', 'users']);
    expect(got.every((s) => s.kind === 'table')).toBe(true);
  });

  it('suggests columns after table-dot (searching loaded schemas)', () => {
    const got = computeSuggestions('SELECT sales.', cache);
    expect(got.map((s) => s.label)).toEqual(['salesid', 'pricepaid']);
    expect(got[0]?.kind).toBe('column');
  });

  it('suggests tables mid-word after the dot', () => {
    const got = computeSuggestions('SELECT * FROM tickit.sa', cache);
    expect(got.map((s) => s.label)).toContain('sales');
  });

  it('returns empty for unknown qualifiers', () => {
    expect(computeSuggestions('SELECT nope.', cache)).toEqual([]);
  });

  it('suggests schemas, tables, keywords and functions without a qualifier', () => {
    const got = computeSuggestions('SELECT ', cache);
    const labels = got.map((s) => s.label);
    expect(labels).toContain('tickit');
    expect(labels).toContain('sales');
    expect(labels).toContain('GROUP BY');
    expect(labels).toContain('LISTAGG');
  });
});
