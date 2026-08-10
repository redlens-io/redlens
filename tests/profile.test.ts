import { describe, expect, it } from 'vitest';
import { newProfileId, secretKeyForProfile, validateProfile, COMPAT_DEFAULTS } from '../src/connections/profile';
import { typeNameForOid } from '../src/transport/oidTypes';

describe('COMPAT_DEFAULTS (UXD-010)', () => {
  it('point at loopback, never a private/author-specific host', () => {
    expect(['127.0.0.1', 'localhost', '::1']).toContain(COMPAT_DEFAULTS.host);
    // Guard against a regression to the VM Lab IP or any non-loopback default.
    expect(COMPAT_DEFAULTS.host).not.toMatch(/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\./);
  });
});

describe('validateProfile', () => {
  const valid = {
    id: 'p1',
    name: 'test',
    kind: 'compat' as const,
    host: 'localhost',
    port: 15439,
    database: 'redlens',
    username: 'redlens',
    ssl: false,
  };

  it('accepts a complete profile', () => {
    expect(validateProfile(valid)).toHaveLength(0);
  });

  it('flags every missing/invalid field with its own message', () => {
    const errors = validateProfile({ ...valid, name: ' ', host: '', port: 70000, database: '', username: '' });
    const fields = errors.map((e) => e.field).sort();
    expect(fields).toEqual(['database', 'host', 'name', 'port', 'username']);
  });
});

describe('profile ids and secret keys', () => {
  it('generates unique ids with a stable secret-key scheme', () => {
    const a = newProfileId();
    const b = newProfileId();
    expect(a).not.toBe(b);
    expect(secretKeyForProfile(a)).toBe(`redlens.password.${a}`);
  });
});

describe('typeNameForOid', () => {
  it('maps common OIDs and falls back verbosely', () => {
    expect(typeNameForOid(23)).toBe('int4');
    expect(typeNameForOid(1184)).toBe('timestamptz');
    expect(typeNameForOid(999999)).toBe('oid:999999');
  });
});
