import type { ColumnInfo } from '../transport/types';
import type { ColumnMeta, ForeignKey, MetadataSource, TableInfo } from '../metadata/types';

/**
 * Demo-mode fixtures (PLAN §5.1 DemoTransport): a miniature of AWS's tickit
 * sample warehouse. Deterministic data — no randomness, so screenshots and
 * docs stay reproducible. SYS views and EXPLAIN fixtures for dashboards land in A4.
 */
export interface FixtureTable {
  schema: string;
  name: string;
  kind: TableInfo['kind'];
  columns: { name: string; typeName: string; nullable: boolean }[];
  rows: unknown[][];
}

const CITIES = ['Austin', 'Denver', 'Seattle', 'Chicago', 'Boston', 'Portland', 'Atlanta', 'Dallas'];
const STATES = ['TX', 'CO', 'WA', 'IL', 'MA', 'OR', 'GA', 'TX'];

function usersRows(): unknown[][] {
  return Array.from({ length: 24 }, (_, i) => {
    const handle = `user${String(i + 1).padStart(2, '0')}`;
    return [
      i + 1,
      handle,
      `${handle}@example.com`,
      `555-01${String(i + 1).padStart(2, '0')}`,
      CITIES[i % CITIES.length],
      STATES[i % STATES.length],
    ];
  });
}

function venueRows(): unknown[][] {
  return Array.from({ length: 8 }, (_, i) => [
    i + 1,
    `${CITIES[i % CITIES.length]} Arena`,
    CITIES[i % CITIES.length],
    10000 + i * 2500,
  ]);
}

// A prior snapshot of `venue`, for the result-run-compare demo: same shape,
// venueid 3 has a different seat count (changed), venueid 8 is absent (so it is
// "added" in the current venue), and venueid 99 no longer exists (removed).
function venueLastWeekRows(): unknown[][] {
  const rows = Array.from({ length: 7 }, (_, i) => [
    i + 1,
    `${CITIES[i % CITIES.length]} Arena`,
    CITIES[i % CITIES.length],
    10000 + i * 2500,
  ]);
  rows[2]![3] = 99999; // venueid 3 seat count changed
  rows.push([99, 'Old Stadium', 'Nowhere', 5000]); // removed since
  return rows;
}

function eventRows(): unknown[][] {
  return Array.from({ length: 16 }, (_, i) => [
    i + 1,
    (i % 8) + 1,
    `Concert ${String.fromCharCode(65 + i)}`,
    `2026-0${(i % 8) + 1}-1${i % 10} 20:00:00`,
  ]);
}

function salesRows(): unknown[][] {
  return Array.from({ length: 40 }, (_, i) => [
    i + 1,
    (i % 16) + 1,
    (i % 4) + 1,
    Number(((i % 9) * 37.5 + 25).toFixed(2)),
    `2026-0${(i % 8) + 1}-2${i % 10} 1${i % 10}:30:00`,
  ]);
}

