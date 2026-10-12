import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema } from "../db/client";
import { endSession, startSession } from "../middleware/devAuth";
import { DUMMY_HASH, verifyPassword } from "../services/crypto";
import type { Env } from "../types";

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

const auth = new Hono<{ Bindings: Env }>();

// `login` is a username or an email; anything with "@" is treated as an email.
auth.post("/login", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { login?: unknown; password?: unknown };
  const login = typeof body.login === "string" ? body.login.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!login || !password) return c.json({ error: "Enter your username or email and password" }, 400);

  const d = schema.developers;
  const db = getDb(c.env);
  const [dev] = await db
    .select()
    .from(d)
    .where(login.includes("@") ? eq(d.email, login) : eq(d.username, login))
    .limit(1);

  const now = new Date();
  if (dev?.lockedUntil && dev.lockedUntil > now.toISOString()) {
    return c.json({ error: `Too many failed attempts. Try again after ${LOCK_MINUTES} minutes.` }, 429);
  }

  const ok = await verifyPassword(password, dev?.passwordHash ?? DUMMY_HASH);
  if (!dev || !dev.passwordHash || !dev.active || !ok) {
    if (dev) {
      const fails = dev.failedLogins + 1;
      const locked = fails >= MAX_FAILS ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() : null;
      await db
        .update(d)
        .set({ failedLogins: locked ? 0 : fails, lockedUntil: locked })
        .where(eq(d.id, dev.id));
    }
    // Same message for unknown user and wrong password, so usernames cannot be probed.
    return c.json({ error: "Wrong username, email or password" }, 401);
  }

  await db.update(d).set({ failedLogins: 0, lockedUntil: null, lastSeenAt: now.toISOString() }).where(eq(d.id, dev.id));
  await startSession(c, dev.id);
  return c.json({ ok: true });
});

auth.post("/logout", (c) => {
  endSession(c);
  return c.json({ ok: true });
});

export default auth;
