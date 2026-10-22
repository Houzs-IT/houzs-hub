#!/usr/bin/env node
// One-shot import of the API card register sheet's Register and Cards tabs into the
// Billing page, against DATABASE_URL. Dry run unless --apply. Run import-accounts.mjs
// first, so each charge can be linked to its account by the sheet ID.
//   node scripts/import-billing.mjs --register <register.tsv> --cards <cards.tsv>
//   node scripts/import-billing.mjs --register <register.tsv> --cards <cards.tsv> --apply
// Input: each tab copied as TSV with its header row. Rows already in the hub (same
// sheet ID, or same card nickname) are skipped, so a re-run adds only new rows.
// Not imported: "Key last 4" (no part of a key is kept) and "Who holds the billing
// login" (that lives on the Accounts page). Card rows named EXAMPLE are skipped.
import { readFileSync } from "node:fs";
import { connect } from "./db.mjs";

const argv = process.argv.slice(2);
const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
const registerFile = arg("--register");
const cardsFile = arg("--cards");
const apply = argv.includes("--apply");
if (!registerFile && !cardsFile) {
  console.error("Usage: node scripts/import-billing.mjs [--register <register.tsv>] [--cards <cards.tsv>] [--apply]");
  process.exit(1);
}

function readTsv(file, required) {
  const lines = readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const header = lines.shift().split("\t").map((h) => h.trim());
  const missing = required.filter((h) => !header.includes(h));
  if (missing.length) {
    console.error(`${file}: header is missing ${missing.join(", ")}`);
    process.exit(1);
  }
  return lines.map((l) => {
    const cells = l.split("\t");
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
}

const STATUS = { confirmed: "confirmed", "to confirm": "to_confirm", "to fill in": "to_fill_in", "not active": "not_active", cancelled: "cancelled" };
const BILLED = { monthly: "monthly", yearly: "yearly", "": "" };

function day(v) {
  if (!v) return null;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const charges = registerFile
  ? readTsv(registerFile, ["ID", "Company", "System", "Vendor", "Service type", "What it is used for", "Plan", "Latest bill (USD)", "Billed", "Card", "Status", "Last checked", "Key / setting name", "Notes"])
      .filter((r) => r.ID && r.Vendor)
      .map((r, n) => {
        const status = STATUS[r.Status.toLowerCase()];
        const billed = BILLED[r.Billed.toLowerCase()];
        const amount = r["Latest bill (USD)"] === "" ? null : Number(r["Latest bill (USD)"]);
        if (!status || billed === undefined || (amount !== null && !Number.isFinite(amount))) {
          console.error(`Register line ${n + 2} (${r.ID}): unreadable Status, Billed or amount`);
          process.exit(1);
        }
        return {
          register_id: r.ID,
          company: r.Company,
          system: r.System,
          vendor: r.Vendor,
          service_type: r["Service type"],
          used_for: r["What it is used for"],
          plan: r.Plan,
          amount: amount === null ? null : amount.toFixed(2),
          currency: "USD",
          billed,
          card: r.Card,
          status,
          checked_on: day(r["Last checked"]),
          key_name: r["Key / setting name"],
          notes: r.Notes,
        };
      })
  : [];

const cards = cardsFile
  ? readTsv(cardsFile, ["Card nickname", "Last 4 digits", "Bank", "Card holder", "Company that pays it", "Statement day", "Notes"])
      .filter((r) => r["Card nickname"] && !/^example/i.test(r["Card nickname"]))
      .map((r) => {
        if (!/^(\d{4})?$/.test(r["Last 4 digits"])) {
          console.error(`Card ${r["Card nickname"]}: "Last 4 digits" must be 4 digits`);
          process.exit(1);
        }
        const sd = Number(r["Statement day"]);
        return {
          nickname: r["Card nickname"],
          last4: r["Last 4 digits"],
          bank: r.Bank,
          holder: r["Card holder"],
          company: r["Company that pays it"],
          statement_day: Number.isInteger(sd) && sd >= 1 && sd <= 31 ? sd : null,
          notes: r.Notes,
        };
      })
  : [];

const { sql, target } = connect();
try {
  const haveCharges = new Set((await sql`SELECT register_id FROM charges WHERE register_id <> ''`).map((r) => r.register_id));
  const haveCards = new Set((await sql`SELECT nickname FROM cards`).map((r) => r.nickname));
  // An account's register_ids is a comma list such as "H03, S04".
  const accountFor = new Map();
  for (const a of await sql`SELECT id, register_ids FROM accounts`) {
    for (const id of a.register_ids.split(",").map((s) => s.trim()).filter(Boolean)) accountFor.set(id, a.id);
  }
  const newCards = cards.filter((c) => !haveCards.has(c.nickname));
  const newCharges = charges.filter((c) => !haveCharges.has(c.register_id)).map((c) => ({ ...c, account_id: accountFor.get(c.register_id) ?? null }));
  for (const c of newCards) console.log(`+ card ${c.nickname}`);
  for (const c of newCharges) console.log(`+ ${c.register_id} ${c.vendor} [${c.status}]${c.account_id ? "" : " (no account linked)"}`);
  console.log(`${newCards.length} card(s) and ${newCharges.length} charge(s) to add (${target}).`);
  if (!apply) {
    console.log("Dry run. Add --apply to write.");
  } else {
    const now = new Date().toISOString();
    const stamp = { created_at: now, updated_at: now, updated_by: "Import from sheet" };
    await sql.begin(async (tx) => {
      if (newCards.length) await tx`INSERT INTO cards ${tx(newCards.map((c) => ({ ...c, ...stamp })))}`;
      if (newCharges.length) await tx`INSERT INTO charges ${tx(newCharges.map((c) => ({ ...c, ...stamp })))}`;
    });
    console.log("Imported.");
  }
} finally {
  await sql.end();
}
