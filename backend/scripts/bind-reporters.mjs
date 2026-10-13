#!/usr/bin/env node
// Binds tickets imported from the Google Form (reporter_external_id "sheet:<name>")
// to the reporter's real user id in the reporting system, so they show under that
// person's own tickets there. Against DATABASE_URL. Dry run unless --apply.
//   node scripts/bind-reporters.mjs HK <map.tsv> [--apply]
// map.tsv, one line per Form name, tab separated, no header:
//   <name as in the Form>  <user id in that system>  [display name to show, optional]
// Several Form spellings ("Lim", "Lim Wei Siang") can map to the same user id.
import { readFileSync } from "node:fs";
import { connect } from "./db.mjs";

const [system, file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const apply = process.argv.includes("--apply");
if (!system || !file) {
  console.error("Usage: node scripts/bind-reporters.mjs <SYSTEM_CODE> <map.tsv> [--apply]");
  process.exit(1);
}

const map = readFileSync(file, "utf8")
  .split(/\r?\n/)
  .map((l) => l.split("\t").map((c) => c.trim()))
  .filter(([name, id]) => name && id)
  .map(([name, id, display]) => ({ key: `sheet:${name.replace(/\s+/g, " ").toLowerCase()}`, id, display: display || null }));

const { sql, target } = connect();
try {
  const rows = await sql`
    SELECT reporter_external_id AS key, count(*)::int AS n FROM tickets
    WHERE system_code = ${system} AND reporter_external_id LIKE 'sheet:%' GROUP BY 1 ORDER BY 2 DESC`;
  const mapped = new Map(map.map((m) => [m.key, m]));
  console.log(`Target ${target}, system ${system}:`);
  for (const r of rows) {
    const m = mapped.get(r.key);
    console.log(`  ${r.key.padEnd(22)} ${String(r.n).padStart(3)} tickets  ${m ? `-> ${m.id}${m.display ? ` (${m.display})` : ""}` : "NOT MAPPED, left as is"}`);
  }
  for (const m of map) if (!rows.some((r) => r.key === m.key)) console.log(`  map line ${m.key} matches no ticket`);

  if (!apply) { console.log("\nDry run. Add --apply to write."); process.exit(0); }

  const n = await sql.begin(async (tx) => {
    let total = 0;
    for (const m of map) {
      const res = await tx`
        UPDATE tickets SET reporter_external_id = ${m.id}, reporter_name = COALESCE(${m.display}, reporter_name)
        WHERE system_code = ${system} AND reporter_external_id = ${m.key}`;
      total += res.count;
    }
    return total;
  });
  console.log(`\nBound ${n} tickets.`);
} finally {
  await sql.end();
}
