import { describe, expect, it } from 'vitest';
import { formatSql } from '../src/language/formatter';
import { detectUnsafe } from '../src/language/unsafeQuery';

describe('formatSql (redshift dialect)', () => {
  it('uppercases keywords and lays out the query', () => {
    const out = formatSql('select a,b from tickit.sales where a>1');
    expect(out).toContain('SELECT');
    expect(out).toContain('FROM');
    expect(out).toContain('WHERE');
    expect(out.split('\n').length).toBeGreaterThan(1);
  });

  it('respects keywordCase override', () => {
    const out = formatSql('SELECT 1', { keywordCase: 'lower' });
    expect(out.startsWith('select')).toBe(true);
  });

  it('handles Redshift-specific syntax (DISTKEY) without throwing', () => {
    expect(() => formatSql('create table t (id int) diststyle key distkey (id) sortkey (id)')).not.toThrow();
  });
});

describe('detectUnsafe', () => {
  it('flags UPDATE/DELETE without WHERE', () => {
    expect(detectUnsafe('UPDATE tickit.sales SET qtysold = 0').unsafe).toBe(true);
    expect(detectUnsafe('DELETE FROM tickit.sales').reason).toMatch(/every row/);
  });

  it('allows UPDATE/DELETE WITH a where clause', () => {
    expect(detectUnsafe('UPDATE tickit.sales SET qtysold = 0 WHERE salesid = 1').unsafe).toBe(false);
    expect(detectUnsafe('DELETE FROM tickit.sales WHERE salesid = 1').unsafe).toBe(false);
  });

  it('flags TRUNCATE and DROP', () => {
    expect(detectUnsafe('TRUNCATE tickit.sales').unsafe).toBe(true);
    expect(detectUnsafe('DROP TABLE tickit.sales').unsafe).toBe(true);
  });

  it('is not fooled by WHERE inside a string literal', () => {
    expect(detectUnsafe("DELETE FROM t -- keep WHERE").unsafe).toBe(true);
    expect(detectUnsafe("UPDATE t SET note = 'x WHERE y'").unsafe).toBe(true);
  });

  it('passes plain SELECTs', () => {
    expect(detectUnsafe('SELECT * FROM tickit.sales').unsafe).toBe(false);
  });
});
