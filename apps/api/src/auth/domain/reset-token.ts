import { createHash, randomBytes } from 'node:crypto';

/**
 * Password reset token helpers.
 *
 * Design mirrors `token-hash.ts` (refresh tokens) — raw string handed to
 * the user, SHA-256 hash stored in DB. The only functional difference is
 * these tokens are single-use with a short TTL, so we don't need the
 * family/rotation machinery.
 *
 * ## Threat model
 *
 * - **Enumeration.** Callers should NEVER know whether a token was found
 *   or not. `hashResetToken` is deterministic + collision-resistant, so
 *   a database read by hash never leaks existence to a timing attacker.
 * - **Replay.** Handled at the service layer via `usedAt`.
 * - **Brute force.** 48 bytes = 384 bits of entropy → guessing rate must
 *   exceed 2^192 attempts before a 50% chance of a hit. Combined with the
 *   30-min TTL and per-IP rate limit at the controller, this is fine.
 * - **DB leak.** SHA-256 of a 384-bit random string is not reversible.
 *   No pepper or KDF needed (unlike passwords) because the plaintext is
 *   already high-entropy.
 */

export interface GeneratedResetToken {
  /** The URL-safe token sent to the user via email — never persisted raw. */
  rawToken: string;
  /** SHA-256 hex of `rawToken` — this is what goes into the DB. */
  tokenHash: string;
}

export function generateResetToken(byteLength = 48): GeneratedResetToken {
  const rawToken = randomBytes(byteLength).toString('base64url');
  return { rawToken, tokenHash: hashResetToken(rawToken) };
}

export function hashResetToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** Minutes the token stays valid after issuance. */
export const RESET_TOKEN_TTL_MINUTES = 30;

/**
 * Basic shape validation for a token pulled from a URL query string.
 * Returns `false` for anything that couldn't possibly be one of our
 * tokens — this lets the service short-circuit invalid input before
 * touching the DB, but does NOT prove the token exists.
 */
export function looksLikeResetToken(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string') return false;
  // 48 bytes → base64url with length 64. Accept 40..128 as a defensive
  // range in case we tune `byteLength` later.
  if (candidate.length < 40 || candidate.length > 128) return false;
  // base64url alphabet: A-Z a-z 0-9 - _
  return /^[A-Za-z0-9_-]+$/.test(candidate);
}
