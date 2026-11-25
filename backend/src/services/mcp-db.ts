// A small D1-style adapter (prepare / bind / first / all / run) over postgres-js,
// so the AI Connector's store reads the same as its siblings in the other ERPs.
// `?` placeholders become $1, $2, … ; values are always sent as parameters.
import postgres from "postgres";
import type { Env } from "../types";

export type Stmt = {
  bind: (...values: unknown[]) => Stmt;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  run: () => Promise<{ count: number }>;
};
export type McpDb = { prepare: (text: string) => Stmt };

export function toPg(text: string): string {
  let n = 0;
  return text.replace(/\?/g, () => `$${++n}`);
}

export function mcpDb(env: Env): McpDb {
  const sql = postgres(env.HYPERDRIVE.connectionString, { max: 2, fetch_types: false });
  return {
    prepare(text: string): Stmt {
      let params: unknown[] = [];
      const exec = () => sql.unsafe(toPg(text), params as never[]);
      const stmt: Stmt = {
        bind: (...values) => {
          params = values;
          return stmt;
        },
        first: async <T,>() => ((await exec())[0] as T | undefined) ?? null,
        all: async <T,>() => ({ results: [...(await exec())] as T[] }),
        run: async () => ({ count: (await exec()).count }),
      };
      return stmt;
    },
  };
}
