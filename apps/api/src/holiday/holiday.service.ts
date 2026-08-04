import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Holiday, Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

import type {
  BulkImportHolidaysResponseDto,
  HolidayResponseDto,
} from './dto/holiday-response.dto';

export interface CreateHolidayInput {
  date: string; // YYYY-MM-DD
  name: string;
}

export interface UpdateHolidayInput {
  date?: string;
  name?: string;
}

@Injectable()
export class HolidayService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthenticatedUser, year?: number): Promise<HolidayResponseDto[]> {
    const where: Prisma.HolidayWhereInput = { companyId: actor.companyId };
    if (year !== undefined) {
      where.date = {
        gte: new Date(`${year}-01-01T00:00:00.000Z`),
        lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
      };
    }
    const rows = await this.prisma.holiday.findMany({
      where,
      orderBy: { date: 'asc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(
    actor: AuthenticatedUser,
    input: CreateHolidayInput,
  ): Promise<HolidayResponseDto> {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.holiday.create({
          data: {
            companyId: actor.companyId,
            date: toUtcDate(input.date),
            name: input.name.trim(),
          },
        });
        await tx.auditLog.create({
          data: {
            companyId: actor.companyId,
            actorId: actor.id,
            action: 'HOLIDAY_CREATED',
            entityType: 'Holiday',
            entityId: row.id,
            afterJson: row as unknown as Prisma.InputJsonValue,
          },
        });
        return row;
      });
      return this.toDto(created);
    } catch (err) {
      throw this.mapUniqueConflict(err);
    }
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateHolidayInput,
  ): Promise<HolidayResponseDto> {
    const existing = await this.findOwn(actor.companyId, id);

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.holiday.update({
          where: { id },
          data: {
            date: input.date ? toUtcDate(input.date) : undefined,
            name: input.name?.trim() ?? undefined,
          },
        });
        await tx.auditLog.create({
          data: {
            companyId: actor.companyId,
            actorId: actor.id,
            action: 'HOLIDAY_UPDATED',
            entityType: 'Holiday',
            entityId: row.id,
            beforeJson: existing as unknown as Prisma.InputJsonValue,
            afterJson: row as unknown as Prisma.InputJsonValue,
          },
        });
        return row;
      });
      return this.toDto(updated);
    } catch (err) {
      throw this.mapUniqueConflict(err);
    }
  }

  async remove(actor: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findOwn(actor.companyId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.holiday.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'HOLIDAY_DELETED',
          entityType: 'Holiday',
          entityId: id,
          beforeJson: existing as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }

  /**
   * Bulk import. Duplicates by `(companyId, date)` are silently skipped —
   * caller sees `{inserted, skipped}` counts for observability. All-or-nothing
   * semantics are intentionally avoided so a partially-good paste succeeds.
   */
  async bulkImport(
    actor: AuthenticatedUser,
    items: ReadonlyArray<CreateHolidayInput>,
  ): Promise<BulkImportHolidaysResponseDto> {
    // Dedupe within the request payload (same date given twice → 1 insert attempt)
    const seen = new Set<string>();
    const clean: CreateHolidayInput[] = [];
    for (const item of items) {
      if (seen.has(item.date)) continue;
      seen.add(item.date);
      clean.push({ date: item.date, name: item.name.trim() });
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.holiday.createMany({
        data: clean.map((c) => ({
          companyId: actor.companyId,
          date: toUtcDate(c.date),
          name: c.name,
        })),
        skipDuplicates: true,
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'HOLIDAY_BULK_IMPORTED',
          entityType: 'Holiday',
          entityId: 'BULK',
          afterJson: {
            inserted: result.count,
            skipped: clean.length - result.count,
            dates: clean.map((c) => c.date),
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return { inserted: result.count, skipped: clean.length - result.count };
    });
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async findOwn(companyId: string, id: string): Promise<Holiday> {
    const row = await this.prisma.holiday.findFirst({
      where: { id, companyId },
    });
    if (!row) throw new NotFoundException('HOLIDAY_NOT_FOUND');
    return row;
  }

  private mapUniqueConflict(err: unknown): Error {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: unknown }).code === 'P2002'
    ) {
      return new ConflictException('HOLIDAY_DATE_TAKEN');
    }
    return err instanceof Error ? err : new Error('UNKNOWN_ERROR');
  }

  private toDto(row: Holiday): HolidayResponseDto {
    return {
      id: row.id,
      companyId: row.companyId,
      date: row.date.toISOString().slice(0, 10),
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/**
 * Convert `YYYY-MM-DD` → midnight UTC `Date`. Holidays are calendar-day
 * artifacts, stored as `@db.Date` — we normalize to UTC midnight to match how
 * `leave.service.ts` queries the range.
 */
function toUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
