import type { DatashareRow, ExternalTableRow, LockRow, SessionRow } from './opsViews';

/** Demo fixtures (M3): STV_SESSIONS/STV_LOCKS, SVV_DATASHARES, SVV_EXTERNAL_*. */
export const DEMO_SESSIONS: SessionRow[] = [
  { pid: 1201, user: 'etl', dbName: 'dev', state: 'active', durationSec: 42, queryText: 'INSERT INTO tickit.sales SELECT ...' },
  { pid: 1202, user: 'analyst', dbName: 'dev', state: 'idle in transaction', durationSec: 610, queryText: 'BEGIN; UPDATE tickit.event ...' },
  { pid: 1203, user: 'bi_service', dbName: 'dev', state: 'active', durationSec: 8, queryText: 'SELECT * FROM tickit.listing WHERE ...' },
  { pid: 1204, user: 'analyst', dbName: 'dev', state: 'idle', durationSec: 3, queryText: '' },
];

export const DEMO_LOCKS: LockRow[] = [
  // 1203 is blocked by 1202 (the idle-in-transaction session) on tickit.event.
  { pid: 1203, blockedByPid: 1202, table: 'tickit.event', granted: false },
  { pid: 1202, blockedByPid: null, table: 'tickit.event', granted: true },
];

export const DEMO_DATASHARES: DatashareRow[] = [
  { shareName: 'sales_share', shareType: 'outbound', producerAccount: '123456789012', producerNamespace: 'prod-ns', objectCount: 4 },
  { shareName: 'marketing_inbound', shareType: 'inbound', producerAccount: '210987654321', producerNamespace: 'mkt-ns', objectCount: 2 },
];

export const DEMO_EXTERNAL_TABLES: ExternalTableRow[] = [
  { schema: 'spectrum_demo', table: 'clickstream_ext', location: 's3://datalake/clickstream/', format: 'parquet', partitionKeys: ['dt'], partitionCount: 365, scannedBytes: 4_800_000_000 },
  { schema: 'spectrum_demo', table: 'raw_events', location: 's3://datalake/raw/', format: 'json', partitionKeys: [], partitionCount: 0, scannedBytes: 42_000_000_000 },
];
