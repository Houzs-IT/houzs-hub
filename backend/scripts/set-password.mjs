#!/usr/bin/env node
// Creates a developer or resets their password, against DATABASE_URL. A random
// password is printed once; only its PBKDF2 hash is stored. Also clears any
// login lockout.
//   node scripts/set-password.mjs samuel@gmail.com samuel
//   node scripts/set-password.mjs you@gmail.com you --admin   first admin
// The username is optional on a reset (the existing one is kept). Without
// --admin a new account is a developer and an existing one keeps its role.
// After the first admin exists, the Users page in the hub does all of this.
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { connect } from "./db.mjs";

// Must stay <= 100000: Workers reject higher PBKDF2 iteration counts.
const ITERATIONS = 100000;

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const email = args[0]?.toLowerCase();
const username = args[1]?.toLowerCase() ?? null;
const role = process.argv.includes("--admin") ? "admin" : null;

if (!email || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) || (username && !/^[a-z0-9._-]{2,32}$/.test(username))) {
  console.error("Usage: node scripts/set-password.mjs <email> [username] [--admin]");
  console.error("username: 2-32 of a-z 0-9 . _ -");
  process.exit(1);
}

const password = randomBytes(12).toString("base64url");
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
const stored = `pbkdf2:${ITERATIONS}:${salt.toString("base64")}:${hash.toString("base64")}`;
const name = username ?? email.split("@")[0];

const { sql, target } = connect();
let row;
try {
  [row] = await sql`
    INSERT INTO developers (email, name, username, password_hash, role)
    VALUES (${email}, ${name}, ${username}, ${stored}, ${role ?? "developer"})
    ON CONFLICT (email) DO UPDATE SET
      username = COALESCE(excluded.username, developers.username),
      role = COALESCE(${role}, developers.role),
      password_hash = excluded.password_hash,
      failed_logins = 0,
      locked_until = NULL
    RETURNING email, username, role`;
} catch (e) {
  // 23505 = unique violation; the email conflict is handled above, so this is the username.
  console.error(e.code === "23505" ? `Username ${username} is taken by another developer.` : e.message);
  process.exit(1);
} finally {
  await sql.end();
}

console.log(
  `Password for ${row.email}${row.username ? ` (username ${row.username})` : ""}, role ${row.role} (${target}). ` +
    `Give it to them now; it is not shown again:\n\n${password}\n`,
);
