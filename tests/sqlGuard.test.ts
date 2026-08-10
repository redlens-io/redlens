import { describe, expect, it } from 'vitest';
import { checkReadOnlySql, stripLiteralsAndComments } from '../src/mcp/sqlGuard';
import { tokenMatches } from '../src/mcp/bridgeCore';

describe('stripLiteralsAndComments', () => {
  it('removes strings (with escaped quotes), identifiers and comments', () => {
    const sql = `SELECT 'it''s; a trap', "col;name" -- trailing; comment\n/* block; comment */ FROM t`;
    const stripped = stripLiteralsAndComments(sql);
    expect(stripped).not.toContain('trap');
    expect(stripped).not.toContain('col;name');
    expect(stripped).not.toContain('comment');
    expect(stripped).toContain('FROM t');
  });
});

describe('checkReadOnlySql', () => {
  it.each([
    'SELECT * FROM tickit.sales LIMIT 10',
    'WITH x AS (SELECT 1) SELECT * FROM x',
    'EXPLAIN SELECT 1',
    'SHOW SCHEMAS',
    "SELECT CASE WHEN a > 1 THEN 'x' ELSE 'y' END FROM t;",
    "SELECT 'semicolons; inside; strings' AS s",
  ])('accepts read-only statement: %s', (sql) => {
    expect(checkReadOnlySql(sql).ok).toBe(true);
  });

  it.each([
    ['INSERT INTO t VALUES (1)', /SELECT/],
    ['UPDATE t SET a = 1', /SELECT/],
    ['DELETE FROM t', /SELECT/],
    ['DROP TABLE t', /SELECT/],
    ['CREATE TABLE t (a int)', /SELECT/],
    ['COMMIT', /read-only transaction/],
    ['ROLLBACK; SELECT 1', /multiple statements/],
    ['SELECT 1; SELECT 2', /multiple statements/],
    ['SET default_transaction_read_only = off', /read-only transaction/],
    ['BEGIN', /read-only transaction/],
    ['', /empty/],
    ['-- just a comment', /empty/],
  ])('rejects: %s', (sql, reason) => {
    const verdict = checkReadOnlySql(sql);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(reason);
  });

  it('is not fooled by keywords hidden in strings/comments', () => {
    expect(checkReadOnlySql("SELECT 'DROP TABLE x; COMMIT' AS payload").ok).toBe(true);
    expect(checkReadOnlySql('SELECT 1 /* COMMIT; DROP TABLE x */').ok).toBe(true);
  });
});

describe('bridge authentication (S-09)', () => {
  it('rejects a caller with no token, a wrong token, or a truncated one', () => {
    const secret = 'a'.repeat(64);
    expect(tokenMatches(secret, secret)).toBe(true);
    expect(tokenMatches(secret, undefined)).toBe(false);
    expect(tokenMatches(secret, '')).toBe(false);
    expect(tokenMatches(secret, 'b'.repeat(64))).toBe(false);
    // A prefix must not pass: a length-only or startsWith check would let an
    // attacker discover the secret one character at a time.
    expect(tokenMatches(secret, 'a'.repeat(63))).toBe(false);
    expect(tokenMatches(secret, 'a'.repeat(65))).toBe(false);
  });

  it('ignores non-string tokens instead of coercing them', () => {
    const secret = 'abc';
    for (const bogus of [null, 123, {}, ['abc'], true]) {
      expect(tokenMatches(secret, bogus), String(bogus)).toBe(false);
    }
  });
});
