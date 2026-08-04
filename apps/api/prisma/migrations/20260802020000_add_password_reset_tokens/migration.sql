-- =============================================================================
-- Migration: add_password_reset_tokens
-- -----------------------------------------------------------------------------
-- Adds the PasswordResetToken model powering `POST /auth/forgot-password`
-- and `POST /auth/reset-password`. See docs/WORKFLOW.md §0.6 for the flow.
--
-- Security notes:
--   * `tokenHash` is the SHA-256 hex digest of the raw token; the raw
--     token is never persisted. `@unique` prevents accidental duplicate
--     issuance from a hash collision (astronomical, but cheap to enforce).
--   * `(userId, usedAt)` index supports "how many pending tokens does
--     this user have?" checks and the cleanup cron (out of MVP scope).
--   * `expiresAt` gets its own index for the future TTL sweeper.
--   * FK to User uses CASCADE so hard-deleting a user removes their
--     dangling tokens.
-- =============================================================================

-- CreateTable
CREATE TABLE "PasswordResetToken" (
  "id"                 TEXT NOT NULL,
  "userId"             TEXT NOT NULL,
  "tokenHash"          TEXT NOT NULL,
  "expiresAt"          TIMESTAMP(3) NOT NULL,
  "usedAt"             TIMESTAMP(3),
  "requestedIp"        TEXT,
  "requestedUserAgent" TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key"
  ON "PasswordResetToken" ("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_usedAt_idx"
  ON "PasswordResetToken" ("userId", "usedAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx"
  ON "PasswordResetToken" ("expiresAt");

-- AddForeignKey
ALTER TABLE "PasswordResetToken"
  ADD CONSTRAINT "PasswordResetToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
