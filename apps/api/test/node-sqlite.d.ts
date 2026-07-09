declare module 'node:sqlite' {
  export type StatementResultingChanges = {
    changes: number;
    lastInsertRowid: number | bigint;
  };

  export type StatementSync = {
    run: (...params: unknown[]) => StatementResultingChanges;
    get: (...params: unknown[]) => Record<string, unknown> | undefined;
    all: (...params: unknown[]) => Array<Record<string, unknown>>;
  };

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
