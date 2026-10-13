import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema } from "../db/client";
import { ROLES, type Role } from "../db/schema";
import { EMAIL_RE, USERNAME_RE, hashPassword, randomPassword } from "../services/crypto";
import type { DevApp } from "../types";

// Mounted inside routes/dev.ts, after devAuth, so c.get("user") is set.
const admin = new Hono<DevApp>();
admin.use("*", async (c, next) => {
  if (c.get("user").role !== "admin") return c.json({ error: "Admins only" }, 403);
  await next();
});

const d = schema.users;
const USER_COLS = {
  id: d.id,
  email: d.email,
  username: d.username,
  name: d.name,
  role: d.role,
  active: d.active,
  lockedUntil: d.lockedUntil,
  lastSeenAt: d.lastSeenAt,
  createdAt: d.createdAt,
};

const isRole = (v: unknown): v is Role => ROLES.includes(v as Role);
export const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return (err.cause?.code ?? err.code) === "23505";
};

// Integrations page: whether each system has a key and when it last used it.
admin.get("/systems", async (c) => {
  const s = schema.systems;
  const rows = await getDb(c.env)
    .select({ code: s.code, name: s.name, active: s.active, apiKeyHash: s.apiKeyHash, lastCallAt: s.lastCallAt })
    .from(s)
    .orderBy(asc(s.name));
  return c.json({ systems: rows.map(({ apiKeyHash, ...r }) => ({ ...r, hasKey: !!apiKeyHash })) });
});

// Inactive users too, unlike /users which feeds the assignee picker.
admin.get("/users", async (c) => {
  const users = await getDb(c.env).select(USER_COLS).from(d).orderBy(asc(d.name));
  return c.json({ users });
});

// The temporary password is returned once in this response and never stored in plain text.
admin.post("/users", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = (typeof b.email === "string" ? b.email.trim().toLowerCase() : "") || null;
  const username = typeof b.username === "string" ? b.username.trim().toLowerCase() : "";
  const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 60) : username;
  const role = b.role ?? "developer";
  if (email && !EMAIL_RE.test(email)) return c.json({ error: "Enter a valid email address or leave it empty" }, 400);
  if (!USERNAME_RE.test(username)) return c.json({ error: "Username: 2 to 32 of a-z, 0-9, dot, dash, underscore" }, 400);
  if (!isRole(role)) return c.json({ error: "Unknown role" }, 400);

  const password = randomPassword();
  try {
    const [user] = await getDb(c.env)
      .insert(d)
      .values({ email, username, name, role, passwordHash: await hashPassword(password), mustChangePassword: 1 })
      .returning(USER_COLS);
    return c.json({ user, password }, 201);
  } catch (e) {
    if (isUniqueViolation(e)) return c.json({ error: "That email or username is already in use" }, 409);
    throw e;
  }
});

// An admin cannot change their own role or switch themselves off, so the hub
// can never end up with no admin by accident.
admin.patch("/users/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "User not found" }, 404);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const set: { role?: Role; active?: number; name?: string } = {};
  if (b.role !== undefined) {
    if (!isRole(b.role)) return c.json({ error: "Unknown role" }, 400);
    set.role = b.role;
  }
  if (b.active !== undefined) set.active = b.active ? 1 : 0;
  if (typeof b.name === "string" && b.name.trim()) set.name = b.name.trim().slice(0, 60);
  if (Object.keys(set).length === 0) return c.json({ error: "Nothing to change" }, 400);
  if (id === c.get("user").id && (set.role !== undefined || set.active !== undefined)) {
    return c.json({ error: "You cannot change your own role or switch yourself off" }, 400);
  }

  const [user] = await getDb(c.env).update(d).set(set).where(eq(d.id, id)).returning(USER_COLS);
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json({ user });
});

// ponytail: sessions are stateless cookies, so a reset does not sign the user
// out of browsers they are already in. Switching them off (active = 0) does.
admin.post("/users/:id/reset-password", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "User not found" }, 404);
  const password = randomPassword();
  const [user] = await getDb(c.env)
    .update(d)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: 1, failedLogins: 0, lockedUntil: null })
    .where(eq(d.id, id))
    .returning({ id: d.id });
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json({ password });
});

export default admin;
