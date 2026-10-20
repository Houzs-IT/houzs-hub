#!/usr/bin/env node
// One-shot import of the Ownership tab of the API card register sheet into the
// Accounts page, against DATABASE_URL. Dry run unless --apply.
//   node scripts/import-accounts.mjs <file.tsv>            prints what would be imported
//   node scripts/import-accounts.mjs <file.tsv> --apply    writes it
// Input: the tab's account list copied as TSV with its header row: Account, Company,
// Vendor, Main owner, Who has control, it@ access, Moved to it@?, Bills go to,
// Register rows, Next step. A row whose Account name is already in the hub is
// skipped, so a re-run adds only new rows.
import { readFileSync } from "node:fs";
import { connect } from "./db.mjs";

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("--"));
const apply = argv.includes("--apply");
if (!file) {
  console.error("Usage: node scripts/import-accounts.mjs <file.tsv> [--apply]");
  process.exit(1);
}

const COLUMNS = {
  Account: "name",
  Company: "companies",
  Vendor: "vendor",
  "Main owner": "main_owner",
  "Who has control": "control",
  "it@ access": "it_access",
  "Moved to it@?": "status",
  "Bills go to": "bills_to",
  "Register rows": "register_ids",
  "Next step": "next_step",
};
const STATUS = { yes: "yes", moved: "yes", partly: "partly", "not yet": "not_yet", "can't move": "cant_move", "cant move": "cant_move" };

const lines = readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
const header = lines.shift().split("\t").map((h) => h.trim());
const missing = Object.keys(COLUMNS).filter((h) => !header.includes(h));
if (missing.length) {
  console.error(`Header is missing: ${missing.join(", ")}`);
  process.exit(1);
}

const rows = [];
for (const [n, line] of lines.entries()) {
  const cells = line.split("\t");
  const row = {};
  for (const [h, col] of Object.entries(COLUMNS)) row[col] = (cells[header.indexOf(h)] ?? "").trim();
  if (!row.name) continue;
  const status = STATUS[row.status.toLowerCase()];
  if (!status) {
    console.error(`Line ${n + 2}: unknown "Moved to it@?" value "${row.status}"`);
    process.exit(1);
  }
  rows.push({ ...row, status });
}

const { sql, target } = connect();
try {
  const existing = new Set((await sql`SELECT name FROM accounts`).map((r) => r.name));
  const fresh = rows.filter((r) => !existing.has(r.name));
  for (const r of fresh) console.log(`+ ${r.name} [${r.status}]`);
  console.log(`${fresh.length} to add, ${rows.length - fresh.length} already there (${target}).`);
  if (!apply) {
    console.log("Dry run. Add --apply to write.");
  } else if (fresh.length) {
    const now = new Date().toISOString();
    await sql`INSERT INTO accounts ${sql(fresh.map((r) => ({ ...r, created_at: now, updated_at: now, updated_by: "Import from sheet" })))}`;
    console.log(`Imported ${fresh.length} account(s).`);
  }
} finally {
  await sql.end();
}
