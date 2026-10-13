#!/usr/bin/env node
// One-shot import of the old Google Form responses into the hub, against DATABASE_URL.
// Input is the Form responses tab copied as TSV (Timestamp, Name, Contact Number,
// System, Issue Title, Description, Type, Priority; optional "Date and Time Issue Occurred"
// and "Submit Photo", whose Drive links are added under the description). Dry run unless --apply.
//   node scripts/import-sheet.mjs <file.tsv>                 prints what would be imported
//   node scripts/import-sheet.mjs <file.tsv> --apply         writes it
//   node scripts/import-sheet.mjs <file.tsv> --triage <triage.tsv> --apply
// The Form has no status. --triage is the team's tracking tab copied as TSV, no header,
// one row per Form row in the same order: [Sheet ID], Priority, Issue Title, System, Developer, Progress,
// then optionally Start time, End time, Note. Start becomes picked_up_at, End the close time, and
// a Note lands as an internal note.
// Progress: blank -> open, On Going, On Hold, Testing, Done -> closed. Developer is matched
// to a hub user by name or username. Without --triage every ticket lands open, unassigned.
// Closed tickets without an End time get the Form timestamp as resolved/closed time.
// legacy_code is the Sheet ID (BUG-01) when the triage tab has one, else the Form timestamp,
// so a re-run skips rows already imported.
// The Form has no user id: reporter_external_id is "sheet:<name in lower case>",
// until scripts/bind-reporters.mjs maps each name to the reporter's real user id.
import { readFileSync } from "node:fs";
import { connect } from "./db.mjs";

const argv = process.argv.slice(2);
const triageAt = argv.indexOf("--triage");
const triageFile = triageAt >= 0 ? argv[triageAt + 1] : null;
const file = argv.find((a, k) => !a.startsWith("--") && (triageAt < 0 || k !== triageAt + 1));
const apply = argv.includes("--apply");
if (!file || (triageAt >= 0 && !triageFile)) {
  console.error("Usage: node scripts/import-sheet.mjs <file.tsv> [--triage <triage.tsv>] [--apply]");
  process.exit(1);
}

// Sheets quotes a cell that holds a newline, tab or quote, doubling inner quotes.
// A cell that merely starts with a quote is not quoted: fall back to plain.
function parseTsv(text) {
  const rows = [];
  let row = [];
  let i = 0;
  const n = text.length;
  while (i <= n) {
    let cell = "";
    let quoted = false;
    if (text[i] === '"') {
      let j = i + 1;
      let buf = "";
      for (;;) {
        if (j >= n) break;
        if (text[j] === '"') {
          if (text[j + 1] === '"') { buf += '"'; j += 2; continue; }
          if (j + 1 >= n || "\t\r\n".includes(text[j + 1])) { quoted = true; cell = buf; i = j + 1; }
          break;
        }
        buf += text[j++];
      }
    }
    if (!quoted) {
      let j = i;
      while (j < n && !"\t\r\n".includes(text[j])) j++;
      cell = text.slice(i, j);
      i = j;
    }
    row.push(cell);
    if (text[i] === "\t") { i++; continue; }
    if (text[i] === "\r") i++;
    i++; // newline or end
    if (row.some((c) => c.trim())) rows.push(row);
    row = [];
  }
  return rows;
}

const SYSTEMS = { hookka: "HK", "houzs century": "HC", "2990s": "2990", conts: "CONTS" };
const TYPES = { bugs: "bug", bug: "bug", development: "development" };
const PRIORITIES = ["urgent", "high", "medium", "low"];
const PROGRESS = { "": "open", "on going": "in_progress", "on hold": "on_hold", testing: "testing", done: "closed" };

