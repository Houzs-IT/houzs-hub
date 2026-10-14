import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { sign, verify } from "hono/jwt";
import { getDb, schema } from "../db/client";
import { effective, type Perm } from "../services/perms";
import type { DevApp, Env } from "../types";

const COOKIE = "hub_session";
const SESSION_DAYS = 7;

function secret(env: Env) {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is not set");
  return env.SESSION_SECRET;
}

// ponytail: stateless signed cookie, so one stolen session cannot be revoked on
// its own before it expires. Setting users.active = 0 cuts all of that
// user's sessions. Add a sessions table if per-session revoke is needed.
export async function startSession(c: Context<{ Bindings: Env }>, userId: number) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const token = await sign({ sub: userId, exp }, secret(c.env), "HS256");
  setCookie(c, COOKIE, token, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: SESSION_DAYS * 86400 });
}

export const ACCOUNT_DISABLED = "Your account has been disabled. Ask an IT admin to turn it back on.";

export function endSession(c: Context) {
  deleteCookie(c, COOKIE, { path: "/", secure: true });
}

// After devAuth: passes if the user holds any of the given permissions.
export const need = (...perms: Perm[]) =>
  createMiddleware<DevApp>(async (c, next) => {
    if (!perms.some((p) => c.get("user").perms.includes(p))) {
      return c.json({ error: "You do not have permission for this" }, 403);
    }
    await next();
  });

export const devAuth = createMiddleware<DevApp>(async (c, next) => {
  const token = getCookie(c, COOKIE);
  const payload = token ? await verify(token, secret(c.env), "HS256").catch(() => null) : null;
  const id = Number(payload?.sub);
  if (!Number.isInteger(id)) return c.json({ error: "Not signed in" }, 401);

  const db = getDb(c.env);
  const [row] = await db
    .select({ user: schema.users, role: schema.roles })
    .from(schema.users)
    .leftJoin(schema.roles, eq(schema.roles.key, schema.users.role))
    .where(eq(schema.users.id, id))
    .limit(1);
  if (!row) return c.json({ error: "Not signed in" }, 401);
  if (!row.user.active) return c.json({ error: ACCOUNT_DISABLED, code: "account_disabled" }, 401);
  const user = {
    ...row.user,
    roleName: row.role?.name ?? row.user.role,
    perms: effective(row.role?.permissions ?? "", row.user.permAllow, row.user.permDeny),
  };
  // With a handed-out password, the only things allowed are reading who you
  // are and setting your own password.
  const path = c.req.path;
  if (user.mustChangePassword && !(path.endsWith("/me") && c.req.method === "GET") && !path.endsWith("/me/password")) {
    return c.json({ error: "Choose your own password first", code: "must_change_password" }, 403);
  }
  // At most one write a minute per user, so reads stay reads.
  const now = new Date();
  if (!user.lastSeenAt || now.getTime() - Date.parse(user.lastSeenAt) > 60_000) {
    await db.update(schema.users).set({ lastSeenAt: now.toISOString() }).where(eq(schema.users.id, user.id));
  }

  c.set("user", user);
  c.set("db", db);
  await next();
});
