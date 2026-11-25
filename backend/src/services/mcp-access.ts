// ---------------------------------------------------------------------------
// mcp-access.ts — what the AI Connector may read in the IT Hub (routes/mcp.ts).
//
// The boundary is the ERP itself: every tool call re-enters the app as a GET
// carrying the person's own identity, so each route's own requirePermission /
// need(...) permission check decides — exactly what that person's hub
// login sees. This file adds three things on top:
//   1. paths the connector never reads (sign-in, the system-key API, files,
//      live streams, the connector itself);
//   2. credential-shaped fields removed from every reply, whoever asks;
//   3. the module list (from the app's own GET routes) for list_modules.
// ---------------------------------------------------------------------------

/** Never readable through the connector, whatever the person's role. */
export const MCP_BLOCKED_PREFIXES = [
  "/api/v1/auth",
  "/api/v1/sys",
  "/api/v1/public",
  "/api/v1/ai-connector",
  "/api/v1/dev/live",
  "/api/v1/dev/attachments",
  "/api/mcp",
];

export type PathDecision = { ok: true; path: string } | { ok: false; reason: string };

/** Normalise and gate one endpoint path (no query string). */
export function classifyPath(raw: string): PathDecision {
  const p = raw.trim().split("?")[0].split("#")[0];
  if (!p.startsWith("/api/v1/")) return { ok: false, reason: "Paths start with /api/v1/ — use list_modules / list_endpoints to find one." };
  if (p.length > 300 || /\.\.|\/\/|%2e|%2f|\\/i.test(p)) return { ok: false, reason: "Invalid path." };
  if (MCP_BLOCKED_PREFIXES.some((b) => p === b || p.startsWith(b + "/"))) {
    return { ok: false, reason: "That part of the hub is not available through the AI connector (sign-in, system keys, files and live streams are never shared)." };
  }
  return { ok: true, path: p.replace(/\/+$/, "") || p };
}

/** Field names removed from every reply: credentials and secrets, never needed to answer a question. */
export const SECRET_KEY = /(password|passwd|secret|token|api_?key|pin_hash|pin_code|totp|otp_|session_pass|private_key|signing_key|r2_key|webhook)/i;

/** Strip credential-shaped fields (any depth). Returns the cleaned value and the names removed. */
export function redactSecrets(v: unknown): { value: unknown; removed: Set<string> } {
  const removed = new Set<string>();
  const walk = (x: unknown, depth: number): unknown => {
    if (depth > 40) return null;
    if (Array.isArray(x)) return x.map((y) => walk(y, depth + 1));
    if (x && typeof x === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x as Record<string, unknown>)) {
        if (SECRET_KEY.test(k)) {
          removed.add(k);
          continue;
        }
        out[k] = walk(val, depth + 1);
      }
      return out;
    }
    return x;
  };
  return { value: walk(v, 0), removed };
}

/** Money / people field names — the leak check reports where these reach a staff account. */
export const SENSITIVE_KEY = /(cost|salary|wage|payroll|margin|profit|commission|ic_?no|nric|bank_?acc|basic_pay|allowance|epf|socso)/i;

export type RouteInfo = { method: string; path: string };

/** Readable GET endpoints (no wildcards, not blocked), sorted. */
export function readablePaths(routes: RouteInfo[], prefix: string | null): string[] {
  const set = new Set<string>();
  for (const r of routes) {
    if (r.method !== "GET") continue;
    if (!r.path.startsWith("/api/v1/") || r.path.includes("*")) continue;
    if (prefix && !(r.path === prefix || r.path.startsWith(prefix + "/"))) continue;
    if (!classifyPath(r.path.replace(/:[^/]+/g, "x")).ok) continue;
    set.add(r.path);
  }
  return [...set].sort();
}

/** One module per /api/v1/<area>/<first segment>. */
export function moduleCatalog(routes: RouteInfo[]): { prefix: string; endpoints: number }[] {
  const counts = new Map<string, number>();
  for (const p of readablePaths(routes, null)) {
    const seg = p.split("/").filter(Boolean); // ["api", "v1", "dev", "tickets", ...]
    const prefix = seg[3] && !seg[3].startsWith(":") ? `/api/v1/${seg[2]}/${seg[3]}` : `/api/v1/${seg[2]}`;
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return [...counts.entries()].map(([prefix, endpoints]) => ({ prefix, endpoints })).sort((a, b) => a.prefix.localeCompare(b.prefix));
}

/** List endpoints worth probing in the leak check: parameter-free GETs. */
export function leakCheckPaths(routes: RouteInfo[]): string[] {
  return readablePaths(routes, null).filter((p) => !p.includes(":"));
}

/** Collect every key name in a JSON value (any depth, capped). */
export function jsonKeys(v: unknown, out: Set<string> = new Set(), depth = 0): Set<string> {
  if (depth > 12 || out.size > 2000) return out;
  if (Array.isArray(v)) {
    for (const x of v.slice(0, 20)) jsonKeys(x, out, depth + 1);
  } else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out.add(k);
      jsonKeys(x, out, depth + 1);
    }
  }
  return out;
}
