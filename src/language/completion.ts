/** Pure suggestion engine — vscode-free so it unit-tests cleanly. */

export interface CompletionCache {
  schemas: string[];
  tables: (schema: string) => { name: string; kind: string }[];
  columns: (schema: string, table: string) => { name: string; typeName: string }[];
}

export interface Suggestion {
  label: string;
  kind: 'schema' | 'table' | 'column' | 'keyword' | 'function';
  detail?: string;
}

export const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
  'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL OUTER JOIN', 'CROSS JOIN', 'ON',
  'AS', 'AND', 'OR', 'NOT', 'IN', 'IS NULL', 'IS NOT NULL', 'BETWEEN', 'LIKE', 'ILIKE',
  'DISTINCT', 'UNION', 'UNION ALL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH',
  'INSERT INTO', 'UPDATE', 'DELETE FROM', 'CREATE TABLE', 'CREATE VIEW', 'DROP TABLE',
  'DISTKEY', 'SORTKEY', 'DISTSTYLE', 'ENCODE', 'UNLOAD', 'COPY', 'VACUUM', 'ANALYZE',
];

export const SQL_FUNCTIONS = [
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NVL', 'NULLIF', 'GREATEST', 'LEAST',
  'GETDATE', 'DATEADD', 'DATEDIFF', 'DATE_TRUNC', 'EXTRACT', 'TO_CHAR', 'TO_DATE',
  'LISTAGG', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD', 'SPLIT_PART', 'SUBSTRING',
  'UPPER', 'LOWER', 'TRIM', 'LEN', 'REPLACE', 'REGEXP_REPLACE', 'JSON_EXTRACT_PATH_TEXT',
];

const QUALIFIER_RE = /([A-Za-z_][\w$]*)\.(?:[A-Za-z_][\w$]*)?$/;
const ALIAS_RE = /\b(?:FROM|JOIN)\s+(?:([a-zA-Z_]\w*)\.)?([a-zA-Z_]\w*)(?:\s+(?:AS\s+)?([a-zA-Z_]\w*))?/gi;

export interface TableAlias {
  alias: string;
  schema?: string;
  table: string;
}

export type IntrospectionLevel = 'names' | 'full';

/** How many schemas to eagerly prefetch tables for (introspection-levels). */
export function introspectionPlan(level: IntrospectionLevel): { prefetchSchemas: number } {
  return { prefetchSchemas: level === 'full' ? 5 : 0 };
}

/** Parses FROM/JOIN clauses so `alias.` suggests the aliased table's columns. */
export function parseAliases(sql: string): TableAlias[] {
  const aliases: TableAlias[] = [];
  for (const m of sql.matchAll(ALIAS_RE)) {
    const schema = m[1];
    const table = m[2] ?? '';
    const explicit = m[3];
    const kw = new Set(['where', 'on', 'group', 'order', 'limit', 'join', 'inner', 'left', 'right', 'full', 'cross', 'using', 'as']);
    if (explicit !== undefined && !kw.has(explicit.toLowerCase())) {
      aliases.push({ alias: explicit, schema, table });
    }
    aliases.push({ alias: table, schema, table }); // the table name works as a qualifier too
  }
  return aliases;
}

/**
 * `schema.` → tables of that schema; `alias.`/`table.` → its columns (via the
 * FROM/JOIN aliases and loaded schemas); otherwise schemas + tables + keywords.
 */
export function computeSuggestions(linePrefix: string, cache: CompletionCache, aliases: TableAlias[] = []): Suggestion[] {
  const qualified = QUALIFIER_RE.exec(linePrefix);
  if (qualified !== null) {
    const qualifier = qualified[1] ?? '';
    if (cache.schemas.includes(qualifier)) {
      return cache.tables(qualifier).map((t) => ({ label: t.name, kind: 'table', detail: t.kind }));
    }
    // Resolve an alias first (aliases win over bare table names).
    const alias = aliases.find((a) => a.alias === qualifier);
    if (alias !== undefined) {
      const schema = alias.schema ?? cache.schemas.find((s) => cache.tables(s).some((t) => t.name === alias.table));
      if (schema !== undefined) {
        return cache.columns(schema, alias.table).map((c) => ({ label: c.name, kind: 'column', detail: c.typeName }));
      }
    }
    for (const schema of cache.schemas) {
      const table = cache.tables(schema).find((t) => t.name === qualifier);
      if (table !== undefined) {
        return cache.columns(schema, table.name).map((c) => ({ label: c.name, kind: 'column', detail: c.typeName }));
      }
    }
    return [];
  }

  const suggestions: Suggestion[] = cache.schemas.map((s) => ({ label: s, kind: 'schema' as const }));
  for (const schema of cache.schemas) {
    for (const t of cache.tables(schema)) {
      suggestions.push({ label: t.name, kind: 'table', detail: `${schema}.${t.name}` });
    }
  }
  suggestions.push(...SQL_KEYWORDS.map((k) => ({ label: k, kind: 'keyword' as const })));
  suggestions.push(...SQL_FUNCTIONS.map((f) => ({ label: f, kind: 'function' as const })));
  return suggestions;
}
