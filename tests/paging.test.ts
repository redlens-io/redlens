import { describe, expect, it } from 'vitest';
import { slicePage } from '../src/query/paging';

const data = Array.from({ length: 1203 }, (_, i) => i);

describe('slicePage', () => {
  it('returns the first page with a continuation token', () => {
    const page = slicePage(data, undefined, 500);
    expect(page.items).toHaveLength(500);
    expect(page.items[0]).toBe(0);
    expect(page.nextToken).toBe('500');
  });

  it('walks pages to the end without a trailing token', () => {
    const p2 = slicePage(data, '500', 500);
    expect(p2.items[0]).toBe(500);
    expect(p2.nextToken).toBe('1000');
    const p3 = slicePage(data, '1000', 500);
    expect(p3.items).toHaveLength(203);
    expect(p3.nextToken).toBeUndefined();
  });

  it('handles empty datasets', () => {
    const page = slicePage([], undefined);
    expect(page.items).toHaveLength(0);
    expect(page.nextToken).toBeUndefined();
  });

  it('rejects invalid tokens and page sizes', () => {
    expect(() => slicePage(data, 'garbage')).toThrow(/invalid page token/);
    expect(() => slicePage(data, undefined, 0)).toThrow(/positive/);
  });
});
