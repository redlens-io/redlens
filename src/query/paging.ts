/**
 * In-memory page slicing for buffered query results (Fase A1).
 * Replaced by cursor/token streaming when the virtualized grid lands (A2) —
 * the token contract is already shaped like the Data API's NextToken so the
 * grid never needs to know which transport produced the rows.
 */
export interface PageSlice<T> {
  items: T[];
  /** Opaque continuation token; undefined when this is the last page. */
  nextToken?: string;
}

export const DEFAULT_PAGE_SIZE = 500;

export function slicePage<T>(all: readonly T[], token: string | undefined, pageSize: number = DEFAULT_PAGE_SIZE): PageSlice<T> {
  if (pageSize <= 0) {
    throw new RangeError(`pageSize must be positive, got ${pageSize}`);
  }
  const start = token === undefined ? 0 : Number.parseInt(token, 10);
  if (Number.isNaN(start) || start < 0) {
    throw new RangeError(`invalid page token: ${String(token)}`);
  }
  const end = Math.min(start + pageSize, all.length);
  const items = all.slice(start, end);
  return end < all.length ? { items, nextToken: String(end) } : { items };
}
