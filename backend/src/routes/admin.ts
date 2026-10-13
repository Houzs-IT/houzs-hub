import { asc, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema, type DB } from "../db/client";
import { EMAIL_RE, USERNAME_RE, hashPassword, randomPassword } from "../services/crypto";
import { need } from "../middleware/devAuth";
import { PERMISSIONS, joinPerms, locksOut, parsePerms } from "../services/perms";
import type { DevApp } from "../types";

// Mounted inside routes/dev.ts, after devAuth, so c.get("user") is set.
// There is no blanket check here: every route carries its own need(...).
const admin = new Hono<DevApp>();

const d = schema.users;
const r = schema.roles;
const USER_COLS = {
  id: d.id,
  email: d.email,
  username: d.username,
  name: d.name,
  role: d.role,
  permAllow: d.permAllow,
  permDeny: d.permDeny,
  active: d.active,
  lockedUntil: d.lockedUntil,
  lastSeenAt: d.lastSeenAt,
  createdAt: d.createdAt,
};
type AccessFields = { role: string; active: number; permAllow: string; permDeny: string };
const userOut = <T extends { permAllow: string; permDeny: string }>(u: T) => ({
  ...u,
  permAllow: parsePerms(u.permAllow),
  permDeny: parsePerms(u.permDeny),
});

// Built in roles: admin is what set-password.mjs --admin hands out, developer
// is the database default for new accounts. Both can be renamed, not deleted.
const BUILT_IN = new Set(["admin", "developer"]);

export const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return (err.cause?.code ?? err.code) === "23505";
};

// Would this change leave nobody active who can manage roles?
// ponytail: read-then-write without a lock; two admins editing at the same
// second could both pass. Fine for a handful of admins.
async function lockout(
  db: DB,
  change: { user?: Partial<AccessFields> & { id: number }; role?: { key: string; permissions: string } },
) {
  const [users, roles] = await Promise.all([
    db.select({ id: d.id, active: d.active, role: d.role, permAllow: d.permAllow, permDeny: d.permDeny }).from(d),
    db.select({ key: r.key, permissions: r.permissions }).from(r),
  ]);
  const rolePerms = Object.fromEntries(roles.map((x) => [x.key, x.permissions]));
  if (change.role) rolePerms[change.role.key] = change.role.permissions;
  return locksOut(
    users.map((u) => (u.id === change.user?.id ? { ...u, ...change.user } : u)),
    rolePerms,
  );
}
const LOCKOUT = "Someone active must still be able to manage roles";

async function roleExists(db: DB, key: unknown) {
  if (typeof key !== "string") return false;
  const [row] = await db.select({ key: r.key }).from(r).where(eq(r.key, key)).limit(1);
  return !!row;
}

// Integrations page: whether each system has a key and when it last used it.
admin.get("/systems", need("integrations"), async (c) => {
  const s = schema.systems;
  const rows = await getDb(c.env)
    .select({
      code: s.code,
      name: s.name,
      active: s.active,
      apiKeyHash: s.apiKeyHash,
      lastCallAt: s.lastCallAt,
      lastSendError: s.lastSendError,
      lastSendErrorAt: s.lastSendErrorAt,
    })
    .from(s)
    .orderBy(asc(s.name));
  return c.json({ systems: rows.map(({ apiKeyHash, ...r }) => ({ ...r, hasKey: !!apiKeyHash })) });
});

// Inactive users too, unlike /users which feeds the assignee picker.
admin.get("/users", need("users", "roles"), async (c) => {
  const users = await getDb(c.env).select(USER_COLS).from(d).orderBy(asc(d.name));
  return c.json({ users: users.map(userOut) });
});

// The temporary password is returned once in this response and never stored in plain text.
admin.post("/users", need("users"), async (c) => {
  const db = getDb(c.env);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = (typeof b.email === "string" ? b.email.trim().toLowerCase() : "") || null;
  const username = typeof b.username === "string" ? b.username.trim().toLowerCase() : "";
  const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 60) : username;
  const role = b.role ?? "developer";
  if (email && !EMAIL_RE.test(email)) return c.json({ error: "Enter a valid email address or leave it empty" }, 400);
  if (!USERNAME_RE.test(username)) return c.json({ error: "Username: 2 to 32 of a-z, 0-9, dot, dash, underscore" }, 400);
  if (typeof role !== "string" || !(await roleExists(db, role))) return c.json({ error: "Unknown role" }, 400);
  // Otherwise someone who may only manage users could create an admin.
  if (role !== "developer" && !c.get("user").perms.includes("roles")) {
    return c.json({ error: "Only someone who can manage roles can give a new user a role other than Developer" }, 403);
  }

  const password = randomPassword();
  try {
    const [user] = await db
      .insert(d)
      .values({ email, username, name, role, passwordHash: await hashPassword(password), mustChangePassword: 1 })
      .returning(USER_COLS);
    return c.json({ user: userOut(user!), password }, 201);
  } catch (e) {
    if (isUniqueViolation(e)) return c.json({ error: "That email or username is already in use" }, 409);
    throw e;
  }
});