// "07/09/2026 19:26:12" is 7 September, Malaysia time.
function toIso(ts) {
  const m = ts.trim().match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, d, mo, y, h, mi, s] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+08:00`).toISOString();
}

const [header, ...body] = parseTsv(readFileSync(file, "utf8"));
const col = Object.fromEntries(header.map((h, k) => [h.trim().toLowerCase(), k]));
for (const h of ["timestamp", "name", "contact number", "system", "issue title", "description", "type", "priority"]) {
  if (!(h in col)) { console.error(`Missing column "${h}". Got: ${header.map((x) => x.trim()).join(" | ")}`); process.exit(1); }
}

const triage = triageFile ? parseTsv(readFileSync(triageFile, "utf8")) : null;
if (triage && triage.length !== body.length) {
  console.error(`Triage has ${triage.length} rows, the Form has ${body.length}. They must line up one to one.`);
  process.exit(1);
}

const { sql, target } = connect();
const users = await sql`SELECT id, lower(name) AS name, lower(username) AS username FROM users`;
const userId = (who) => users.find((u) => u.name === who.toLowerCase() || u.username === who.toLowerCase())?.id;

const ok = [];
const bad = [];
for (const [k, r] of body.entries()) {
  const get = (h) => (r[col[h]] ?? "").trim();
  const tr = triage?.[k].map((c) => c.trim()) ?? [];
  const sheetId = /^(BUG|DEV)-\d+$/i.test(tr[0] ?? "") ? tr.shift() : null;
  const [startAt, endAt] = [tr[5], tr[6]].map((v) => (v ? toIso(v) : null));
  const status = triage ? PROGRESS[(tr[4] ?? "").toLowerCase()] : "open";
  const assigneeId = tr[3] ? userId(tr[3]) : null;
  const at = toIso(get("timestamp"));
  const system = SYSTEMS[get("system").toLowerCase()];
  const type = TYPES[get("type").toLowerCase()];
  const priority = get("priority").toLowerCase();
  const title = get("issue title").slice(0, 200);
  const name = get("name").replace(/\s+/g, " ").slice(0, 120);
  const why = [!at && "timestamp", !system && "system", !type && "type", !PRIORITIES.includes(priority) && "priority", !title && "title", !name && "name"].filter(Boolean);
  if (r.length > header.length) why.push(`${r.length} cells`);
  if (triage && tr[1] !== title) why.push(`triage row ${k + 1} is "${tr[1]}"`);
  if (triage && tr[0]?.toLowerCase() !== priority) why.push(`triage priority ${tr[0]}`);
  if (!status) why.push(`progress "${tr[4]}"`);
  if (assigneeId === undefined) why.push(`no hub user "${tr[3]}"`);
  if ((tr[5] && !startAt) || (tr[6] && !endAt)) why.push(`start/end time "${tr[5]}" "${tr[6]}"`);
  if (why.length) { bad.push({ ts: get("timestamp"), title, why: why.join(", ") }); continue; }
  const phone = get("contact number");
  const photos = get("submit photo");
  const description = (get("description") + (photos ? `\n\nPhotos: ${photos}` : "")).slice(0, 10000);
  ok.push({
    legacy: sheetId || get("timestamp"),
    at,
    system,
    type,
    priority,
    title,
    description,
    name,
    reporterId: `sheet:${name.toLowerCase()}`,
    phone: /\d/.test(phone) ? phone.slice(0, 40) : null,
    status,
    assigneeId,
    developer: tr[3] || "-",
    occurredAt: toIso(get("date and time issue occurred")),
    startAt,
    endAt,
    note: tr[7] || null,
  });
}
ok.sort((a, b) => a.at.localeCompare(b.at));

const tally = (k) => Object.entries(ok.reduce((m, x) => ((m[x[k]] = (m[x[k]] ?? 0) + 1), m), {})).map(([v, c]) => `${v} ${c}`).join(", ");
console.log(`Parsed ${body.length} rows: ${ok.length} importable, ${bad.length} rejected.`);
console.log(`System: ${tally("system")} | Type: ${tally("type")} | Priority: ${tally("priority")} | Status: ${tally("status")} | Developer: ${tally("developer")}`);
if (ok.length) console.log(`Dates (UTC): ${ok[0].at} to ${ok.at(-1).at}`);
for (const b of bad) console.log(`  REJECTED ${b.ts} "${b.title}": ${b.why}`);

try {
  const existing = new Set((await sql`SELECT system_code || '|' || legacy_code AS k FROM tickets WHERE legacy_code IS NOT NULL`).map((x) => x.k));
  const todo = ok.filter((x) => !existing.has(`${x.system}|${x.legacy}`));
  console.log(`Target ${target}: ${ok.length - todo.length} already imported, ${todo.length} to add.`);
  for (const x of todo) console.log(`  ${x.legacy}  ${x.system} ${x.type.padEnd(11)} ${x.priority.padEnd(6)} ${x.status.padEnd(11)} ${x.developer.padEnd(7)} ${x.name.padEnd(14)} ${x.title.slice(0, 70)}`);

  if (!apply) { console.log("\nDry run. Add --apply to write."); process.exit(0); }

  // One transaction: a failure part-way burns no ticket numbers and leaves no half rows.
  const codes = await sql.begin(async (tx) => {
    const out = [];
    for (const x of todo) {
      const [{ next }] = await tx`UPDATE ticket_sequences SET next_n = next_n + 1 WHERE system_code = ${x.system} RETURNING next_n AS next`;
      const code = `${x.system}-${String(next - 1).padStart(4, "0")}`;
      const closedAt = x.status === "closed" ? x.endAt ?? x.at : null;
      const [{ id }] = await tx`
        INSERT INTO tickets (code, legacy_code, system_code, type, priority, status, title, description,
          occurred_at, reporter_external_id, reporter_name, reporter_phone, assignee_id, picked_up_at, resolved_at, closed_at,
          last_public_activity_at, last_public_actor, reporter_seen_at, created_at, updated_at)
        VALUES (${code}, ${x.legacy}, ${x.system}, ${x.type}, ${x.priority}, ${x.status}, ${x.title}, ${x.description},
          ${x.occurredAt}, ${x.reporterId}, ${x.name}, ${x.phone}, ${x.assigneeId}, ${x.startAt}, ${closedAt}, ${closedAt},
          ${x.at}, 'reporter', ${x.at}, ${x.at}, ${x.at})
        RETURNING id`;
      await tx`
        INSERT INTO ticket_events (ticket_id, kind, visibility, author_kind, author_name, created_at)
        VALUES (${id}, 'created', 'public', 'reporter', ${x.name}, ${x.at})`;
      if (x.note) {
        await tx`
          INSERT INTO ticket_events (ticket_id, kind, visibility, author_kind, author_name, body, created_at)
          VALUES (${id}, 'comment', 'internal', 'system', 'Sheet import', ${x.note}, ${x.startAt ?? x.at})`;
      }
      out.push(code);
    }
    return out;
  });
  console.log(codes.length ? `\nImported ${codes.length}: ${codes[0]} to ${codes.at(-1)}.` : "\nNothing to import.");
} finally {
  await sql.end();
}
