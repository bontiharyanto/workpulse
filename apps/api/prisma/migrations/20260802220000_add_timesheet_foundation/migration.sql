-- CreateEnum: TimesheetPeriodType
CREATE TYPE "TimesheetPeriodType" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'CUTOFF');

-- CreateEnum: WeekStartDay
CREATE TYPE "WeekStartDay" AS ENUM ('SUNDAY', 'MONDAY');

-- CreateEnum: TimesheetEntryKind
CREATE TYPE "TimesheetEntryKind" AS ENUM ('WORKING', 'HOLIDAY', 'WEEKEND', 'LEAVE', 'ABSENT');

-- CreateTable: TimesheetConfig
CREATE TABLE "TimesheetConfig" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "periodType"       "TimesheetPeriodType" NOT NULL DEFAULT 'MONTHLY',
  "weekStartDay"     "WeekStartDay" NOT NULL DEFAULT 'MONDAY',
  "biweeklyAnchor"   DATE,
  "cutoffDayOfMonth" INTEGER,
  "timezone"         TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  "updatedById"      TEXT,

  CONSTRAINT "TimesheetConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TimesheetConfig_companyId_key"
  ON "TimesheetConfig" ("companyId");

ALTER TABLE "TimesheetConfig"
  ADD CONSTRAINT "TimesheetConfig_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimesheetConfig"
  ADD CONSTRAINT "TimesheetConfig_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: TimesheetPeriod
CREATE TABLE "TimesheetPeriod" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "periodType"  "TimesheetPeriodType" NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd"   DATE NOT NULL,
  "label"       TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TimesheetPeriod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TimesheetPeriod_companyId_periodStart_periodEnd_key"
  ON "TimesheetPeriod" ("companyId", "periodStart", "periodEnd");

CREATE INDEX "TimesheetPeriod_companyId_periodEnd_idx"
  ON "TimesheetPeriod" ("companyId", "periodEnd");

ALTER TABLE "TimesheetPeriod"
  ADD CONSTRAINT "TimesheetPeriod_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: Timesheet
CREATE TABLE "Timesheet" (
  "id"                     TEXT NOT NULL,
  "companyId"              TEXT NOT NULL,
  "userId"                 TEXT NOT NULL,
  "periodId"               TEXT NOT NULL,
  "totalRegularHours"      DECIMAL(7, 2) NOT NULL DEFAULT 0,
  "totalOvertimeHours"     DECIMAL(7, 2) NOT NULL DEFAULT 0,
  "totalLeaveDays"         INTEGER NOT NULL DEFAULT 0,
  "totalAbsentDays"        INTEGER NOT NULL DEFAULT 0,
  "totalHolidays"          INTEGER NOT NULL DEFAULT 0,
  "totalWorkingDays"       INTEGER NOT NULL DEFAULT 0,
  "totalLateMinutes"       INTEGER NOT NULL DEFAULT 0,
  "totalEarlyLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
  "generatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Timesheet_userId_periodId_key"
  ON "Timesheet" ("userId", "periodId");

CREATE INDEX "Timesheet_companyId_periodId_idx"
  ON "Timesheet" ("companyId", "periodId");

CREATE INDEX "Timesheet_userId_periodId_idx"
  ON "Timesheet" ("userId", "periodId");

ALTER TABLE "Timesheet"
  ADD CONSTRAINT "Timesheet_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Timesheet"
  ADD CONSTRAINT "Timesheet_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Timesheet"
  ADD CONSTRAINT "Timesheet_periodId_fkey"
  FOREIGN KEY ("periodId") REFERENCES "TimesheetPeriod" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: TimesheetEntry
CREATE TABLE "TimesheetEntry" (
  "id"                TEXT NOT NULL,
  "timesheetId"       TEXT NOT NULL,
  "workDate"          DATE NOT NULL,
  "kind"              "TimesheetEntryKind" NOT NULL DEFAULT 'WORKING',
  "expectedHours"     DECIMAL(5, 2),
  "regularHours"      DECIMAL(5, 2) NOT NULL DEFAULT 0,
  "overtimeHours"     DECIMAL(5, 2) NOT NULL DEFAULT 0,
  "leaveHours"        DECIMAL(5, 2) NOT NULL DEFAULT 0,
  "lateMinutes"       INTEGER NOT NULL DEFAULT 0,
  "earlyLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
  "sourceRefs"        JSONB,
  "note"              TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TimesheetEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TimesheetEntry_timesheetId_workDate_key"
  ON "TimesheetEntry" ("timesheetId", "workDate");

CREATE INDEX "TimesheetEntry_workDate_idx"
  ON "TimesheetEntry" ("workDate");

ALTER TABLE "TimesheetEntry"
  ADD CONSTRAINT "TimesheetEntry_timesheetId_fkey"
  FOREIGN KEY ("timesheetId") REFERENCES "Timesheet" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
