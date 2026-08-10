import type { MementoLike } from './history';

/** A named, saved SQL query (M2 `saved-queries` — bookmarks). */
export interface SavedQuery {
  name: string;
  sql: string;
  at: string; // ISO
}

const KEY = 'redlens.savedQueries';

/** Bookmarks library backed by globalState. Names are unique (upsert by name). */
export class SavedQueries {
  constructor(private readonly memento: MementoLike) {}

  list(): SavedQuery[] {
    return [...this.memento.get<SavedQuery[]>(KEY, [])].sort((a, b) => a.name.localeCompare(b.name));
  }

  async save(name: string, sql: string, at: string): Promise<void> {
    const rest = this.list().filter((q) => q.name !== name);
    await this.memento.update(KEY, [...rest, { name, sql, at }]);
  }

  async remove(name: string): Promise<void> {
    await this.memento.update(KEY, this.list().filter((q) => q.name !== name));
  }
}
