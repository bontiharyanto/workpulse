import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stripe-style detached signature header for outbound webhooks.
 *
 * Header value:
 *
 *   X-Workpulse-Signature: t=<unix-seconds>,v1=<hex-hmac-sha256>
 *
 * Signed string = `${t}.${rawBody}` — timestamp OUTSIDE the JSON body
 * so a vendor doesn't have to re-parse the payload to verify. HMAC key
 * is per-endpoint (see `WebhookEndpoint.secretCipher`).
 *
 * Vendors verify by:
 *   1. Parsing `t` and `v1` from the header.
 *   2. Refusing if `abs(now - t) > tolerance` (they pick tolerance,
 *      recommend 5 minutes) — defeats replay attacks.
 *   3. Recomputing `HMAC_SHA256(secret, "${t}.${rawBody}")` and
 *      timing-safe comparing with `v1`.
 *
 * This module is pure so the unit test doesn't need Prisma / Nest.
 */

export interface Signature {
  timestampSec: number;
  signatureHex: string;
  header: string;
}

export function sign(
  secret: string,
  rawBody: string,
  now: number = Date.now(),
): Signature {
  const timestampSec = Math.floor(now / 1000);
  const signatureHex = createHmac('sha256', secret)
    .update(`${timestampSec}.${rawBody}`)
    .digest('hex');
  return {
    timestampSec,
    signatureHex,
    header: `t=${timestampSec},v1=${signatureHex}`,
  };
}

export type VerifyFailure =
  | 'MALFORMED_HEADER'
  | 'INVALID_SIGNATURE'
  | 'TIMESTAMP_TOO_OLD'
  | 'TIMESTAMP_TOO_NEW';

export type VerifyResult =
  | { ok: true; timestampSec: number }
  | { ok: false; reason: VerifyFailure };

/**
 * Parity verifier — mostly used by the E2E receiver + unit tests, but
 * available for anyone implementing an inbound verifier.
 */
export function verify(
  secret: string,
  rawBody: string,
  header: string,
  toleranceSec = 300,
  now: number = Date.now(),
): VerifyResult {
  const parts = header.split(',').reduce<Record<string, string>>((acc, kv) => {
    const eq = kv.indexOf('=');
    if (eq > 0) acc[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
    return acc;
  }, {});
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) {
    return { ok: false, reason: 'MALFORMED_HEADER' };
  }
  const nowSec = Math.floor(now / 1000);
  if (nowSec - t > toleranceSec) return { ok: false, reason: 'TIMESTAMP_TOO_OLD' };
  if (t - nowSec > toleranceSec) return { ok: false, reason: 'TIMESTAMP_TOO_NEW' };

  const expectedHex = createHmac('sha256', secret)
    .update(`${t}.${rawBody}`)
    .digest('hex');

  const a = Buffer.from(expectedHex, 'hex');
  let b: Buffer;
  try {
    b = Buffer.from(v1, 'hex');
  } catch {
    return { ok: false, reason: 'MALFORMED_HEADER' };
  }
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'INVALID_SIGNATURE' };
  }
  return { ok: true, timestampSec: t };
}
