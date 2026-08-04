import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  Prisma,
  TimesheetConfig,
  TimesheetPeriodType,
  WeekStartDay,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Hard-coded safety bounds for the timesheet config form. Applied
 * before the DB write so we never store nonsense values that would
 * later blow up the period calculator.
 */
export const TIMESHEET_CONFIG_BOUNDS = {
  cutoffDayOfMonth: { min: 1, max: 28 },
  submitReminderStartDays: { min: 0, max: 30 },
  submitReminderMaxDays: { min: 1, max: 60 },
  approvalReminderStartDays: { min: 0, max: 30 },
  approvalReminderMaxDays: { min: 1, max: 60 },
} as const;

export interface TimesheetConfigUpdate {
  periodType?: TimesheetPeriodType;
  weekStartDay?: WeekStartDay;
  biweeklyAnchor?: string | null; // "YYYY-MM-DD"
  cutoffDayOfMonth?: number | null;
  timezone?: string;
  // ---- Fase 32f scheduler knobs ----
  autoGenerateEnabled?: boolean;
  reminderEnabled?: boolean;
  submitReminderStartDays?: number;
  submitReminderMaxDays?: number;
  approvalReminderStartDays?: number;
  approvalReminderMaxDays?: number;
}

/**
 * Reads and mutates the per-tenant `TimesheetConfig`. Missing rows are
 * lazily materialised on first read with sensible defaults, so a
 * newly-provisioned tenant works out of the box even before HR has
 * touched the settings page.
 */
