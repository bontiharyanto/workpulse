-- Make AuditLog.actorId nullable so system-actor writes (retention
-- sweeps, cron-driven anonymisations, boot-time migrations) can
-- emit audit rows without impersonating a real user.
--
-- Existing rows all carry a non-null actor by construction; the
-- migration is purely widening the type.

ALTER TABLE "AuditLog"
  ALTER COLUMN "actorId" DROP NOT NULL;
