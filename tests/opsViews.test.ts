import { describe, expect, it } from 'vitest';
import { analyzeSessions, summarizeDatashares, summarizeSpectrum, formatBytes } from '../src/redshift/opsViews';
import { DEMO_DATASHARES, DEMO_EXTERNAL_TABLES, DEMO_LOCKS, DEMO_SESSIONS } from '../src/redshift/opsFixtures';

describe('analyzeSessions', () => {
  it('counts states and finds blocking chains', () => {
    const a = analyzeSessions(DEMO_SESSIONS, DEMO_LOCKS);
    expect(a.active).toBe(2);
    expect(a.idleInTx).toBe(1);
    expect(a.blocking).toEqual([{ blockerPid: 1202, blockedPid: 1203, table: 'tickit.event' }]);
    expect(a.longestSec).toBe(610);
  });

  it('reports no blocking when all locks are granted', () => {
    expect(analyzeSessions(DEMO_SESSIONS, DEMO_LOCKS.map((l) => ({ ...l, granted: true }))).blocking).toEqual([]);
  });
});

describe('summarizeDatashares', () => {
  it('splits inbound/outbound and totals objects', () => {
    const s = summarizeDatashares(DEMO_DATASHARES);
    expect(s.outbound.map((x) => x.shareName)).toEqual(['sales_share']);
    expect(s.inbound.map((x) => x.shareName)).toEqual(['marketing_inbound']);
    expect(s.totalObjects).toBe(6);
  });
});

describe('summarizeSpectrum', () => {
  it('totals partitions/bytes and flags unpartitioned tables', () => {
    const s = summarizeSpectrum(DEMO_EXTERNAL_TABLES);
    expect(s.tables).toBe(2);
    expect(s.totalPartitions).toBe(365);
    expect(s.unpartitioned.map((t) => t.table)).toEqual(['raw_events']);
    expect(s.totalScannedBytes).toBe(4_800_000_000 + 42_000_000_000);
  });
});

describe('formatBytes', () => {
  it('formats human-readable sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(4_800_000_000)).toMatch(/GB$/);
    expect(formatBytes(42_000_000_000)).toMatch(/GB$/);
  });
});
