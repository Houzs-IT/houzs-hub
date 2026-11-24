// Google Meet links for meetings (owner 2026-11-24): choosing Google Meet creates the link itself. Invitations
// go out through each ERP's own Mail Center, so nothing here sends email.
//
// Access: one service account with domain-wide delegation (scope meetings.space.created) authorised in the Houzs
// Google Admin. Its JSON key is the GOOGLE_SERVICE_ACCOUNT_JSON secret; every space is created as
// GOOGLE_MEET_OWNER (a Houzs account). The host is usually not in the call, so a space is OPEN: whoever has the
// link joins without knocking, outside guests included. No key = nothing here runs.
import type { Env } from "../types";

type Key = { client_email: string; private_key: string; token_uri?: string };

export class GoogleMeetError extends Error {}

const SCOPE = "https://www.googleapis.com/auth/meetings.space.created";

export const meetConfigured = (env: Env) => Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON && env.GOOGLE_MEET_OWNER);

function readKey(env: Env): Key {
  try {
    const k = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "") as Key;
    if (!k.client_email || !k.private_key) throw new Error("missing fields");
    return k;
  } catch {
    throw new GoogleMeetError("The Google key in the meeting system is not a service account JSON key.");
  }
}

const b64url = (b: ArrayBuffer | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function accessToken(env: Env): Promise<string> {
  const key = readKey(env);
  const aud = env.GOOGLE_TOKEN_URL ?? key.token_uri ?? "https://oauth2.googleapis.com/token";
  const pem = key.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0));
  const k = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: key.client_email, sub: env.GOOGLE_MEET_OWNER, scope: SCOPE, aud, iat: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", k, new TextEncoder().encode(`${head}.${body}`));
  const r = await fetch(aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${body}.${b64url(sig)}` }),
  });
  if (!r.ok) throw new GoogleMeetError(`Google did not accept the meeting system (${r.status}). Check the Google Admin authorisation.`);
  return ((await r.json()) as { access_token: string }).access_token;
}

/** A new Google Meet link anyone with the link can join. */
export async function createMeetLink(env: Env): Promise<string> {
  const token = await accessToken(env);
  const base = (env.GOOGLE_MEET_API_BASE ?? "https://meet.googleapis.com").replace(/\/$/, "");
  const r = await fetch(`${base}/v2/spaces`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ config: { accessType: "OPEN" } }),
  });
  if (!r.ok) throw new GoogleMeetError(`Google Meet did not create a link (${r.status}).`);
  const space = (await r.json()) as { meetingUri?: string };
  if (!space.meetingUri) throw new GoogleMeetError("Google Meet returned no link.");
  return space.meetingUri;
}
