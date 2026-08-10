import { describe, expect, it } from 'vitest';
import { categorizeTypeName, parseValue } from '../src/transport/typeParser';

describe('categorizeTypeName', () => {
  it('maps core Redshift numeric types', () => {
    expect(categorizeTypeName('int2')).toBe('number');
    expect(categorizeTypeName('INT8')).toBe('number');
    expect(categorizeTypeName('numeric')).toBe('number');
    expect(categorizeTypeName('float8')).toBe('number');
  });

  it('maps Redshift-specific types', () => {
    expect(categorizeTypeName('super')).toBe('json');
    expect(categorizeTypeName('varbyte')).toBe('binary');
    expect(categorizeTypeName('timestamptz')).toBe('timestamp');
  });

  it('falls back to string for unknown types', () => {
    expect(categorizeTypeName('some_future_type')).toBe('string');
  });
});

describe('parseValue', () => {
  it('returns null for SQL NULL', () => {
    expect(parseValue(null, 'number')).toBeNull();
  });

  it('parses safe integers and floats', () => {
    expect(parseValue('42', 'number')).toBe(42);
    expect(parseValue('-7', 'number')).toBe(-7);
    expect(parseValue('3.14', 'number')).toBeCloseTo(3.14);
  });

  it('keeps int8 values beyond MAX_SAFE_INTEGER as strings (no precision loss)', () => {
    const big = '9223372036854775807'; // int8 max
    expect(parseValue(big, 'number')).toBe(big);
  });

  it('parses booleans in both Redshift spellings', () => {
    expect(parseValue('true', 'boolean')).toBe(true);
    expect(parseValue('t', 'boolean')).toBe(true);
    expect(parseValue('f', 'boolean')).toBe(false);
  });

  it('parses SUPER as JSON and falls back to raw on invalid JSON', () => {
    expect(parseValue('{"a":1}', 'json')).toEqual({ a: 1 });
    expect(parseValue('not-json', 'json')).toBe('not-json');
  });

  it('leaves timestamps as strings for the grid to render', () => {
    expect(parseValue('2026-07-21 12:00:00', 'timestamp')).toBe('2026-07-21 12:00:00');
  });
});
