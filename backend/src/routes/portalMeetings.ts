import { eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { schema } from "../db/client";
import { devAuth } from "../middleware/devAuth";
import type { DevApp, Env, SysApp } from "../types";
import { meetingsCore } from "./sysMeetings";

// Meetings for IT Support's own users: the same routes the ERPs reach through
// /api/v1/sys/meetings, with the IT Support session vouching for the person
// instead of an ERP key. The person, company, department and "may manage rooms"
// are set HERE from the session; whatever the browser sends in those headers is
// dropped. Guests of a link made here book through /api/v1/public/meetings.

export const IT_SYSTEM = "IT";
export const IT_COMPANY = "Houzs IT";
export const IT_DEPARTMENT = "IT";

// The core routes as IT Support: only reachable through forward() below, never mounted.
const core = new Hono<SysApp>();
core.use("*", async (c, next) => {
  c.set("systemCode", IT_SYSTEM);
  c.set("reporterId", (c.req.header("X-Reporter-Id") ?? "").trim());
  await next();
});
core.route("/", meetingsCore);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any app's context: only its executionCtx is read
function ctx(c: Context<any>) {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the portal (DevApp) and the guest app both forward
async function forward(c: Context<any>, path: string, headers: Record<string, string>, body?: BodyInit): Promise<Response> {
  const url = new URL(c.req.url);
  const h = new Headers(headers);
  const type = c.req.header("Content-Type");
  if (body !== undefined) h.set("Content-Type", "application/json");
  else if (type) h.set("Content-Type", type);
  const method = body !== undefined ? "PUT" : c.req.method;
  const init: RequestInit & { duplex?: "half" } = { method, headers: h };
  if (body !== undefined) init.body = body;
  else if (method !== "GET" && method !== "HEAD") {
    init.body = c.req.raw.body;
    init.duplex = "half";
  }
  return core.fetch(new Request(`https://meetings.internal${path}${body !== undefined ? "" : url.search}`, init), c.env, ctx(c));
}

/** Headers carry one line of plain text. */
const clean = (v: unknown) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);

export const portalMeetings = new Hono<DevApp>();
portalMeetings.use("*", devAuth);

portalMeetings.all("*", async (c) => {
  const path = c.req.path.replace(/^\/api\/v1\/meetings/, "") || "/";
  // The staff list and the guest side are not for a signed-in browser.
  if (path.startsWith("/directory") || path.startsWith("/public")) return c.json({ error: "Not found" }, 404);
  const user = c.get("user");
  if (path === "/bootstrap") {
    // Every active IT Support user is in the directory, so the ERPs can invite them before they open the page.
    const people = await c.get("db")
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.active, 1));
    const res = await forward(c, "/directory", { "X-Reporter-Id": "system" },
      JSON.stringify({ people: people.map((p) => ({ id: String(p.id), name: p.name, email: p.email ?? "", company: IT_COMPANY, department: IT_DEPARTMENT })) }));
    if (!res.ok) console.warn("[meetings] IT Support directory push failed", res.status);
  }
  return forward(c, path, {
    "X-Reporter-Id": String(user.id),
    "X-Person-Name": clean(user.name),
    "X-Person-Email": clean(user.email),
    "X-Person-Company": IT_COMPANY,
    "X-Person-Department": IT_DEPARTMENT,
    "X-Can-Manage-Rooms": user.perms.includes("meeting_rooms") ? "1" : "0",
  });
});

// A guest of a link made in IT Support: the link, its free times, booking, and their own booking. No sign-in.
export const publicMeetings = new Hono<{ Bindings: Env }>();
publicMeetings.all("*", async (c) => {
  const path = c.req.path.replace(/^\/api\/v1\/public\/meetings/, "") || "/";
  if (!/^\/(links|bookings)\//.test(path)) return c.json({ error: "Not found" }, 404);
  return forward(c, `/public${path}`, { "X-Reporter-Id": "guest" });
});
