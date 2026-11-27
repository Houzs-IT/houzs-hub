// ---------------------------------------------------------------------------
// mcp-client.ts — the hub as an MCP CLIENT of the other systems' AI connectors (round 4d D3,
// the group monthly report). PURE apart from the injected fetch: no imports, so it is tested
// with a stand-in fetch and never touches a real system in tests.
//
// OAuth exactly as an AI app does it: discovery (RFC 9728 protected-resource metadata →
// RFC 8414 authorization-server metadata), dynamic client registration (RFC 7591, public
// client), authorization code + PKCE S256, rotating refresh tokens. Then MCP Streamable
// HTTP: initialize → notifications/initialized → tools/call, answers as JSON or SSE.
// Only https endpoints are followed. Tokens never appear in an error message.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
export type Fetch = typeof fetch;

export const MCP_PROTOCOL_VERSION = "2025-06-18";
const TIMEOUT_MS = 25_000;

export class McpClientError extends Error {
  readonly code: "unauthorized" | "invalid_grant" | "http" | "protocol";
  constructor(message: string, code: "unauthorized" | "invalid_grant" | "http" | "protocol") {
    super(message);
    this.code = code;
  }
}

const isHttps = (u: unknown): u is string => {
  try {
    return typeof u === "string" && new URL(u).protocol === "https:";
  } catch {
    return false;
  }
};

