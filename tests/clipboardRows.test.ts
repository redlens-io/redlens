import { describe, expect, it } from 'vitest';
import { parseClipboardRows } from '../src/edit/clipboardRows';

describe('parseClipboardRows', () => {
  it('parses TSV (Excel / grid paste)', () => {
    expect(parseClipboardRows('1\talpha\t10\n2\tbeta\t20')).toEqual([
      ['1', 'alpha', '10'],
      ['2', 'beta', '20'],
    ]);
  });

  it('parses simple CSV', () => {
    expect(parseClipboardRows('1,alpha,10\n2,beta,20')).toEqual([
      ['1', 'alpha', '10'],
      ['2', 'beta', '20'],
    ]);
  });

  it('honors CSV quoting: delimiter and quotes inside a field', () => {
    expect(parseClipboardRows('1,"Smith, John","say ""hi"""')).toEqual([
      ['1', 'Smith, John', 'say "hi"'],
    ]);
  });

  it('prefers tab when both are present (a comma inside a TSV cell is literal)', () => {
    expect(parseClipboardRows('1\tSmith, John\t10')).toEqual([['1', 'Smith, John', '10']]);
  });

  it('handles trailing newline and blank input', () => {
    expect(parseClipboardRows('a,b\n')).toEqual([['a', 'b']]);
    expect(parseClipboardRows('')).toEqual([]);
    expect(parseClipboardRows('\n')).toEqual([]);
  });

  it('keeps empty cells', () => {
    expect(parseClipboardRows('1,,3')).toEqual([['1', '', '3']]);
  });
});
