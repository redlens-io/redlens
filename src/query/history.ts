export interface HistoryEntry {
  sql: string;
  connectionName: string;
  rowCount: number;
  durationMs: number;
  at: string; // ISO timestamp
}

export const HISTORY_LIMIT = 100;

export interface MementoLike {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

const KEY = 'redlens.queryHistory';

/** Ring buffer over globalState — newest first, deduplicated by SQL text. */
export class QueryHistory {
  constructor(private readonly memento: MementoLike) {}

  list(): HistoryEntry[] {
    return this.memento.get<HistoryEntry[]>(KEY, []);
  }

  async add(entry: HistoryEntry): Promise<void> {
    const rest = this.list().filter((e) => e.sql !== entry.sql);
    await this.memento.update(KEY, [entry, ...rest].slice(0, HISTORY_LIMIT));
  }

  async clear(): Promise<void> {
    await this.memento.update(KEY, []);
  }
}