export const FIXTURE_TABLES: FixtureTable[] = [
  {
    schema: 'tickit',
    name: 'users',
    kind: 'table',
    columns: [
      { name: 'userid', typeName: 'int4', nullable: false },
      { name: 'username', typeName: 'varchar', nullable: false },
      { name: 'email', typeName: 'varchar', nullable: true },
      { name: 'phone', typeName: 'varchar', nullable: true },
      { name: 'city', typeName: 'varchar', nullable: true },
      { name: 'state', typeName: 'bpchar', nullable: true },
    ],
    rows: usersRows(),
  },
  {
    schema: 'tickit',
    name: 'venue',
    kind: 'table',
    columns: [
      { name: 'venueid', typeName: 'int4', nullable: false },
      { name: 'venuename', typeName: 'varchar', nullable: false },
      { name: 'venuecity', typeName: 'varchar', nullable: true },
      { name: 'venueseats', typeName: 'int4', nullable: true },
    ],
    rows: venueRows(),
  },
  {
    schema: 'tickit',
    name: 'venue_last_week',
    kind: 'table',
    columns: [
      { name: 'venueid', typeName: 'int4', nullable: false },
      { name: 'venuename', typeName: 'varchar', nullable: false },
      { name: 'venuecity', typeName: 'varchar', nullable: true },
      { name: 'venueseats', typeName: 'int4', nullable: true },
    ],
    rows: venueLastWeekRows(),
  },
  {
    schema: 'tickit',
    name: 'event',
    kind: 'table',
    columns: [
      { name: 'eventid', typeName: 'int4', nullable: false },
      { name: 'venueid', typeName: 'int4', nullable: false },
      { name: 'eventname', typeName: 'varchar', nullable: false },
      { name: 'starttime', typeName: 'timestamp', nullable: true },
    ],
    rows: eventRows(),
  },
  {
    schema: 'tickit',
    name: 'sales',
    kind: 'table',
    columns: [
      { name: 'salesid', typeName: 'int4', nullable: false },
      { name: 'eventid', typeName: 'int4', nullable: false },
      { name: 'qtysold', typeName: 'int2', nullable: false },
      { name: 'pricepaid', typeName: 'numeric', nullable: true },
      { name: 'saletime', typeName: 'timestamp', nullable: true },
    ],
    rows: salesRows(),
  },
  {
    schema: 'spectrum_demo',
    name: 'clickstream_ext',
    kind: 'external',
    columns: [
      { name: 'event_time', typeName: 'timestamp', nullable: true },
      { name: 'url', typeName: 'varchar', nullable: true },
      { name: 'user_agent', typeName: 'varchar', nullable: true },
    ],
    rows: Array.from({ length: 12 }, (_, i) => [
      `2026-07-1${i % 10} 08:0${i % 10}:00`,
      `/products/${100 + i}`,
      i % 2 === 0 ? 'Mozilla/5.0' : 'curl/8.0',
    ]),
  },
];

export function fixtureColumnsToColumnInfo(table: FixtureTable): ColumnInfo[] {
  return table.columns.map((c) => ({ name: c.name, typeName: c.typeName, nullable: c.nullable }));
}

export class FixtureMetadataSource implements MetadataSource {
  listSchemas(): Promise<string[]> {
    return Promise.resolve([...new Set(FIXTURE_TABLES.map((t) => t.schema))].sort());
  }

  listTables(schema: string): Promise<TableInfo[]> {
    return Promise.resolve(
      FIXTURE_TABLES.filter((t) => t.schema === schema).map((t) => ({ schema: t.schema, name: t.name, kind: t.kind })),
    );
  }

  listColumns(schema: string, table: string): Promise<ColumnMeta[]> {
    const found = FIXTURE_TABLES.find((t) => t.schema === schema && t.name === table);
    return Promise.resolve(found === undefined ? [] : found.columns.map((c) => ({ ...c })));
  }

  listForeignKeys(schema: string, table: string): Promise<ForeignKey[]> {
    return Promise.resolve(FIXTURE_FKS.filter((fk) => fk.fromSchema === schema && fk.fromTable === table).map((fk) => ({
      column: fk.column,
      refSchema: fk.refSchema,
      refTable: fk.refTable,
      refColumn: fk.refColumn,
    })));
  }

  listPrimaryKey(schema: string, table: string): Promise<string[]> {
    // Fixtures name their first column as the PK (…id).
    const found = FIXTURE_TABLES.find((t) => t.schema === schema && t.name === table);
    const first = found?.columns[0]?.name;
    return Promise.resolve(first !== undefined && first.endsWith('id') ? [first] : []);
  }
}

/** Mirrors the FKs seeded in pg-compat so demo mode has FK navigation too. */
const FIXTURE_FKS = [
  { fromSchema: 'tickit', fromTable: 'sales', column: 'eventid', refSchema: 'tickit', refTable: 'event', refColumn: 'eventid' },
  { fromSchema: 'tickit', fromTable: 'event', column: 'venueid', refSchema: 'tickit', refTable: 'venue', refColumn: 'venueid' },
];
