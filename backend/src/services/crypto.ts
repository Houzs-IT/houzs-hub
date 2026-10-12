export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const b64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

// Format written by scripts/set-password.mjs (Node pbkdf2Sync, SHA-256, 32 bytes):
//   pbkdf2:<iterations>:<salt base64>:<hash base64>
// Workers cap PBKDF2 at 100k iterations, so the script uses exactly that.
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split(":");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: b64(salt), iterations: Number(iter) },
    key,
    256,
  );
  const expected = b64(hash);
  return expected.byteLength === bits.byteLength && crypto.subtle.timingSafeEqual(bits, expected);
}

// Run against unknown usernames so a wrong username takes as long as a wrong password.
export const DUMMY_HASH = "pbkdf2:100000:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
