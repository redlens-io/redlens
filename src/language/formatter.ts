import { format } from 'sql-formatter';

/**
 * SQL formatting (M2 `sql-formatting`) with the Redshift dialect. Pure wrapper
 * over sql-formatter so config lives in one place and is unit-tested.
 */
export interface FormatConfig {
  tabWidth?: number;
  keywordCase?: 'upper' | 'lower' | 'preserve';
}

export function formatSql(sql: string, config: FormatConfig = {}): string {
  return format(sql, {
    language: 'redshift',
    tabWidth: config.tabWidth ?? 2,
    keywordCase: config.keywordCase ?? 'upper',
    linesBetweenQueries: 1,
  });
}