const b64u = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export function randomString(bytes = 32): string {
  return b64u(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE: a verifier and its S256 challenge. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomString(32);
  const challenge = b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

async function getJson(f: Fetch, url: string): Promise<Obj | null> {
  try {
    const r = await f(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as unknown;
    return j && typeof j === "object" ? (j as Obj) : null;
  } catch {
    return null;
  }
}

export type AuthMeta = { resource: string; authorizationEndpoint: string; tokenEndpoint: string; registrationEndpoint: string; scopes: string[] };

/** Where to sign in for this connector: protected-resource metadata, then the authorization server's. */
export async function discover(mcpUrl: string, f: Fetch): Promise<AuthMeta> {
  if (!isHttps(mcpUrl)) throw new McpClientError("The connector address must be https.", "protocol");
  const u = new URL(mcpUrl);
  const path = u.pathname.replace(/\/+$/, "");
  const prm = (await getJson(f, `${u.origin}/.well-known/oauth-protected-resource${path}`)) ?? (await getJson(f, `${u.origin}/.well-known/oauth-protected-resource`));
  const servers = Array.isArray(prm?.authorization_servers) ? (prm!.authorization_servers as unknown[]) : [];
  const issuer = isHttps(servers[0]) ? (servers[0] as string) : u.origin;
  const iu = new URL(issuer);
  const ipath = iu.pathname.replace(/\/+$/, "");
  const candidates = [
    ...(ipath ? [`${iu.origin}/.well-known/oauth-authorization-server${ipath}`] : []),
    `${iu.origin}/.well-known/oauth-authorization-server`,
    `${iu.origin}/.well-known/openid-configuration`,
  ];
  let as: Obj | null = null;
  for (const c of candidates) {
    as = await getJson(f, c);
    if (as) break;
  }
  if (!as || !isHttps(as.authorization_endpoint) || !isHttps(as.token_endpoint)) throw new McpClientError(`Could not find where to sign in for ${u.host}.`, "protocol");
  if (!isHttps(as.registration_endpoint)) throw new McpClientError(`${u.host} does not let new apps register (no registration endpoint).`, "protocol");
  return {
    resource: isHttps(prm?.resource) ? (prm!.resource as string) : mcpUrl,
    authorizationEndpoint: as.authorization_endpoint as string,
    tokenEndpoint: as.token_endpoint as string,
    registrationEndpoint: as.registration_endpoint as string,
    scopes: Array.isArray(prm?.scopes_supported) ? (prm!.scopes_supported as unknown[]).map(String) : Array.isArray(as.scopes_supported) ? (as.scopes_supported as unknown[]).map(String) : [],
  };
}

/** Dynamic client registration as a public client; the new client_id. */
export async function registerClient(meta: AuthMeta, redirectUri: string, f: Fetch, clientName = "Houzs IT Hub group report"): Promise<string> {
  const r = await f(meta.registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_name: clientName, redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const j = (await r.json().catch(() => ({}))) as Obj;
  if (!r.ok || typeof j.client_id !== "string") throw new McpClientError(`Registering with ${new URL(meta.registrationEndpoint).host} failed (HTTP ${r.status}).`, "http");
  return j.client_id;
}

export function authorizeUrl(x: { meta: AuthMeta; clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const u = new URL(x.meta.authorizationEndpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", x.clientId);
  u.searchParams.set("redirect_uri", x.redirectUri);
  u.searchParams.set("state", x.state);
  u.searchParams.set("code_challenge", x.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("resource", x.meta.resource);
  if (x.meta.scopes.length) u.searchParams.set("scope", x.meta.scopes.join(" "));
  return u.toString();
}

export type TokenSet = { accessToken: string; refreshToken: string | null; expiresAt: string };

async function tokenRequest(tokenEndpoint: string, form: Record<string, string>, f: Fetch, nowMs: number): Promise<TokenSet> {
  if (!isHttps(tokenEndpoint)) throw new McpClientError("The token endpoint must be https.", "protocol");
  const r = await f(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const j = (await r.json().catch(() => ({}))) as Obj;
  if (!r.ok || typeof j.access_token !== "string") {
    const code = typeof j.error === "string" ? j.error : "";
    // Never echo the body: it could carry a token.
    throw new McpClientError(code === "invalid_grant" ? "The sign-in has expired or was revoked: connect this system again." : `The token request failed (HTTP ${r.status}${code ? `, ${code.slice(0, 40)}` : ""}).`, code === "invalid_grant" ? "invalid_grant" : "http");
  }
  const secs = Number(j.expires_in);
  return { accessToken: j.access_token, refreshToken: typeof j.refresh_token === "string" ? j.refresh_token : null, expiresAt: new Date(nowMs + (Number.isFinite(secs) && secs > 0 ? secs : 3600) * 1000).toISOString() };
}

export const exchangeCode = (x: { tokenEndpoint: string; code: string; verifier: string; clientId: string; redirectUri: string; resource: string }, f: Fetch, nowMs = Date.now()) =>
  tokenRequest(x.tokenEndpoint, { grant_type: "authorization_code", code: x.code, code_verifier: x.verifier, client_id: x.clientId, redirect_uri: x.redirectUri, resource: x.resource }, f, nowMs);

export const refreshAccess = (x: { tokenEndpoint: string; refreshToken: string; clientId: string; resource: string }, f: Fetch, nowMs = Date.now()) =>
  tokenRequest(x.tokenEndpoint, { grant_type: "refresh_token", refresh_token: x.refreshToken, client_id: x.clientId, resource: x.resource }, f, nowMs);

/** A JSON-RPC reply from a JSON body or an SSE stream (the event carrying our id). */
export function parseRpcReply(contentType: string, body: string, id: number): Obj | null {
  const pick = (v: unknown): Obj | null => {
    const list = Array.isArray(v) ? v : [v];
    for (const x of list) if (x && typeof x === "object" && (x as Obj).id === id) return x as Obj;
    return null;
  };
  if (contentType.includes("text/event-stream")) {
    for (const ev of body.split(/\r?\n\r?\n/)) {
      const data = ev
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        const hit = pick(JSON.parse(data));
        if (hit) return hit;
      } catch {
        /* not JSON */
      }
    }
    return null;
  }
  try {
    return pick(JSON.parse(body));
  } catch {
    return null;
  }
}

export type ToolCallResult = { content?: { type: string; text?: string }[]; structuredContent?: Obj; isError?: boolean };

/** initialize → initialized → tools/call, with the bearer token. 401 → McpClientError("unauthorized"). */
export async function callTool(mcpUrl: string, accessToken: string, name: string, args: Obj, f: Fetch): Promise<ToolCallResult> {
  if (!isHttps(mcpUrl)) throw new McpClientError("The connector address must be https.", "protocol");
  let session = "";
  const post = async (payload: Obj) => {
    const r = await f(mcpUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
        ...(session ? { "mcp-session-id": session } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (r.status === 401) throw new McpClientError("The system no longer accepts the sign-in.", "unauthorized");
    return r;
  };
  const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "houzs-it-hub-group-report", version: "1.0.0" } } });
  if (!init.ok) throw new McpClientError(`The connector answered HTTP ${init.status} to initialize.`, "http");
  session = init.headers.get("mcp-session-id") ?? "";
  await init.text().catch(() => "");
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).then((r) => r.text().catch(() => ""));
  const res = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
  if (!res.ok) throw new McpClientError(`The connector answered HTTP ${res.status} to ${name}.`, "http");
  const reply = parseRpcReply(res.headers.get("content-type") ?? "", await res.text(), 2);
  if (!reply) throw new McpClientError(`The connector's answer to ${name} could not be read.`, "protocol");
  if (reply.error && typeof reply.error === "object") {
    const msg = String((reply.error as Obj).message ?? "error").slice(0, 200);
    return { content: [{ type: "text", text: msg }], isError: true };
  }
  return (reply.result ?? {}) as ToolCallResult;
}
