-- Fase 31g — Breach Notification Ledger.

-- Extend the shared `NotificationType` enum with the reminder event.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BREACH_DEADLINE_WARNING';

--
-- Data model for UU 27/2022 Pelindungan Data Pribadi Pasal 46 ayat (3)
-- + GDPR Art. 33-34 compliance. `BreachIncident` is the head record;
-- `BreachTimelineEvent` is append-only (UPDATE + DELETE revoked at
-- DB level so a compromised app cannot rewrite history).

CREATE TYPE "BreachSeverity" AS ENUM (
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL'
);

CREATE TYPE "BreachCategory" AS ENUM (
  'CONFIDENTIALITY',
  'INTEGRITY',
  'AVAILABILITY',
  'MIXED'
);

CREATE TYPE "BreachStatus" AS ENUM (
  'DETECTED',
  'CONTAINED',
  'NOTIFIED_AUTHORITY',
  'NOTIFIED_SUBJECTS',
  'CLOSED'
);

CREATE TYPE "BreachTimelineEventType" AS ENUM (
  'CREATED',
  'UPDATED',
  'STATUS_ADVANCED',
  'AUTHORITY_NOTIFIED',
  'SUBJECTS_NOTIFIED',
  'NOTE_ADDED',
  'DEADLINE_WARNED',
  'EXPORTED',
  'CLOSED'
);

CREATE TABLE "BreachIncident" (
  "id"                          TEXT NOT NULL,
  "companyId"                   TEXT NOT NULL,
  "title"                       TEXT NOT NULL,
  "description"                 TEXT NOT NULL,
  "severity"                    "BreachSeverity" NOT NULL,
  "category"                    "BreachCategory" NOT NULL,
  "status"                      "BreachStatus" NOT NULL DEFAULT 'DETECTED',
  "detectedAt"                  TIMESTAMP(3) NOT NULL,
  "occurredAt"                  TIMESTAMP(3),
  "containedAt"                 TIMESTAMP(3),
  "authorityNotifiedAt"         TIMESTAMP(3),
  "subjectsNotifiedAt"          TIMESTAMP(3),
  "closedAt"                    TIMESTAMP(3),
  "affectedUserCount"           INTEGER NOT NULL DEFAULT 0,
  "affectedDataCategories"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "affectedSystems"             TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "containmentActions"          TEXT NOT NULL DEFAULT '',
  "rootCause"                   TEXT,
  "remediation"                 TEXT,
  "authorityNotificationRef"    TEXT,
  "subjectNotificationTemplate" TEXT,
  "reportedById"                TEXT NOT NULL,
  "assignedToId"                TEXT,
  "createdAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BreachIncident_pkey" PRIMARY KEY ("id"),
  -- Occurrence cannot be in the future relative to detection.
  CONSTRAINT "BreachIncident_occurredAt_check"
    CHECK ("occurredAt" IS NULL OR "occurredAt" <= "detectedAt"),
  -- Non-negative impact count.
  CONSTRAINT "BreachIncident_affectedUserCount_check"
    CHECK ("affectedUserCount" >= 0)
);

CREATE INDEX "BreachIncident_companyId_status_idx"
  ON "BreachIncident" ("companyId", "status");
CREATE INDEX "BreachIncident_companyId_detectedAt_idx"
  ON "BreachIncident" ("companyId", "detectedAt");
CREATE INDEX "BreachIncident_companyId_severity_idx"
  ON "BreachIncident" ("companyId", "severity");

ALTER TABLE "BreachIncident"
  ADD CONSTRAINT "BreachIncident_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BreachIncident"
  ADD CONSTRAINT "BreachIncident_reportedById_fkey"
  FOREIGN KEY ("reportedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BreachIncident"
  ADD CONSTRAINT "BreachIncident_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BreachTimelineEvent" (
  "id"         TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "companyId"  TEXT NOT NULL,
  "eventType"  "BreachTimelineEventType" NOT NULL,
  "note"       TEXT NOT NULL,
  "metadata"   JSONB,
  "actorId"    TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BreachTimelineEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BreachTimelineEvent_incidentId_occurredAt_idx"
  ON "BreachTimelineEvent" ("incidentId", "occurredAt");
CREATE INDEX "BreachTimelineEvent_companyId_occurredAt_idx"
  ON "BreachTimelineEvent" ("companyId", "occurredAt");

ALTER TABLE "BreachTimelineEvent"
  ADD CONSTRAINT "BreachTimelineEvent_incidentId_fkey"
  FOREIGN KEY ("incidentId") REFERENCES "BreachIncident"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BreachTimelineEvent"
  ADD CONSTRAINT "BreachTimelineEvent_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BreachTimelineEvent"
  ADD CONSTRAINT "BreachTimelineEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Immutability guarantee: no UPDATE or DELETE on timeline events at
-- the DB level. Application code emits new rows only; if a mistake
-- needs correction, a compensating event is inserted with an explicit
-- narrative (audit-log parity).
REVOKE UPDATE, DELETE ON TABLE "BreachTimelineEvent" FROM PUBLIC;
