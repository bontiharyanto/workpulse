import { authenticator } from 'otplib';

/**
 * Thin wrapper around `otplib.authenticator` that pins the algorithm
 * parameters compatible with **every** major authenticator app
 * (Google Authenticator, Microsoft Authenticator, Authy, 1Password,
 * Bitwarden). Do not change these values without a coordinated
 * migration — existing enrolled secrets are keyed to these settings.
 *
 * - HMAC-SHA1 (the RFC 6238 default; SHA256/512 are optional and not
 *   universally supported by mobile authenticators as of 2026).
 * - 30-second time step.
 * - 6-digit code.
 * - **±1 step** verification window — accepts the current, previous,
 *   and next code. That's the sweet spot: it tolerates clock drift on
 *   the user's device (typical) without opening a bigger brute-force
 *   window than necessary. Rate limiting on `/auth/mfa/verify`
 *   handles online brute-force from a stolen password.
 */

// SHA-1 is otplib's default for the `authenticator` preset — it's
// the RFC 6238 baseline every authenticator app supports. We do NOT
// override it here to avoid pulling in the `HashAlgorithms` enum
// (only re-exported from `@otplib/core`, not the top-level `otplib`).
authenticator.options = {
  window: 1,
  step: 30,
  digits: 6,
};

export interface TotpEnrollmentSecret {
  /** Base32 secret. Store encrypted; NEVER log. */
  secret: string;
  /** `otpauth://` URI encoding secret + issuer + label. Feed to a QR generator. */
  otpauthUrl: string;
}

/**
 * Generate a fresh TOTP secret for a user, ready to be shown in an
 * enrollment QR code. The secret is only "committed" once the user
 * proves possession by submitting a valid 6-digit code — the service
 * layer is responsible for that two-phase dance.
 */
export function generateTotpEnrollment(args: {
  accountName: string;
  issuer: string;
}): TotpEnrollmentSecret {
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(args.accountName, args.issuer, secret);
  return { secret, otpauthUrl };
}

/**
 * Verify a 6-digit code against the base32 secret. Returns `true`
 * only if the code is valid within the configured window.
 *
 * Never surface the secret in error messages or logs. Any exception
 * from `authenticator.check` (e.g. malformed base32) is coerced to
 * `false` — the caller sees "wrong code" and can rate-limit.
 */
export function verifyTotp(code: string, secret: string): boolean {
  try {
    return authenticator.check(code.trim(), secret);
  } catch {
    return false;
  }
}
