// AES-GCM for the group report's stored OAuth tokens (round 4d D3). PURE: WebCrypto only,
// no imports, so it is unit-tested directly.
//
// The key comes from the GROUP_REPORT_KEY secret: any long random string; its SHA-256 is the
// 256-bit AES key. Sealed form: "v1.<iv base64url>.<ciphertext+tag base64url>". The
// additional data binds each value to where it is stored (e.g. "hookka:refresh"), so a
// ciphertext copied into another row or field does not open. Values are never logged.

export const MIN_KEY_LENGTH = 16;

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64u = (b: ArrayBuffer | Uint8Array): string => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (s: string): Uint8Array => {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
};

/** Whether the secret is usable at all (the page says "not configured" otherwise). */
export const keyConfigured = (secret: string | undefined): secret is string => typeof secret === "string" && secret.length >= MIN_KEY_LENGTH;

async function aesKey(secret: string): Promise<CryptoKey> {
  if (!keyConfigured(secret)) throw new Error("GROUP_REPORT_KEY is not configured");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(secret: string, plaintext: string, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, await aesKey(secret), enc.encode(plaintext));
  return `v1.${b64u(iv)}.${b64u(ct)}`;
}

/** The plaintext, or throws when the value was changed, sealed for another place, or under another key. */
export async function unseal(secret: string, sealed: string, aad: string): Promise<string> {
  const [v, iv, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("Not a sealed value");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv), additionalData: enc.encode(aad) }, await aesKey(secret), unb64u(ct));
  return dec.decode(pt);
}
