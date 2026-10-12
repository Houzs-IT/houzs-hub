#!/usr/bin/env node
// Applies src/db/migrations/*.sql that are not yet recorded in _migrations,
// each in its own transaction, against DATABASE_URL.
//   node scripts/migrate.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { connect } from "./db.mjs";

const DIR = "src/db/migrations";
const { sql, target } = connect();

try {
  await sql`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  await sql`ALTER TABLE _migrations ENABLE ROW LEVEL SECURITY`;

  const applied = new Set((await sql`SELECT name FROM _migrations`).map((r) => r.name));
  const pending = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log(`Nothing to apply (${applied.size} tracked, ${target}).`);
  } else {
    for (const f of pending) {
      console.log(`> ${f}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(readFileSync(join(DIR, f), "utf8"));
        await tx`INSERT INTO _migrations (name) VALUES (${f})`;
      });
    }
    console.log(`Applied ${pending.length} migration(s) (${target}).`);
  }
} finally {
  await sql.end();
}
