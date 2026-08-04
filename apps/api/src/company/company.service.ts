import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Company, Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import type { CompanyConfigDto } from './dto/company-config.dto';
import type { UpdateCompanyConfigDto } from './dto/update-company-config.dto';
import { diffChangedKeys } from './domain/config-diff';
import { InvalidTimezoneError, assertValidTimezone } from './domain/timezone';

type CompanyConfigColumns = Pick<
  Company,
  | 'id'
  | 'name'
  | 'slug'
  | 'timezone'
  | 'overtimeHourlyRate'
  | 'overtimeWeekdayMultiplier'
  | 'overtimeWeekendMultiplier'
  | 'overtimeHolidayMultiplier'
  | 'overtimeMaxHoursPerDay'
  | 'overtimeSubmitWindowDays'
  | 'overtimeCompleteGraceDays'
  | 'payrollLockedUntil'
>;

/**
 * Tenant-configuration service. Every operation is scoped to the caller's
 * `companyId` — there is intentionally no way to load or mutate another
 * tenant's config through this service, even for SUPER_ADMIN.
 *
 * Updates are guarded by:
 *   - class-validator on the DTO (numeric bounds, string length),
 *   - domain-level timezone validation (IANA runtime check),
 *   - AuditLog persistence inside the same transaction as the update.
 */
@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(actor: AuthenticatedUser): Promise<CompanyConfigDto> {
    const row = await this.prisma.company.findFirst({
      where: { id: actor.companyId, deletedAt: null },
      select: this.selectFields(),
    });
    if (!row) throw new NotFoundException('COMPANY_NOT_FOUND');
    return this.toDto(row);
  }

  async updateConfig(
    actor: AuthenticatedUser,
    input: UpdateCompanyConfigDto,
  ): Promise<CompanyConfigDto> {
    // Reject empty PATCH bodies early — otherwise we would run a no-op
    // transaction and still emit an audit log row for nothing.
    if (Object.keys(input).length === 0) {
      throw new BadRequestException('EMPTY_UPDATE');
    }

    if (input.timezone !== undefined) {
      try {
        assertValidTimezone(input.timezone);
      } catch (e) {
        if (e instanceof InvalidTimezoneError) {
          throw new BadRequestException({
            code: e.code,
            message: e.message,
          });
        }
        throw e;
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await tx.company.findFirst({
        where: { id: actor.companyId, deletedAt: null },
        select: this.selectFields(),
      });
      if (!before) throw new NotFoundException('COMPANY_NOT_FOUND');

      const data: Prisma.CompanyUpdateInput = {};
      if (input.name !== undefined) data.name = input.name.trim();
      if (input.timezone !== undefined) data.timezone = input.timezone.trim();
      if (input.overtimeHourlyRate !== undefined) {
        data.overtimeHourlyRate = input.overtimeHourlyRate;
      }
      if (input.overtimeWeekdayMultiplier !== undefined) {
        data.overtimeWeekdayMultiplier = input.overtimeWeekdayMultiplier;
      }
      if (input.overtimeWeekendMultiplier !== undefined) {
        data.overtimeWeekendMultiplier = input.overtimeWeekendMultiplier;
      }
      if (input.overtimeHolidayMultiplier !== undefined) {
        data.overtimeHolidayMultiplier = input.overtimeHolidayMultiplier;
      }
      if (input.overtimeMaxHoursPerDay !== undefined) {
        data.overtimeMaxHoursPerDay = input.overtimeMaxHoursPerDay;
      }
      if (input.overtimeSubmitWindowDays !== undefined) {
        data.overtimeSubmitWindowDays = input.overtimeSubmitWindowDays;
      }
      if (input.overtimeCompleteGraceDays !== undefined) {
        data.overtimeCompleteGraceDays = input.overtimeCompleteGraceDays;
      }
      if (input.payrollLockedUntil !== undefined) {
        // Explicit `null` clears the cutoff — this is deliberate.
        // Bumping it backward is technically legal but has real
        // consequences (see ADR-0010); we do NOT prevent it here
        // because the SUPER_ADMIN taxonomy is our defense-in-depth.
        data.payrollLockedUntil = input.payrollLockedUntil
          ? parsePayrollDate(input.payrollLockedUntil)
          : null;
      }

      const after = await tx.company.update({
        where: { id: before.id },
        data,
        select: this.selectFields(),
      });

      const beforeDto = this.toDto(before);
      const afterDto = this.toDto(after);
      const { before: beforeDiff, after: afterDiff } = diffChangedKeys(
        beforeDto as unknown as Record<string, unknown>,
        afterDto as unknown as Record<string, unknown>,
      );

      // Only write an audit row when something *actually* changed. A PATCH
      // that repeats current values (idempotent replay from the UI) should
      // not clutter the audit trail.
      if (Object.keys(afterDiff).length > 0) {
        await tx.auditLog.create({
          data: {
            companyId: actor.companyId,
            actorId: actor.id,
            action: 'COMPANY_CONFIG_UPDATED',
            entityType: 'Company',
            entityId: before.id,
            beforeJson: beforeDiff as Prisma.InputJsonValue,
            afterJson: afterDiff as Prisma.InputJsonValue,
          },
        });
      }

      return after;
    });

    return this.toDto(updated);
  }

  private selectFields(): Record<keyof CompanyConfigColumns, true> {
    return {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      overtimeHourlyRate: true,
      overtimeWeekdayMultiplier: true,
      overtimeWeekendMultiplier: true,
      overtimeHolidayMultiplier: true,
      overtimeMaxHoursPerDay: true,
      overtimeSubmitWindowDays: true,
      overtimeCompleteGraceDays: true,
      payrollLockedUntil: true,
    };
  }

  private toDto(row: CompanyConfigColumns): CompanyConfigDto {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      timezone: row.timezone,
      overtimeHourlyRate:
        row.overtimeHourlyRate === null ? null : Number(row.overtimeHourlyRate.toString()),
      overtimeWeekdayMultiplier: Number(row.overtimeWeekdayMultiplier.toString()),
      overtimeWeekendMultiplier: Number(row.overtimeWeekendMultiplier.toString()),
      overtimeHolidayMultiplier: Number(row.overtimeHolidayMultiplier.toString()),
      overtimeMaxHoursPerDay: Number(row.overtimeMaxHoursPerDay.toString()),
      overtimeSubmitWindowDays: row.overtimeSubmitWindowDays,
      overtimeCompleteGraceDays: row.overtimeCompleteGraceDays,
      payrollLockedUntil: row.payrollLockedUntil
        ? row.payrollLockedUntil.toISOString().slice(0, 10)
        : null,
    };
  }
}

/**
 * Parse a YYYY-MM-DD calendar date into a UTC-midnight Date suitable for
 * Postgres `@db.Date`. Throws `BadRequestException` on malformed input so
 * the API surface stays consistent with the DTO layer's error shape.
 */
function parsePayrollDate(iso: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new BadRequestException({
      code: 'INVALID_DATE',
      message: 'payrollLockedUntil must be YYYY-MM-DD',
    });
  }
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) {
    throw new BadRequestException({
      code: 'INVALID_DATE',
      message: 'payrollLockedUntil must be YYYY-MM-DD',
    });
  }
  return dt;
}
