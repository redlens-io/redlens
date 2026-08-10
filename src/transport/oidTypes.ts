/**
 * Maps Postgres/Redshift wire-protocol type OIDs to human-readable type names.
 * Used by PgWireTransport to fill ColumnInfo.typeName (the Data API returns
 * type names directly, so both transports converge on the same ColumnInfo).
 */
const OID_TO_TYPENAME: Record<number, string> = {
  16: 'bool',
  20: 'int8',
  21: 'int2',
  23: 'int4',
  25: 'text',
  114: 'json',
  700: 'float4',
  701: 'float8',
  1042: 'bpchar',
  1043: 'varchar',
  1082: 'date',
  1083: 'time',
  1114: 'timestamp',
  1184: 'timestamptz',
  1266: 'timetz',
  1700: 'numeric',
  3802: 'jsonb',
};

export function typeNameForOid(oid: number): string {
  return OID_TO_TYPENAME[oid] ?? `oid:${oid}`;
}
