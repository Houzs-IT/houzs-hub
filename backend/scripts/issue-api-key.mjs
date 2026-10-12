#!/usr/bin/env node
// Issues (or rotates) the API key for one system. The plain key is printed
// once; only its SHA-256 is stored. Put the key in that system's secrets as
// IT_HUB_API_KEY.
//   node scripts/issue-api-key.mjs HK            remote
//   node scripts/issue-api-key.mjs HK --local    local D1
import { execSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const DB = "houzs-it-hub";
const code = process.argv[2];
const target = process.argv.includes("--local") ? "--local" : "--remote";
if (!code || !/^[A-Z0-9]{2,6}$/.test(code)) {
  console.error("Usage: node scripts/issue-api-key.mjs <SYSTEM_CODE> [--local]");
  process.exit(1);
}

const key = `hub_${code.toLowerCase()}_${randomBytes(32).toString("base64url")}`;
const hash = createHash("sha256").update(key).digest("hex");

const out = execSync(
  `npx wrangler d1 execute ${DB} ${target} --json --command "UPDATE systems SET api_key_hash = '${hash}' WHERE code = '${code}' RETURNING code"`,
  { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
);
const rows = JSON.parse(out)?.[0]?.results ?? [];
if (rows.length === 0) {
  console.error(`No system with code ${code}.`);
  process.exit(1);
}

console.log(`API key for ${code} (${target}). Store it now; it is not shown again:\n\n${key}\n`);
