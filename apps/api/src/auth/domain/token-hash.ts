import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The refresh secret handed to the client (via HttpOnly cookie).
 * Never store this raw — only SHA-256 of it lives in DB.
 */
export function generateRefreshSecret(byteLength = 48): string {
  return randomBytes(byteLength).toString('base64url');
}

export function hashRefreshSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Constant-time comparison for two hex-encoded hashes to defeat timing side-channels.
 * Returns false for length mismatch (never throws).
 */
export function secureCompareHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
