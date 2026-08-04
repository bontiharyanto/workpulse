import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * AES-256-GCM app-layer encryption for small secrets stored in the DB
 * (MFA TOTP secrets today; potentially other per-row secrets later).
 *
 * ## Threat model
 *
 * Assume a DB dump is stolen (SQL injection at rest, backup archive
 * leak, compromised replica). Without the encryption key, an attacker
 * with a copy of `User.mfaSecret` cannot compute TOTP codes for that
 * user. The key lives in an env var (or Secret Manager in prod), never
 * in the DB, so a DB-only breach is neutralized.
 *
 * ## Wire format
 *
 * `<iv:12b><ciphertext:Nb><tag:16b>` base64-encoded as a single string.
 * Zero framing overhead beyond the mandatory GCM IV + auth tag. IV is
 * fresh per encryption — deterministic keys are catastrophic in GCM.
 *
 * The 12-byte IV is the standard NIST recommendation for GCM. The
 * 16-byte tag is the maximum GCM permits and matches the reference
 * implementation guidance.
 */

const ALGO = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export class InvalidEncryptionKeyError extends Error {
  constructor(reason: string) {
    super(`Invalid MFA encryption key: ${reason}`);
    this.name = 'InvalidEncryptionKeyError';
  }
}

export class DecryptionFailedError extends Error {
  constructor() {
    // Deliberately vague — leaking WHY decryption failed (bad key vs
    // tampered ciphertext vs malformed input) helps an attacker probe.
    super('Decryption failed');
    this.name = 'DecryptionFailedError';
  }
}

/**
 * Decode a base64 encryption key and validate its length. Called once
 * at module init — throws loudly if the env is misconfigured so the
 * API refuses to boot with a broken MFA subsystem instead of failing
 * softly at first enrollment.
 */
export function decodeEncryptionKey(base64Key: string): Buffer {
  let decoded: Buffer;
  try {
    decoded = Buffer.from(base64Key, 'base64');
  } catch {
    throw new InvalidEncryptionKeyError('not valid base64');
  }
  if (decoded.length !== KEY_LENGTH) {
    throw new InvalidEncryptionKeyError(`expected ${KEY_LENGTH} bytes, got ${decoded.length}`);
  }
  return decoded;
}

/**
 * Encrypt `plaintext` with the given 32-byte key. Returns a base64
 * string bundle of `iv || ciphertext || tag` suitable for storing in
 * a single VARCHAR column.
 *
 * NEVER call this with a static IV — the IV is generated per-call. If
 * you need deterministic encryption for search, use a different
 * scheme (SIV) — GCM with a repeated IV catastrophically leaks
 * plaintext XOR relationships.
 */
export function encryptString(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_LENGTH) {
    throw new InvalidEncryptionKeyError(`expected ${KEY_LENGTH}-byte key, got ${key.length}`);
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString('base64');
}

/**
 * Reverse of `encryptString`. Throws `DecryptionFailedError` on ANY
 * failure — do not surface `err.message` to the client; it's a
 * distinguisher.
 *
 * Timing-safe comparison of the auth tag is delegated to Node's
 * `decipher.final()` which itself uses OpenSSL's constant-time
 * comparator; no manual `timingSafeEqual` needed for the tag.
 */
export function decryptString(bundle: string, key: Buffer): string {
  if (key.length !== KEY_LENGTH) {
    throw new InvalidEncryptionKeyError(`expected ${KEY_LENGTH}-byte key, got ${key.length}`);
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(bundle, 'base64');
  } catch {
    throw new DecryptionFailedError();
  }
  if (buf.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new DecryptionFailedError();
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(buf.length - TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - TAG_LENGTH);

  try {
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    throw new DecryptionFailedError();
  }
}

/**
 * Constant-time buffer compare — exposed for tests and callers that
 * need to compare fixed-width secrets (e.g. backup-code hashes).
 * Returns `false` on length mismatch WITHOUT branching on the content.
 */
export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
