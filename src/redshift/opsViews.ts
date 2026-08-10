/**
 * Operational views (M3): pure analysis for three utilities.
 *  - session-lock-manager   sessions + lock blocking chains (STV_SESSIONS/STV_LOCKS)
 *  - datashare-manager      producer/consumer datashares (SVV_DATASHARES)
 *  - spectrum-browser-deep  external tables + partitions + scan bytes (SVV_EXTERNAL_*)
 * Pure/testable; panels render whatever this returns.
 */

// ---------- sessions & locks ----------
export interface SessionRow {
  pid: number;
  user: string;
  dbName: string;
  state: 'active' | 'idle' | 'idle in transaction';
  durationSec: number;
  queryText: string;
}
export interface LockRow {
  pid: number;
  /** pid that holds the lock this pid is waiting on, or null if not blocked. */
  blockedByPid: number | null;
  table: string;
  granted: boolean;
}
export interface BlockingEdge {
  blockerPid: number;
  blockedPid: number;
  table: string;
}
export interface SessionAnalysis {
  active: number;
  idleInTx: number;
  blocking: BlockingEdge[];
  longestSec: number;
}

export function analyzeSessions(sessions: readonly SessionRow[], locks: readonly LockRow[]): SessionAnalysis {
  const blocking: BlockingEdge[] = locks
    .filter((l) => l.blockedByPid !== null && !l.granted)
    .map((l) => ({ blockerPid: l.blockedByPid as number, blockedPid: l.pid, table: l.table }));
  return {
    active: sessions.filter((s) => s.state === 'active').length,
    idleInTx: sessions.filter((s) => s.state === 'idle in transaction').length,
    blocking,
    longestSec: sessions.reduce((m, s) => Math.max(m, s.durationSec), 0),
  };
}

// ---------- datashares ----------
export interface DatashareRow {
  shareName: string;
  shareType: 'outbound' | 'inbound';
  producerAccount: string;
  producerNamespace: string;
  objectCount: number;
}
export interface DatashareSummary {
  outbound: DatashareRow[];
  inbound: DatashareRow[];
  totalObjects: number;
}

export function summarizeDatashares(rows: readonly DatashareRow[]): DatashareSummary {
  return {
    outbound: rows.filter((r) => r.shareType === 'outbound'),
    inbound: rows.filter((r) => r.shareType === 'inbound'),
    totalObjects: rows.reduce((a, r) => a + r.objectCount, 0),
  };
}

// ---------- spectrum ----------
export interface ExternalTableRow {
  schema: string;
  table: string;
  location: string;
  format: string;
  partitionKeys: string[];
  partitionCount: number;
  /** Bytes scanned by recent queries (Spectrum billing driver). */
  scannedBytes: number;
}
export interface SpectrumSummary {
  tables: number;
  totalPartitions: number;
  totalScannedBytes: number;
  unpartitioned: ExternalTableRow[]; // full-scan risk
}

export function summarizeSpectrum(rows: readonly ExternalTableRow[]): SpectrumSummary {
  return {
    tables: rows.length,
    totalPartitions: rows.reduce((a, r) => a + r.partitionCount, 0),
    totalScannedBytes: rows.reduce((a, r) => a + r.scannedBytes, 0),
    unpartitioned: rows.filter((r) => r.partitionKeys.length === 0),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}
