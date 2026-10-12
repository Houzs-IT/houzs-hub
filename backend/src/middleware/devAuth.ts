import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { getDb, schema } from "../db/client";
import { verifyAccessJwt } from "../services/crypto";
import type { DevApp } from "../types";

function isLocal(url: string) {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1";
}

// Who may sign in is decided by the Access policy. Anyone who passes it gets
// a developers row on first visit.
export const devAuth = createMiddleware<DevApp>(async (c, next) => {
  let email: string | null = null;

  if (c.env.DEV_AUTH_EMAIL && isLocal(c.req.url)) {
    email = c.env.DEV_AUTH_EMAIL.toLowerCase();
  } else {
    const token = c.req.header("Cf-Access-Jwt-Assertion");
    const team = c.env.ACCESS_TEAM_DOMAIN;
    const aud = c.env.ACCESS_AUD;
    if (token && team && aud) email = await verifyAccessJwt(token, team, aud);
  }
  if (!email) return c.json({ error: "Not signed in" }, 401);

  const db = getDb(c.env);
  const now = new Date().toISOString();
  let [dev] = await db.select().from(schema.developers).where(eq(schema.developers.email, email)).limit(1);
  if (!dev) {
    [dev] = await db
      .insert(schema.developers)
      .values({ email, name: email.split("@")[0], createdAt: now, lastSeenAt: now })
      .returning();
  } else {
    if (!dev.active) return c.json({ error: "Developer disabled" }, 403);
    await db.update(schema.developers).set({ lastSeenAt: now }).where(eq(schema.developers.id, dev.id));
  }

  c.set("developer", dev);
  await next();
});
