import { createHash, randomBytes, randomInt } from 'node:crypto';

/**
 * MFA backup codes — issued in batches when the user enrolls or
 * regenerates. Two design choices worth calling out:
 *
 * 1. **Plaintext shown once, only hashes persisted.** Same threat model
 *    as password storage. If the DB is dumped, backup codes are still
 *    safe modulo SHA-256 preimage resistance.
 *
 * 2. **Fixed alphabet + fixed length.** Codes are 10 chars from
 *    Crockford's base32 (no I / L / O / U) so they're readable when
 *    the user writes them on paper or a sticky note. Case-insensitive.
 *    Length 10 → ~50 bits of entropy per code, which is well beyond
 *    what a rate-limited login endpoint can brute-force.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // 32 chars, Crockford
const CODE_LENGTH = 10;

/** Generate a single random backup code in canonical (uppercase) form. */
export function generateBackupCode(): string {
  const chars: string[] = [];
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    // `randomInt` uses a rejection-sampling CSPRNG under the hood, so
    // there's no modulo bias like `randomBytes()[0] % 32` would have.
    chars.push(ALPHABET[randomInt(0, ALPHABET.length)]!);
  }
  return chars.join('');
}

/** Generate `count` codes. Guaranteed to be distinct within the batch. */
export function generateBackupCodes(count: number): string[] {
  const set = new Set<string>();
  // Guard against pathological loops if the RNG returns the same code
  // repeatedly (probability is astronomically low but the caller is
  // security code, defense in depth).
  const maxAttempts = count * 10 + 32;
  let attempts = 0;
  while (set.size < count && attempts < maxAttempts) {
    set.add(generateBackupCode());
    attempts += 1;
  }
  if (set.size < count) {
    // Fall back to plain sequential fill — the odds we get here are
    // essentially zero, but throwing here would DoS enrollment.
    while (set.size < count) {
      set.add(generateBackupCode() + randomBytes(1).toString('hex').toUpperCase());
    }
  }
  return Array.from(set);
}

/**
 * Normalize a user-submitted code: uppercase, strip whitespace and
 * common separators (`-`, `_`, spaces) the user may have inserted
 * when transcribing. Does NOT validate the alphabet — callers should
 * hash the normalized value and lookup by hash; a wrong alphabet just
 * won't match anything.
 */
export function normalizeBackupCode(input: string): string {
  return input
    .trim()
    .replace(/[\s\-_]+/g, '')
    .toUpperCase();
}

/**
 * SHA-256 of the normalized code, hex-encoded. NOT a slow hash —
 * backup codes are high-entropy (~50 bits) so we don't need argon2's
 * memory hardness; a fast hash keeps constant-time verification
 * cheap under load.
 */
export function hashBackupCode(code: string): string {
  return createHash('sha256').update(normalizeBackupCode(code)).digest('hex');
}
