import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Pure HMAC-SHA256 signing for the Fase 32d timesheet-export share
 * URLs. Kept free of NestJS + Prisma imports so unit tests can exercise
 * the constant-time path without any framework noise.
 *
 * Payload shape (canonical, do NOT reorder):
 *
 *   canonical = `${shareId}:${expiresAtMs}`
 *   signature = base64url( HMAC_SHA256(secret, canonical) )
 *
 * Both fields are also emitted on the URL as query params so the
 * verifier can rebuild the canonical string without hitting the DB.
 * The DB check for revocation is a second gate on top of the signature.
 */

export interface SharePayload {
  shareId: string;
  expiresAtMs: number;
}

/** RFC 4648 §5 base64url encoding, no padding. */
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

function canonical(payload: SharePayload): string {
  return `${payload.shareId}:${payload.expiresAtMs}`;
}

export function sign(secret: string, payload: SharePayload): string {
  const mac = createHmac('sha256', secret).update(canonical(payload)).digest();
  return b64url(mac);
}

export type VerifyFailure = 'INVALID_SIGNATURE' | 'MALFORMED_SIGNATURE' | 'EXPIRED';

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure };

/**
 * Constant-time verifier. Callers should short-circuit on the first
 * `ok: false` — every branch here is designed to run in the same time
 * envelope so a timing side-channel can't distinguish "bad shareId"
 * from "bad signature".
 */
export function verify(
  secret: string,
  payload: SharePayload,
  presentedSignature: string,
  now: number = Date.now(),
): VerifyResult {
  const expected = createHmac('sha256', secret).update(canonical(payload)).digest();

  let presented: Buffer;
  try {
    presented = b64urlDecode(presentedSignature);
  } catch {
    return { ok: false, reason: 'MALFORMED_SIGNATURE' };
  }
  if (presented.length !== expected.length) {
    return { ok: false, reason: 'MALFORMED_SIGNATURE' };
  }
  if (!timingSafeEqual(presented, expected)) {
    return { ok: false, reason: 'INVALID_SIGNATURE' };
  }

  // Expiry check runs AFTER signature verify so a tampered `expires`
  // value can't be used to distinguish valid-but-expired links from
  // invalid-signature links.
  if (payload.expiresAtMs <= now) {
    return { ok: false, reason: 'EXPIRED' };
  }

  return { ok: true };
}
