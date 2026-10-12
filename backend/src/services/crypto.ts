export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const toB64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));

// Workers cap PBKDF2 at 100k iterations. scripts/set-password.mjs uses the same.
const ITERATIONS = 100000;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

// Stored as pbkdf2:<iterations>:<salt base64>:<hash base64>, the same string
// scripts/set-password.mjs writes with Node's pbkdf2Sync.
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2:${ITERATIONS}:${toB64(salt)}:${toB64(await pbkdf2(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split(":");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  const bits = await pbkdf2(password, fromB64(salt), Number(iter));
  const expected = fromB64(hash);
  return expected.byteLength === bits.byteLength && crypto.subtle.timingSafeEqual(bits, expected);
}

// Run against unknown usernames so a wrong username takes as long as a wrong password.
export const DUMMY_HASH = "pbkdf2:100000:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

// 16 characters, shown once to the admin who creates or resets an account.
export const randomPassword = () =>
  toB64(crypto.getRandomValues(new Uint8Array(12))).replace(/\+/g, "-").replace(/\//g, "_");

// Same rules as scripts/set-password.mjs.
export const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
export const USERNAME_RE = /^[a-z0-9._-]{2,32}$/;
export const MIN_PASSWORD = 10;
