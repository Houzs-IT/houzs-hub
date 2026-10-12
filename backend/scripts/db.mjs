// Shared by the scripts in this folder: one Postgres connection from DATABASE_URL.
// The value comes from the environment or from backend/.env (gitignored).
import { existsSync } from "node:fs";
import postgres from "postgres";

export function connect() {
  if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile(".env");
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Put it in backend/.env or the environment (see README).");
    process.exit(1);
  }
  const { hostname, port, pathname } = new URL(url);
  const local = hostname === "localhost" || hostname === "127.0.0.1";
  const sql = postgres(url, { max: 1, ssl: local ? false : "require", onnotice: () => {} });
  return { sql, target: `${hostname}:${port || 5432}${pathname}` };
}
