#!/usr/bin/env node
// Creates a developer or resets their password. A random password is printed
// once; only its PBKDF2 hash is stored. Also clears any login lockout.
//   node scripts/set-password.mjs samuel@gmail.com samuel           remote
//   node scripts/set-password.mjs samuel@gmail.com samuel --local   local D1
// The username is optional on a reset (the existing one is kept).
import { execSync } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";

const DB = "houzs-it-hub";
// Must stay <= 100000: Workers reject higher PBKDF2 iteration counts.
const ITERATIONS = 100000;

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const target = process.argv.includes("--local") ? "--local" : "--remote";
const email = args[0]?.toLowerCase();
const username = args[1]?.toLowerCase() ?? null;

// Strict patterns: both values are interpolated into SQL inside a shell command.
if (!email || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) || (username && !/^[a-z0-9._-]{2,32}$/.test(username))) {
  console.error("Usage: node scripts/set-password.mjs <email> [username] [--local]");
  console.error("username: 2-32 of a-z 0-9 . _ -");
  process.exit(1);
}

const password = randomBytes(12).toString("base64url");
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
const stored = `pbkdf2:${ITERATIONS}:${salt.toString("base64")}:${hash.toString("base64")}`;

const name = username ?? email.split("@")[0];
const user = username ? `'${username}'` : "NULL";
const sql =
  `INSERT INTO developers (email, name, username, password_hash) VALUES ('${email}', '${name}', ${user}, '${stored}') ` +
  `ON CONFLICT(email) DO UPDATE SET username = COALESCE(excluded.username, developers.username), ` +
  `password_hash = excluded.password_hash, failed_logins = 0, locked_until = NULL ` +
  `RETURNING email, username`;

let out;
try {
  out = execSync(`npx wrangler d1 execute ${DB} ${target} --json --command "${sql}"`, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
} catch (e) {
  const msg = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  console.error(msg.includes("UNIQUE") ? `Username ${username} is taken by another developer.` : msg);
  process.exit(1);
}
const [row] = JSON.parse(out)?.[0]?.results ?? [];

console.log(
  `Password for ${row.email}${row.username ? ` (username ${row.username})` : ""} (${target}). ` +
    `Give it to them now; it is not shown again:\n\n${password}\n`,
);
