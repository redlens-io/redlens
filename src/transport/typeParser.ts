/**
 * The Redshift Data API returns every value as a string (JDBC-style typing);
 * clients must re-parse using ColumnMetadata.typeName (PLAN §5.1). This module
 * is the single place where that mapping lives, shared by all transports.
 */
export type RedshiftTypeCategory =
  | 'number'
  | 'boolean'
  | 'string'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'json'
  | 'binary';

const TYPE_MAP: Record<string, RedshiftTypeCategory> = {
  int2: 'number',
  int4: 'number',
  int8: 'number',
  float4: 'number',
  float8: 'number',
  numeric: 'number',
  bool: 'boolean',
  varchar: 'string',
  char: 'string',
  bpchar: 'string',
  text: 'string',
  name: 'string',
  date: 'date',
  time: 'time',
  timetz: 'time',
  timestamp: 'timestamp',
  timestamptz: 'timestamp',
  super: 'json',
  varbyte: 'binary',
  geometry: 'binary',
  geography: 'binary',
};

export function categorizeTypeName(typeName: string): RedshiftTypeCategory {
  return TYPE_MAP[typeName.toLowerCase()] ?? 'string';
}

/**
 * Converts a raw Data API string value into a JS value for the grid/MCP layer.
 * int8/numeric beyond Number.MAX_SAFE_INTEGER stay as strings to avoid silent
 * precision loss. Dates/times stay as strings (rendering is the grid's job).
 */
export function parseValue(raw: string | null, category: RedshiftTypeCategory): unknown {
  if (raw === null) {
    return null;
  }
  switch (category) {
    case 'number': {
      if (/^-?\d+$/.test(raw)) {
        const n = Number(raw);
        return Number.isSafeInteger(n) ? n : raw;
      }
      const f = Number(raw);
      return Number.isNaN(f) ? raw : f;
    }
    case 'boolean':
      return raw === 'true' || raw === 't';
    case 'json':
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return raw;
      }
    default:
      return raw;
  }
}
