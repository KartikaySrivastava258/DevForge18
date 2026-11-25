/**
 * Password hashing with scrypt (memory-hard, built into Node's crypto).
 *
 * Stored format:  scrypt$<logN>$<r>$<p>$<salt b64url>$<hash b64url>
 * Parameters live inside each hash, so the cost can be raised later and old
 * hashes upgraded transparently on the user's next successful login.
 * Default logN=17 (N=131072, r=8, p=1) follows OWASP's scrypt guidance.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const KEY_LENGTH = 32;
const R = 8;
const P = 1;

function scryptAsync(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function optionsFor(logN: number, r: number, p: number): ScryptOptions {
  const N = 2 ** logN;
  // scrypt needs roughly 128 * N * r bytes; allow headroom above Node's 32 MiB default.
  return { N, r, p, maxmem: 256 * N * r };
}

export async function hashPassword(password: string, logN: number): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, optionsFor(logN, R, P));
  return ["scrypt", logN, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export interface VerifyResult {
  ok: boolean;
  /** True when the hash used weaker parameters than currently configured. */
  needsRehash: boolean;
}

export async function verifyPassword(password: string, stored: string, currentLogN: number): Promise<VerifyResult> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return { ok: false, needsRehash: false };
  const [, logNText, rText, pText, saltText, hashText] = parts as [string, string, string, string, string, string];
  const logN = Number(logNText);
  const r = Number(rText);
  const p = Number(pText);
  if (!Number.isInteger(logN) || logN < 10 || logN > 22 || !Number.isInteger(r) || !Number.isInteger(p)) {
    return { ok: false, needsRehash: false };
  }
  const expected = Buffer.from(hashText, "base64url");
  const actual = await scryptAsync(password, Buffer.from(saltText, "base64url"), optionsFor(logN, r, p));
  const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
  return { ok, needsRehash: ok && (logN < currentLogN || r !== R || p !== P) };
}

/** Very common passwords rejected outright (NIST SP 800-63B recommends a blocklist). */
const COMMON = new Set([
  "password", "password1", "password123", "passw0rd", "1234567890", "12345678910", "qwertyuiop",
  "iloveyou12", "letmein123", "welcome123", "admin12345", "abc1234567", "qwerty1234", "1q2w3e4r5t",
  "devforge18", "graphicera", "student123", "changeme123",
]);

/** Returns a human-readable problem, or null if the password is acceptable. */
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (password.length > 200) return "Password must be at most 200 characters.";
  if (COMMON.has(password.toLowerCase())) return "This password is too common. Choose something less predictable.";
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && password.toLowerCase().includes(local)) return "Password must not contain your email name.";
  if (new Set(password).size < 4) return "Password is too repetitive.";
  return null;
}
