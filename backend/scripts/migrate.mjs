#!/usr/bin/env node
// Applies src/db/migrations/*.sql that are not yet recorded in _migrations.
//   node scripts/migrate.mjs           remote D1
//   node scripts/migrate.mjs --local   local D1 (wrangler dev)
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const DB = "houzs-it-hub";
const DIR = "src/db/migrations";
const target = process.argv.includes("--local") ? "--local" : "--remote";

function run(cmd, silent = false) {
  return execSync(cmd, { stdio: silent ? ["ignore", "pipe", "pipe"] : "inherit", encoding: "utf8" });
}

run(
  `npx wrangler d1 execute ${DB} ${target} --command "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"`,
  true,
);

const out = run(`npx wrangler d1 execute ${DB} ${target} --json --command "SELECT name FROM _migrations"`, true);
const applied = new Set((JSON.parse(out)?.[0]?.results ?? []).map((r) => r.name));
const pending = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .filter((f) => !applied.has(f));

if (pending.length === 0) {
  console.log(`Nothing to apply (${applied.size} tracked, ${target}).`);
  process.exit(0);
}

for (const f of pending) {
  console.log(`> ${f}`);
  run(`npx wrangler d1 execute ${DB} ${target} --file=${join(DIR, f)}`);
  run(`npx wrangler d1 execute ${DB} ${target} --command "INSERT INTO _migrations (name) VALUES ('${f}')"`, true);
}
console.log(`Applied ${pending.length} migration(s) (${target}).`);
