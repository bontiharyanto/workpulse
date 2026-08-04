-- Fase 30a — Multi-Factor Authentication (TOTP)
--
-- Adds encrypted TOTP secret + activation timestamp to `User`, and a
-- separate table for one-time backup codes. Backup codes are on their
-- own table (not a JSON column on User) so that (a) individual usage
-- is atomically flip-able under load and (b) the audit trail of "which
-- code was used when" survives regeneration.
--
-- Existing rows default to MFA disabled — no user is forced into MFA
-- by this migration. Role-level enforcement (HR + SUPER_ADMIN must
-- enroll before non-`/auth` endpoints resolve) is a runtime concern
-- handled by `MfaEnrollmentGuard`, not a DB constraint.

ALTER TABLE "User"
  ADD COLUMN "mfaSecret" TEXT,
  ADD COLUMN "mfaEnabledAt" TIMESTAMP(3);

-- Refresh tokens issued before the MFA rollout should keep working
-- without forcing the whole active user base back through a fresh
-- login. `true` here is the safe default: legacy sessions had no
-- second factor to skip, so treating them as "MFA cleared" is
-- consistent with `JwtStrategy` coercing missing `mfaPassed` claims
-- to `true`. New rows are inserted with an explicit value by
-- `TokenService.createRefreshRow`.
ALTER TABLE "RefreshToken"
  ADD COLUMN "mfaVerified" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "MfaBackupCode" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "codeHash"  TEXT NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MfaBackupCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MfaBackupCode_codeHash_key" ON "MfaBackupCode" ("codeHash");
CREATE INDEX "MfaBackupCode_userId_usedAt_idx" ON "MfaBackupCode" ("userId", "usedAt");

ALTER TABLE "MfaBackupCode"
  ADD CONSTRAINT "MfaBackupCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