// Name and on/off need "users"; role and overrides need "roles". Nobody can
// change their own role, overrides or on/off, and no change may leave the hub
// without someone who can manage roles.
admin.patch("/users/:id", need("users", "roles"), async (c) => {
  const db = getDb(c.env);
  const me = c.get("user");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "User not found" }, 404);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const set: Partial<AccessFields> & { name?: string } = {};

  if (b.role !== undefined) {
    if (typeof b.role !== "string" || !(await roleExists(db, b.role))) return c.json({ error: "Unknown role" }, 400);
    set.role = b.role;
  }
  for (const k of ["permAllow", "permDeny"] as const) {
    if (b[k] === undefined) continue;
    const joined = joinPerms(b[k]);
    if (joined === null) return c.json({ error: "Unknown permission" }, 400);
    set[k] = joined;
  }
  if (b.active !== undefined) set.active = b.active ? 1 : 0;
  if (typeof b.name === "string" && b.name.trim()) set.name = b.name.trim().slice(0, 60);
  if (Object.keys(set).length === 0) return c.json({ error: "Nothing to change" }, 400);

  const touchesAccess = set.role !== undefined || set.permAllow !== undefined || set.permDeny !== undefined;
  if (touchesAccess && !me.perms.includes("roles")) return c.json({ error: "You do not have permission for this" }, 403);
  if ((set.active !== undefined || set.name !== undefined) && !me.perms.includes("users")) {
    return c.json({ error: "You do not have permission for this" }, 403);
  }
  if (id === me.id && (touchesAccess || set.active !== undefined)) {
    return c.json({ error: "You cannot change your own role, permissions or switch yourself off" }, 400);
  }
  if ((touchesAccess || set.active !== undefined) && (await lockout(db, { user: { id, ...set } }))) {
    return c.json({ error: LOCKOUT }, 400);
  }

  const [user] = await db.update(d).set(set).where(eq(d.id, id)).returning(USER_COLS);
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json({ user: userOut(user) });
});

// ponytail: sessions are stateless cookies, so a reset does not sign the user
// out of browsers they are already in. Switching them off (active = 0) does.
admin.post("/users/:id/reset-password", need("users"), async (c) => {
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

// Readable with "users" too: the Users page lists role names.
admin.get("/roles", need("users", "roles"), async (c) => {
  const db = getDb(c.env);
  const [roles, counts] = await Promise.all([
    db.select().from(r).orderBy(asc(r.name)),
    db.select({ role: d.role, n: count() }).from(d).groupBy(d.role),
  ]);
  const n = Object.fromEntries(counts.map((x) => [x.role, x.n]));
  return c.json({
    permissions: PERMISSIONS,
    roles: roles.map((x) => ({
      key: x.key,
      name: x.name,
      permissions: parsePerms(x.permissions),
      users: n[x.key] ?? 0,
      builtIn: BUILT_IN.has(x.key),
    })),
  });
});

const roleName = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 40) : "");

admin.post("/roles", need("roles"), async (c) => {
  const db = getDb(c.env);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = roleName(b.name);
  if (!name) return c.json({ error: "Give the role a name" }, 400);
  // Most roles work tickets, so a new role starts with IT on.
  const permissions = joinPerms(b.permissions ?? ["it"]);
  if (permissions === null) return c.json({ error: "Unknown permission" }, 400);

  // The key never changes after this, so renaming is free.
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "role";
  const taken = new Set((await db.select({ key: r.key }).from(r)).map((x) => x.key));
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}-${i}`;

  try {
    await db.insert(r).values({ key, name, permissions });
  } catch (e) {
    if (isUniqueViolation(e)) return c.json({ error: "A role with that name already exists" }, 409);
    throw e;
  }
  return c.json({ key }, 201);
});

admin.patch("/roles/:key", need("roles"), async (c) => {
  const db = getDb(c.env);
  const key = c.req.param("key");
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const set: { name?: string; permissions?: string } = {};
  if (b.name !== undefined) {
    set.name = roleName(b.name);
    if (!set.name) return c.json({ error: "Give the role a name" }, 400);
  }
  if (b.permissions !== undefined) {
    const joined = joinPerms(b.permissions);
    if (joined === null) return c.json({ error: "Unknown permission" }, 400);
    set.permissions = joined;
  }
  if (Object.keys(set).length === 0) return c.json({ error: "Nothing to change" }, 400);
  if (set.permissions !== undefined && (await lockout(db, { role: { key, permissions: set.permissions } }))) {
    return c.json({ error: LOCKOUT }, 400);
  }

  try {
    const [row] = await db.update(r).set(set).where(eq(r.key, key)).returning({ key: r.key });
    if (!row) return c.json({ error: "Role not found" }, 404);
  } catch (e) {
    if (isUniqueViolation(e)) return c.json({ error: "A role with that name already exists" }, 409);
    throw e;
  }
  return c.json({ ok: true });
});

admin.delete("/roles/:key", need("roles"), async (c) => {
  const db = getDb(c.env);
  const key = c.req.param("key");
  if (BUILT_IN.has(key)) return c.json({ error: "Admin and Developer are built in and cannot be deleted" }, 400);
  const [{ n }] = await db.select({ n: count() }).from(d).where(eq(d.role, key));
  if (n) return c.json({ error: `Move its ${n} user(s) to another role first` }, 400);
  const [row] = await db.delete(r).where(eq(r.key, key)).returning({ key: r.key });
  if (!row) return c.json({ error: "Role not found" }, 404);
  return c.json({ ok: true });
});

export default admin;
