import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sanitizeEvent, NEVER_SENT } from '../src/telemetry/events';

/**
 * The allowlist is the whole security argument for telemetry in a database tool
 * (S6), so it is tested as a boundary and not as a formatter. Each case below is
 * a way customer data could realistically get into a payload.
 */

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  contributes: { commands: { command: string }[] };
};
const KNOWN = new Set(pkg.contributes.commands.map((c) => c.command));

describe('telemetry allowlist', () => {
  it('accepts the two declared events', () => {
    expect(sanitizeEvent('activate', undefined, KNOWN)).toEqual({ name: 'activate', properties: {} });
    expect(sanitizeEvent('command', { id: 'redlens.runQuery' }, KNOWN)).toEqual({
      name: 'command',
      properties: { id: 'redlens.runQuery' },
    });
  });

  it('drops an event nobody declared', () => {
    expect(sanitizeEvent('queryFailed', { sql: 'SELECT 1' }, KNOWN)).toBeUndefined();
  });

  it('drops a command id that is not ours', () => {
    // The single field that exists must not become a free-text channel.
    expect(sanitizeEvent('command', { id: 'SELECT * FROM customers' }, KNOWN)).toBeUndefined();
    expect(sanitizeEvent('command', { id: 'workbench.action.files.save' }, KNOWN)).toBeUndefined();
  });

  it('drops the whole event when an extra property rides along', () => {
    // Trimming instead of dropping would silently ship a partial leak; failing
    // outright makes it a test failure at the moment the field is added.
    expect(sanitizeEvent('command', { id: 'redlens.runQuery', sql: 'SELECT 1' }, KNOWN)).toBeUndefined();
    expect(sanitizeEvent('activate', { error: 'relation "customers" does not exist' }, KNOWN)).toBeUndefined();
  });

  it('rejects the error-message shape specifically', () => {
    // The realistic leak in a database tool: a Redshift error carries table
    // names and sometimes values inside the string.
    expect(sanitizeEvent('command', { id: 'redlens.runQuery', message: 'x' }, KNOWN)).toBeUndefined();
    expect(sanitizeEvent('error' as unknown as string, { code: '42P01' }, KNOWN)).toBeUndefined();
  });

  it('rejects non-string values instead of coercing them', () => {
    for (const bogus of [null, 42, {}, ['redlens.runQuery'], true, undefined]) {
      expect(sanitizeEvent('command', { id: bogus }, KNOWN), String(bogus)).toBeUndefined();
    }
  });

  it('every command id in the manifest is emittable', () => {
    // Guards the guard: if KNOWN were empty, every assertion above would pass
    // for the wrong reason.
    expect(KNOWN.size).toBeGreaterThan(50);
    for (const id of KNOWN) {
      expect(sanitizeEvent('command', { id }, KNOWN), id).toBeDefined();
    }
  });

  it('documents what is never sent, for the README and SECURITY.md', () => {
    expect(NEVER_SENT).toContain('SQL text');
    expect(NEVER_SENT).toContain('error messages');
  });
});
