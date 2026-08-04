import type { UserRole } from './user-role';

/**
 * Shape attached to `request.user` after `JwtAuthGuard` succeeds.
 * Kept minimal — extra data is fetched via services when needed.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  companyId: string;
  departmentId: string | null;
  role: UserRole;
  /**
   * True when the caller is on an admin-issued temporary password and
   * MUST rotate it before any non-`/auth/*` endpoint will accept them.
   * The `MustChangePasswordGuard` uses this flag to short-circuit
   * requests; the FE uses it to force-navigate to `/change-password`.
   *
   * Optional to preserve compatibility with legacy JWTs signed BEFORE
   * this field was baked into the token payload. Runtime code MUST use
   * `x.mustChangePassword === true` (never `!x.mustChangePassword`) to
   * default `undefined` to false — that's the safe direction: we never
   * accidentally lock out a user with a stale token.
   */
  mustChangePassword?: boolean;
  /**
   * True when the current access token was issued (or upgraded) after
   * the caller cleared the MFA second factor. Cleared to `false` for
   * the short-lived "pre-MFA" token minted at password-only login when
   * `User.mfaEnabledAt` is non-null.
   *
   * Optional for the same reason as `mustChangePassword` — legacy tokens
   * predate the field and MUST be treated as `mfaPassed=true` (fail
   * open, since those users didn't have MFA enrolled anyway; guards
   * only ever reject on `mfaPassed === false`).
   */
  mfaPassed?: boolean;
  /**
   * True iff `User.mfaEnabledAt` was non-null at issuance time. Lets
   * the guards distinguish "session hasn't cleared MFA yet" (block)
   * from "MFA isn't set up for this user" (allow). Never a security
   * decision on its own — always paired with `mfaPassed`.
   */
  mfaEnabled?: boolean;
}
