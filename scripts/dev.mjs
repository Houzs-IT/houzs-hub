// Starts the backend and the frontend together. Ctrl+C stops both.
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

const env = { ...process.env };
if (existsSync("backend/.env")) process.loadEnvFile("backend/.env");
const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;

// A Supabase DATABASE_URL means local dev runs on the LIVE database.
// Use the transaction pooler (6543), not session mode (5432): wrangler dev opens a
// fresh client per request and keeps it, which would fill the 15-slot session pool
// the live site also relies on.
if (databaseUrl?.hostname.endsWith("supabase.com")) {
  databaseUrl.port = "6543";
  env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = databaseUrl.toString();
  console.log("\n  Local dev is on the LIVE database. No deletes or test submits.\n");
}

spawn("npm --prefix backend run dev", { stdio: "inherit", env, shell: true });
spawn("npm --prefix frontend run dev", { stdio: "inherit", shell: true });