@Injectable()
export class TimesheetConfigService {
  private readonly logger = new Logger(TimesheetConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getForCompany(companyId: string): Promise<TimesheetConfig> {
    const existing = await this.prisma.timesheetConfig.findUnique({
      where: { companyId },
    });
    if (existing) return existing;

    return this.prisma.timesheetConfig.upsert({
      where: { companyId },
      create: { companyId },
      update: {},
    });
  }

  async update(
    actor: { id: string; companyId: string },
    input: TimesheetConfigUpdate,
  ): Promise<TimesheetConfig> {
    // First shape validation. Cross-field rules (e.g. cutoff requires
    // cutoffDayOfMonth) happen after we've merged the current row so we
    // can honour partial updates without asking the caller to send the
    // whole config back.
    this.validateShape(input);

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.timesheetConfig.upsert({
        where: { companyId: actor.companyId },
        create: { companyId: actor.companyId },
        update: {},
      });

      const merged: TimesheetConfig = {
        ...current,
        periodType: input.periodType ?? current.periodType,
        weekStartDay: input.weekStartDay ?? current.weekStartDay,
        biweeklyAnchor:
          input.biweeklyAnchor === undefined
            ? current.biweeklyAnchor
            : input.biweeklyAnchor === null
              ? null
              : new Date(input.biweeklyAnchor + 'T00:00:00Z'),
        cutoffDayOfMonth:
          input.cutoffDayOfMonth === undefined
            ? current.cutoffDayOfMonth
            : input.cutoffDayOfMonth,
        timezone: input.timezone ?? current.timezone,
        autoGenerateEnabled:
          input.autoGenerateEnabled ?? current.autoGenerateEnabled,
        reminderEnabled: input.reminderEnabled ?? current.reminderEnabled,
        submitReminderStartDays:
          input.submitReminderStartDays ?? current.submitReminderStartDays,
        submitReminderMaxDays:
          input.submitReminderMaxDays ?? current.submitReminderMaxDays,
        approvalReminderStartDays:
          input.approvalReminderStartDays ?? current.approvalReminderStartDays,
        approvalReminderMaxDays:
          input.approvalReminderMaxDays ?? current.approvalReminderMaxDays,
      };

      this.validateCrossFields(merged);

      const updated = await tx.timesheetConfig.update({
        where: { companyId: actor.companyId },
        data: {
          periodType: merged.periodType,
          weekStartDay: merged.weekStartDay,
          biweeklyAnchor: merged.biweeklyAnchor,
          cutoffDayOfMonth: merged.cutoffDayOfMonth,
          timezone: merged.timezone,
          autoGenerateEnabled: merged.autoGenerateEnabled,
          reminderEnabled: merged.reminderEnabled,
          submitReminderStartDays: merged.submitReminderStartDays,
          submitReminderMaxDays: merged.submitReminderMaxDays,
          approvalReminderStartDays: merged.approvalReminderStartDays,
          approvalReminderMaxDays: merged.approvalReminderMaxDays,
          updatedById: actor.id,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'TIMESHEET_CONFIG_UPDATED',
          entityType: 'TimesheetConfig',
          entityId: updated.id,
          afterJson: {
            periodType: updated.periodType,
            weekStartDay: updated.weekStartDay,
            biweeklyAnchor: updated.biweeklyAnchor?.toISOString() ?? null,
            cutoffDayOfMonth: updated.cutoffDayOfMonth,
            timezone: updated.timezone,
            autoGenerateEnabled: updated.autoGenerateEnabled,
            reminderEnabled: updated.reminderEnabled,
            submitReminderStartDays: updated.submitReminderStartDays,
            submitReminderMaxDays: updated.submitReminderMaxDays,
            approvalReminderStartDays: updated.approvalReminderStartDays,
            approvalReminderMaxDays: updated.approvalReminderMaxDays,
          } as Prisma.InputJsonValue,
        },
      });

      return updated;
    });
  }

  private validateShape(input: TimesheetConfigUpdate): void {
    const errors: string[] = [];

    if (input.cutoffDayOfMonth !== undefined && input.cutoffDayOfMonth !== null) {
      const v = input.cutoffDayOfMonth;
      const { min, max } = TIMESHEET_CONFIG_BOUNDS.cutoffDayOfMonth;
      if (!Number.isInteger(v) || v < min || v > max) {
        errors.push(
          `cutoffDayOfMonth must be an integer in [${min}, ${max}] (got ${String(v)})`,
        );
      }
    }

    if (input.biweeklyAnchor !== undefined && input.biweeklyAnchor !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.biweeklyAnchor)) {
        errors.push('biweeklyAnchor must be a YYYY-MM-DD calendar date');
      } else {
        const parsed = new Date(input.biweeklyAnchor + 'T00:00:00Z');
        if (Number.isNaN(parsed.getTime())) {
          errors.push('biweeklyAnchor is not a real calendar date');
        }
      }
    }

    if (input.timezone !== undefined) {
      if (!isValidTimezone(input.timezone)) {
        errors.push(`timezone "${input.timezone}" is not a valid IANA zone`);
      }
    }

    // Reminder cadence numeric bounds. Cross-field (start <= max) is
    // enforced in validateCrossFields once we've merged with the row.
    const reminderChecks: Array<{
      key: keyof TimesheetConfigUpdate;
      bounds: { min: number; max: number };
    }> = [
      {
        key: 'submitReminderStartDays',
        bounds: TIMESHEET_CONFIG_BOUNDS.submitReminderStartDays,
      },
      {
        key: 'submitReminderMaxDays',
        bounds: TIMESHEET_CONFIG_BOUNDS.submitReminderMaxDays,
      },
      {
        key: 'approvalReminderStartDays',
        bounds: TIMESHEET_CONFIG_BOUNDS.approvalReminderStartDays,
      },
      {
        key: 'approvalReminderMaxDays',
        bounds: TIMESHEET_CONFIG_BOUNDS.approvalReminderMaxDays,
      },
    ];
    for (const c of reminderChecks) {
      const v = input[c.key];
      if (v !== undefined) {
        if (typeof v !== 'number' || !Number.isInteger(v) || v < c.bounds.min || v > c.bounds.max) {
          errors.push(
            `${c.key} must be an integer in [${c.bounds.min}, ${c.bounds.max}] (got ${String(v)})`,
          );
        }
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'TIMESHEET_CONFIG_INVALID',
        message: 'Timesheet configuration values are invalid.',
        details: errors,
      });
    }
  }

  private validateCrossFields(merged: TimesheetConfig): void {
    const errors: string[] = [];

    if (
      merged.periodType === TimesheetPeriodType.CUTOFF &&
      merged.cutoffDayOfMonth === null
    ) {
      errors.push(
        'periodType=CUTOFF requires cutoffDayOfMonth to be set (1..28).',
      );
    }

    // BIWEEKLY without an anchor still works (the calculator falls back
    // to a deterministic anchor), so we don't force it — but we do warn
    // via the log so HR knows to set one for stable period boundaries.
    if (
      merged.periodType === TimesheetPeriodType.BIWEEKLY &&
      !merged.biweeklyAnchor
    ) {
      this.logger.warn(
        `Company ${merged.companyId} set BIWEEKLY without biweeklyAnchor; using calculator fallback.`,
      );
    }

    if (merged.submitReminderMaxDays < merged.submitReminderStartDays) {
      errors.push(
        'submitReminderMaxDays must be >= submitReminderStartDays.',
      );
    }
    if (merged.approvalReminderMaxDays < merged.approvalReminderStartDays) {
      errors.push(
        'approvalReminderMaxDays must be >= approvalReminderStartDays.',
      );
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'TIMESHEET_CONFIG_INVALID',
        message: 'Timesheet configuration is inconsistent.',
        details: errors,
      });
    }
  }
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
