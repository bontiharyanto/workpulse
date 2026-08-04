import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  TimesheetExportFormat,
  TimesheetExportMode,
  TimesheetStatus,
} from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatcher } from '../webhook/webhook-dispatcher.service';

import {
  buildDetailRows,
  buildSummaryRow,
  DETAIL_COLUMNS,
  SUMMARY_COLUMNS,
  type PayrollColumn,
  type PayrollRow,
  type PayrollSourceTimesheet,
} from './domain/payroll-rows';
import { renderCsv } from './renderers/csv-renderer';
import { renderXlsx } from './renderers/xlsx-renderer';

export interface ExportInput {
  periodId: string;
  format: TimesheetExportFormat;
  mode: TimesheetExportMode;
  departmentId?: string | null;
  note?: string | null;
}

export interface ExportResult {
  export: {
    id: string;
    createdAt: Date;
    format: TimesheetExportFormat;
    mode: TimesheetExportMode;
    rowCount: number;
    entryCount: number;
    bytes: number;
    payloadSha256: string;
  };
  filename: string;
  contentType: string;
  payload: Buffer;
}

export interface ExportListItem {
  id: string;
  createdAt: string;
  format: TimesheetExportFormat;
  mode: TimesheetExportMode;
  rowCount: number;
  entryCount: number;
  bytes: number;
  payloadSha256: string;
  note: string | null;
  period: { id: string; label: string; periodStart: string; periodEnd: string };
  departmentName: string | null;
  requestedBy: { id: string; fullName: string; email: string };
}

/**
 * Payroll-export service (Fase 32c). Owns:
 *
 *   1. Access-scope validation — only `HR_MANAGER` / `SUPER_ADMIN`
 *      may export, and the target period must belong to their tenant.
 *   2. Data selection — only `APPROVED` timesheets are eligible.
 *      Exporting a period with zero APPROVED rows is refused with a
 *      400 so payroll never accidentally ships an empty file.
 *   3. Serialisation — CSV or XLSX via the pure renderer modules.
 *   4. Audit — writes a `TimesheetExport` row containing the SHA-256
 *      of the exact byte-string that leaves the server, BEFORE the
 *      handler streams it back. If the audit insert fails, the client
 *      never sees the payload.
 *
 * The audit-then-stream ordering is critical for compliance: the row
 * is our proof that "this payload was released to this person at this
 * time" — a hash mismatch later means the file was tampered with in
 * transit or after receipt, and the audit row lets us prove intent
 * even after the file itself is deleted from the payroll team's inbox.
 */
@Injectable()
export class TimesheetExportService {
  private readonly logger = new Logger(TimesheetExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhookDispatcher: WebhookDispatcher,
  ) {}

  async export(
    actor: AuthenticatedUser,
    input: ExportInput,
  ): Promise<ExportResult> {
    this.assertRole(actor);

    const period = await this.prisma.timesheetPeriod.findFirst({
      where: { id: input.periodId, companyId: actor.companyId },
      include: { company: { select: { name: true, timezone: true } } },
    });
    if (!period) {
      throw new NotFoundException('TIMESHEET_PERIOD_NOT_FOUND');
    }

    if (input.departmentId) {
      // Cross-tenant guard: refuse if the department doesn't belong
      // to the actor's company. Same 404 as a missing period to
      // avoid leaking department existence.
      const dept = await this.prisma.department.findFirst({
        where: {
          id: input.departmentId,
          companyId: actor.companyId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!dept) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'DEPARTMENT_NOT_FOUND',
          message:
            'Departemen tidak ditemukan pada tenant Anda.',
        });
      }
    }

