import { describe, expect, it } from 'vitest';
import { maskSql, splitStatements } from '../src/language/sqlText';
import { lintSql } from '../src/language/linter';
import { parseAliases, computeSuggestions, type CompletionCache } from '../src/language/completion';
import { findMatches } from '../src/language/findUsages';

describe('maskSql (length-preserving)', () => {
  it('blanks literal/comment content but keeps length and newlines', () => {
    const sql = "SELECT 'a;b' -- ;c\nFROM t";
    const masked = maskSql(sql);
    expect(masked.length).toBe(sql.length);
    expect(masked).not.toContain(';b'); // semicolon inside string is masked
    expect(masked).toContain('\n');
    expect(masked).toContain('FROM t');
  });
});

describe('splitStatements', () => {
  it('splits on real semicolons with original offsets', () => {
    const sql = "SELECT ';' AS a; DELETE FROM t";
    const sts = splitStatements(sql);
    expect(sts).toHaveLength(2);
    expect(sql.slice(sts[1]!.start, sts[1]!.end)).toBe('DELETE FROM t');
  });
});

describe('lintSql', () => {
  it('warns on DELETE/UPDATE without WHERE and TRUNCATE', () => {
    const issues = lintSql('DELETE FROM tickit.sales;');
    expect(issues[0]?.code).toBe('unsafe-delete');
    expect(lintSql('UPDATE t SET a=1').some((i) => i.code === 'unsafe-update')).toBe(true);
    expect(lintSql('TRUNCATE t').some((i) => i.code === 'unsafe-truncate')).toBe(true);
  });

  it('does not warn when WHERE is present, and hints on SELECT *', () => {
    expect(lintSql('DELETE FROM t WHERE id = 1').filter((i) => i.severity === 'warning')).toHaveLength(0);
    expect(lintSql('SELECT * FROM t').some((i) => i.code === 'select-star')).toBe(true);
  });

  it('is not fooled by keywords inside strings', () => {
    expect(lintSql("SELECT 'DELETE FROM x' AS s").filter((i) => i.severity === 'warning')).toHaveLength(0);
  });

  it('still warns on WHERE with no condition — the empty quick-fix result (UXD-027)', () => {
    // `WHERE ;` (what "Add WHERE clause" used to leave) must keep warning.
    expect(lintSql('DELETE FROM t WHERE ;').some((i) => i.code === 'unsafe-delete')).toBe(true);
    expect(lintSql('DELETE FROM t WHERE ').some((i) => i.code === 'unsafe-delete')).toBe(true);
    // A real condition clears it.
    expect(lintSql('DELETE FROM t WHERE id = 1').filter((i) => i.severity === 'warning')).toHaveLength(0);
  });
});

describe('parseAliases + alias completion', () => {
  const cache: CompletionCache = {
    schemas: ['tickit'],
    tables: (s) => (s === 'tickit' ? [{ name: 'sales', kind: 'table' }] : []),
    columns: (s, t) => (s === 'tickit' && t === 'sales' ? [{ name: 'salesid', typeName: 'int4' }, { name: 'pricepaid', typeName: 'numeric' }] : []),
  };

  it('parses FROM/JOIN aliases', () => {
    const aliases = parseAliases('SELECT * FROM tickit.sales s JOIN tickit.event e ON e.eventid = s.eventid');
    expect(aliases.find((a) => a.alias === 's')?.table).toBe('sales');
    expect(aliases.find((a) => a.alias === 'e')?.table).toBe('event');
  });

  it('suggests columns for an alias', () => {
    const aliases = parseAliases('SELECT s. FROM tickit.sales s');
    const got = computeSuggestions('SELECT s.', cache, aliases);
    expect(got.map((x) => x.label)).toEqual(['salesid', 'pricepaid']);
  });

  it('does not treat SQL keywords as aliases', () => {
    const aliases = parseAliases('SELECT * FROM tickit.sales WHERE x = 1');
    expect(aliases.some((a) => a.alias.toLowerCase() === 'where')).toBe(false);
  });
});

describe('findMatches', () => {
  it('finds word-boundary matches with line/column', () => {
    const text = 'SELECT * FROM sales;\n-- sales again\nJOIN wholesales';
    const m = findMatches(text, 'sales');
    expect(m).toHaveLength(2); // "wholesales" is not a word-boundary match
    expect(m[0]?.line).toBe(0);
    expect(m[1]?.line).toBe(1);
  });
});
