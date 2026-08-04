-- Force self-service password change on next login for users provisioned
-- with an admin-issued temporary password. Existing rows default to `false`
-- so live sessions are unaffected; new rows created via the user-admin
-- endpoints will explicitly set this to `true`.
ALTER TABLE "User"
ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
