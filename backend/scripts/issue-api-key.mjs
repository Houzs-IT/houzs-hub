#!/usr/bin/env node
// Issues (or rotates) the API key for one system, against DATABASE_URL. The
// plain key is printed once; only its SHA-256 is stored. Put the key in that
// system's secrets as IT_HUB_API_KEY.
//   node scripts/issue-api-key.mjs HK
import { createHash, randomBytes } from "node:crypto";
import { connect } from "./db.mjs";

const code = process.argv[2];
if (!code || !/^[A-Z0-9]{2,6}$/.test(code)) {
  console.error("Usage: node scripts/issue-api-key.mjs <SYSTEM_CODE>");
  process.exit(1);
}

const key = `hub_${code.toLowerCase()}_${randomBytes(32).toString("base64url")}`;
const hash = createHash("sha256").update(key).digest("hex");

const { sql, target } = connect();
let rows;
try {
  rows = await sql`UPDATE systems SET api_key_hash = ${hash} WHERE code = ${code} RETURNING code`;
} finally {
  await sql.end();
}
if (rows.length === 0) {
  console.error(`No system with code ${code}.`);
  process.exit(1);
}

console.log(`API key for ${code} (${target}). Store it now; it is not shown again:\n\n${key}\n`);
