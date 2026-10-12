export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

type Jwk = JsonWebKey & { kid?: string };
let certCache: { team: string; keys: Jwk[]; fetchedAt: number } | null = null;

async function accessKeys(team: string, force = false): Promise<Jwk[]> {
  if (!force && certCache && certCache.team === team && Date.now() - certCache.fetchedAt < 3600_000) {
    return certCache.keys;
  }
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  certCache = { team, keys: body.keys, fetchedAt: Date.now() };
  return body.keys;
}

// Verifies the Cf-Access-Jwt-Assertion header. Trusting the plain
// Cf-Access-Authenticated-User-Email header alone would let anyone who
// reaches the Worker by another route claim any identity.
export async function verifyAccessJwt(token: string, team: string, aud: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h))) as { kid?: string; alg?: string };
  if (header.alg !== "RS256") return null;

  let keys = await accessKeys(team);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await accessKeys(team, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlDecode(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) return null;

  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(p))) as {
    aud?: string | string[];
    exp?: number;
    iss?: string;
    email?: string;
  };
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(aud)) return null;
  if (!claims.exp || claims.exp * 1000 < Date.now()) return null;
  if (claims.iss !== `https://${team}`) return null;
  return claims.email?.toLowerCase() ?? null;
}
