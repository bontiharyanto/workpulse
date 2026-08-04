-- Fase 32e — Outbound webhooks.
--
-- WebhookEndpoint: per-tenant subscription. Secret stored as
-- AES-256-GCM ciphertext (base64 bundle, wire format identical to
-- User.mfaSecret).
--
-- WebhookDelivery: append-only delivery log. Retry attempts mutate
-- status / counters / next-attempt / response fields but the payload
-- and signature are frozen at enqueue-time so replays can prove what
-- we sent.

CREATE TYPE "WebhookEventType" AS ENUM (
  'TIMESHEET_EXPORT_CREATED',
  'TIMESHEET_EXPORT_SHARE_CREATED'
);

CREATE TYPE "WebhookDeliveryStatus" AS ENUM (
  'PENDING',
  'SUCCEEDED',
  'FAILED'
);

CREATE TABLE "WebhookEndpoint" (
  "id"                  TEXT NOT NULL,
  "companyId"           TEXT NOT NULL,
  "createdById"         TEXT NOT NULL,
  "url"                 TEXT NOT NULL,
  "description"         TEXT,
  "secretCipher"        TEXT NOT NULL,
  "events"              "WebhookEventType"[] NOT NULL,
  "active"              BOOLEAN NOT NULL DEFAULT true,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "lastSuccessAt"       TIMESTAMP(3),
  "lastFailureAt"       TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WebhookEndpoint"
  ADD CONSTRAINT "WebhookEndpoint_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookEndpoint"
  ADD CONSTRAINT "WebhookEndpoint_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "WebhookEndpoint_companyId_active_idx"
  ON "WebhookEndpoint" ("companyId", "active");

CREATE TABLE "WebhookDelivery" (
  "id"                      TEXT NOT NULL,
  "endpointId"              TEXT NOT NULL,
  "companyId"               TEXT NOT NULL,
  "eventType"               "WebhookEventType" NOT NULL,
  "sourceId"                TEXT NOT NULL,
  "payloadJson"             JSONB NOT NULL,
  "signatureHeader"         TEXT NOT NULL,
  "status"                  "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount"            INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt"           TIMESTAMP(3),
  "lastResponseStatus"      INTEGER,
  "lastResponseBodySnippet" TEXT,
  "lastError"               TEXT,
  "deliveredAt"             TIMESTAMP(3),
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_endpointId_fkey"
  FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "WebhookDelivery_endpointId_eventType_sourceId_key"
  ON "WebhookDelivery" ("endpointId", "eventType", "sourceId");

CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx"
  ON "WebhookDelivery" ("status", "nextAttemptAt");

CREATE INDEX "WebhookDelivery_companyId_createdAt_idx"
  ON "WebhookDelivery" ("companyId", "createdAt");

-- Same immutability posture as AuditLog + TimesheetExport: the payload
-- and signature are frozen at enqueue-time, so operators can't rewrite
-- what we told the vendor. Worker-owned columns (status, attempts,
-- response snippet) still need UPDATE, so we only revoke DELETE.
REVOKE DELETE ON TABLE "WebhookDelivery" FROM PUBLIC;