    // Only APPROVED timesheets are eligible. Filtering here (not in the
    // renderer) keeps the source-of-truth in the service layer.
    const timesheets = await this.prisma.timesheet.findMany({
      where: {
        companyId: actor.companyId,
        periodId: period.id,
        status: TimesheetStatus.APPROVED,
        ...(input.departmentId
          ? { user: { departmentId: input.departmentId } }
          : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            overtimeHourlyRate: true,
            department: { select: { name: true } },
          },
        },
        entries:
          input.mode === TimesheetExportMode.DETAIL
            ? { orderBy: { workDate: 'asc' } }
            : false,
      },
      orderBy: [
        { user: { department: { name: 'asc' } } },
        { user: { fullName: 'asc' } },
      ],
    });

    if (timesheets.length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'EXPORT_EMPTY',
        message:
          'Tidak ada timesheet APPROVED pada periode + filter tersebut. Pastikan HR sudah menyetujui timesheet sebelum export.',
      });
    }

    const sourceRows: PayrollSourceTimesheet[] = timesheets.map((t) => ({
      userId: t.user.id,
      userFullName: t.user.fullName,
      userEmail: t.user.email,
      departmentName: t.user.department?.name ?? null,
      overtimeHourlyRate:
        t.user.overtimeHourlyRate === null
          ? null
          : Number(t.user.overtimeHourlyRate),
      periodLabel: period.label,
      periodStart: toYmd(period.periodStart),
      periodEnd: toYmd(period.periodEnd),
      totals: {
        workingDays: t.totalWorkingDays,
        regularHours: Number(t.totalRegularHours),
        overtimeHours: Number(t.totalOvertimeHours),
        leaveDays: t.totalLeaveDays,
        absentDays: t.totalAbsentDays,
        holidays: t.totalHolidays,
        lateMinutes: t.totalLateMinutes,
        earlyLeaveMinutes: t.totalEarlyLeaveMinutes,
      },
      entries: (
        (t as unknown as {
          entries?: Array<{
            workDate: Date;
            kind: string;
            expectedHours: Prisma.Decimal | null;
            regularHours: Prisma.Decimal;
            overtimeHours: Prisma.Decimal;
            leaveHours: Prisma.Decimal;
            lateMinutes: number;
            earlyLeaveMinutes: number;
            note: string | null;
          }>;
        }).entries ?? []
      ).map((e) => ({
        workDate: toYmd(e.workDate),
        kind: e.kind,
        expectedHours: e.expectedHours === null ? null : Number(e.expectedHours),
        regularHours: Number(e.regularHours),
        overtimeHours: Number(e.overtimeHours),
        leaveHours: Number(e.leaveHours),
        lateMinutes: e.lateMinutes,
        earlyLeaveMinutes: e.earlyLeaveMinutes,
        note: e.note,
      })),
    }));

    let columns: readonly PayrollColumn[];
    let flatRows: PayrollRow[];
    let entryCount = 0;
    if (input.mode === TimesheetExportMode.SUMMARY) {
      columns = SUMMARY_COLUMNS;
      flatRows = sourceRows.map(buildSummaryRow);
    } else {
      columns = DETAIL_COLUMNS;
      flatRows = [];
      for (const src of sourceRows) {
        const detail = buildDetailRows(src);
        flatRows.push(...detail);
        entryCount += detail.length;
      }
    }

    let payload: Buffer;
    let filename: string;
    let contentType: string;
    if (input.format === TimesheetExportFormat.CSV) {
      payload = renderCsv(columns, flatRows);
      contentType = 'text/csv; charset=utf-8';
    } else {
      const requester = await this.prisma.user.findUnique({
        where: { id: actor.id },
        select: { email: true },
      });
      payload = await renderXlsx(
        {
          companyName: period.company.name,
          periodLabel: period.label,
          periodStart: toYmd(period.periodStart),
          periodEnd: toYmd(period.periodEnd),
          generatedAt: new Date(),
          generatedByEmail: requester?.email ?? actor.email,
          mode: input.mode,
        },
        columns,
        flatRows,
      );
      contentType =
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }

    const ext = input.format === TimesheetExportFormat.CSV ? 'csv' : 'xlsx';
    const slug = slugify(period.label);
    filename = `payroll-${slug}-${input.mode.toLowerCase()}.${ext}`;

    const payloadSha256 = createHash('sha256')
      .update(payload)
      .digest('hex');

    // Audit-first commit. We accept the extra round-trip to keep the
    // "we told the payroll team X" invariant honest — no orphaned
    // downloads without an audit row. The payload bytes are persisted
    // in the same INSERT so Fase 32d signed URLs can serve them
    // byte-identically without a re-render.
    const auditRow = await this.prisma.$transaction(async (tx) => {
      const created = await tx.timesheetExport.create({
        data: {
          companyId: actor.companyId,
          periodId: period.id,
          requestedById: actor.id,
          format: input.format,
          mode: input.mode,
          departmentId: input.departmentId ?? null,
          rowCount: sourceRows.length,
          entryCount,
          bytes: payload.length,
          payloadSha256,
          payload,
          note: input.note?.trim() || null,
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'TIMESHEET_EXPORTED',
          entityType: 'TimesheetExport',
          entityId: created.id,
          afterJson: {
            periodId: period.id,
            format: input.format,
            mode: input.mode,
            departmentId: input.departmentId ?? null,
            rowCount: sourceRows.length,
            entryCount,
            bytes: payload.length,
            payloadSha256,
          } as Prisma.InputJsonValue,
        },
      });
      return created;
    });

    // Fase 32e — outbound webhook. Fires AFTER the DB commit and
    // never throws upstream: a webhook failure must not block payroll.
    await this.webhookDispatcher.enqueue({
      companyId: actor.companyId,
      eventType: 'TIMESHEET_EXPORT_CREATED',
      sourceId: auditRow.id,
      data: {
        exportId: auditRow.id,
        periodId: period.id,
        periodLabel: period.label,
        periodStart: toYmd(period.periodStart),
        periodEnd: toYmd(period.periodEnd),
        format: auditRow.format,
        mode: auditRow.mode,
        rowCount: auditRow.rowCount,
        entryCount: auditRow.entryCount,
        bytes: auditRow.bytes,
        payloadSha256: auditRow.payloadSha256,
        departmentId: input.departmentId ?? null,
        requestedBy: {
          id: actor.id,
          email: actor.email,
        },
      },
    });

    return {
      export: {
        id: auditRow.id,
        createdAt: auditRow.createdAt,
        format: auditRow.format,
        mode: auditRow.mode,
        rowCount: auditRow.rowCount,
        entryCount: auditRow.entryCount,
        bytes: auditRow.bytes,
        payloadSha256: auditRow.payloadSha256,
      },
      filename,
      contentType,
      payload,
    };
  }

  /**
   * Fase 32d — internal loader used by the signed-download endpoint.
   *
   * Returns the exact bytes + metadata that were streamed at export
   * time. Rejects rows whose `payload` column is null (pre-32d
   * exports) with `EXPORT_PAYLOAD_UNAVAILABLE`. Cross-checks the
   * stored hash against the actual bytes; a mismatch means the row
   * was tampered with post-export and is refused.
   *
   * No RBAC gate — the caller (the share service) authenticates via
   * the URL signature. Intentionally keeps the audit-log write in the
   * share service, not here.
   */
  async loadPayloadForShare(exportId: string): Promise<ExportResult> {
    const row = await this.prisma.timesheetExport.findUnique({
      where: { id: exportId },
      include: {
        period: {
          select: { label: true },
        },
      },
    });
    if (!row) {
      throw new NotFoundException('EXPORT_NOT_FOUND');
    }
    if (!row.payload || row.payload.length === 0) {
      throw new BadRequestException({
        statusCode: 410,
        code: 'EXPORT_PAYLOAD_UNAVAILABLE',
        message:
          'Payload untuk export ini tidak tersedia. Buat export baru untuk dibagikan.',
      });
    }
    const payload = Buffer.from(row.payload);
    const actualHash = createHash('sha256').update(payload).digest('hex');
    if (actualHash !== row.payloadSha256) {
      this.logger.error(
        `Payload hash mismatch for export ${exportId}: stored=${row.payloadSha256} actual=${actualHash}`,
      );
      throw new BadRequestException({
        statusCode: 500,
        code: 'EXPORT_PAYLOAD_CORRUPTED',
        message:
          'Integritas payload gagal diverifikasi. Hubungi administrator.',
      });
    }
    const ext = row.format === TimesheetExportFormat.CSV ? 'csv' : 'xlsx';
    const contentType =
      row.format === TimesheetExportFormat.CSV
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const filename = `payroll-${slugify(row.period.label)}-${row.mode.toLowerCase()}.${ext}`;
    return {
      export: {
        id: row.id,
        createdAt: row.createdAt,
        format: row.format,
        mode: row.mode,
        rowCount: row.rowCount,
        entryCount: row.entryCount,
        bytes: row.bytes,
        payloadSha256: row.payloadSha256,
      },
      filename,
      contentType,
      payload,
    };
  }

  async list(
    actor: AuthenticatedUser,
    limit = 50,
  ): Promise<ExportListItem[]> {
    this.assertRole(actor);
    const rows = await this.prisma.timesheetExport.findMany({
      where: { companyId: actor.companyId },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(200, limit)),
      include: {
        period: {
          select: {
            id: true,
            label: true,
            periodStart: true,
            periodEnd: true,
          },
        },
        department: { select: { name: true } },
        requestedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      format: r.format,
      mode: r.mode,
      rowCount: r.rowCount,
      entryCount: r.entryCount,
      bytes: r.bytes,
      payloadSha256: r.payloadSha256,
      note: r.note,
      period: {
        id: r.period.id,
        label: r.period.label,
        periodStart: toYmd(r.period.periodStart),
        periodEnd: toYmd(r.period.periodEnd),
      },
      departmentName: r.department?.name ?? null,
      requestedBy: r.requestedBy,
    }));
  }

  private assertRole(actor: AuthenticatedUser): void {
    if (actor.role !== 'HR_MANAGER' && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('FORBIDDEN');
    }
  }
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
