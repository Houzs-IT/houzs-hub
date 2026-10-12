import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Env } from "../types";
import * as schema from "./schema";

// A Worker cannot keep a socket across requests, so each call opens its own
// lazy client; Hyperdrive holds the real pool to Supabase. fetch_types is off
// because it costs a round trip per connection and no query here needs it.
export function getDb(env: Env) {
  const client = postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  return drizzle(client, { schema });
}

export type DB = ReturnType<typeof getDb>;
export { schema };
