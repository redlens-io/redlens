import { describe, expect, it } from 'vitest';
import { makePiiMatcher, maskValue, piiColumnIndices, maskRows, MASK_TOKEN, type PiiConfig } from '../src/pii/piiMask';

const COLS = [{ name: 'id' }, { name: 'customer_email' }, { name: 'phone' }, { name: 'card_number' }, { name: 'total' }];

describe('makePiiMatcher', () => {
  it('matches by case-insensitive substring', () => {
    const m = makePiiMatcher(['email', 'phone']);
    expect(m('customer_email')).toBe(true);
    expect(m('EMAIL')).toBe(true);
    expect(m('home_phone')).toBe(true);
    expect(m('total')).toBe(false);
  });

  it('supports glob patterns', () => {
    const m = makePiiMatcher(['card_*', 'ssn']);
    expect(m('card_number')).toBe(true);
    expect(m('ssn')).toBe(true);
    expect(m('discard')).toBe(false); // anchored glob card_* does not match "discard"
    expect(m('total')).toBe(false);
  });

  it('ignores blank patterns', () => {
    expect(makePiiMatcher(['', '  '])('anything')).toBe(false);
  });
});

describe('maskValue', () => {
  it('masks non-null and preserves null', () => {
    expect(maskValue('a@b.com')).toBe(MASK_TOKEN);
    expect(maskValue(123)).toBe(MASK_TOKEN);
    expect(maskValue(null)).toBeNull();
    expect(maskValue(undefined)).toBeUndefined();
  });
});

describe('piiColumnIndices', () => {
  const config: PiiConfig = { enabled: true, patterns: ['email', 'phone', '*card*'] };
  it('finds the matching column indices', () => {
    expect(piiColumnIndices(COLS, config)).toEqual([1, 2, 3]);
  });
  it('returns nothing when disabled', () => {
    expect(piiColumnIndices(COLS, { ...config, enabled: false })).toEqual([]);
  });
});

describe('maskRows', () => {
  const config: PiiConfig = { enabled: true, patterns: ['email', 'phone', '*card*'] };
  it('masks only the PII columns, leaves others intact', () => {
    const rows = [[1, 'a@b.com', '555-1234', '4111111111111111', 99.5]];
    expect(maskRows(COLS, rows, config)).toEqual([[1, MASK_TOKEN, MASK_TOKEN, MASK_TOKEN, 99.5]]);
  });

  it('returns the same reference when nothing matches (no cost)', () => {
    const rows = [[1, 2, 3]];
    const same = maskRows([{ name: 'id' }, { name: 'qty' }, { name: 'total' }], rows, config);
    expect(same).toBe(rows);
  });

  it('does not mask when disabled', () => {
    const rows = [[1, 'a@b.com']];
    expect(maskRows([{ name: 'id' }, { name: 'email' }], rows, { enabled: false, patterns: ['email'] })).toBe(rows);
  });
});
