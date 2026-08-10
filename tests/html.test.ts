import { describe, expect, it } from 'vitest';
import { escapeHtml, formatCell } from '../src/ui/html';

describe('escapeHtml', () => {
  it('escapes all HTML-significant characters (XSS guard for the results grid)', () => {
    expect(escapeHtml(`<script>alert("x&y'z")</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&amp;y&#39;z&quot;)&lt;/script&gt;',
    );
  });
});

describe('formatCell', () => {
  it('renders NULL for null/undefined', () => {
    expect(formatCell(null)).toBe('NULL');
    expect(formatCell(undefined)).toBe('NULL');
  });

  it('renders dates as ISO and objects as JSON', () => {
    expect(formatCell(new Date('2026-07-22T00:00:00Z'))).toBe('2026-07-22T00:00:00.000Z');
    expect(formatCell({ a: 1 })).toBe('{"a":1}');
  });

  it('renders primitives as strings', () => {
    expect(formatCell(42)).toBe('42');
    expect(formatCell(true)).toBe('true');
  });
});
