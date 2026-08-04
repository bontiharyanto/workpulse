import type { Writable } from 'node:stream';

import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { summarize, toAttendanceReportRows } from './domain/attendance-report';
import { summarizeLeave, toLeaveSummaryRows } from './domain/leave-summary-report';
import { summarizeOvertime, toOvertimeReportRows } from './domain/overtime-report';
import type { ReportFormatLiteral } from './dto/attendance-report.dto';
import type { OvertimeStatusLiteral } from './dto/overtime-report.dto';
import { renderAttendanceExcel } from './renderers/attendance-excel.renderer';
import { renderAttendancePdf } from './renderers/attendance-pdf.renderer';
import { renderLeaveSummaryExcel } from './renderers/leave-summary-excel.renderer';
import { renderLeaveSummaryPdf } from './renderers/leave-summary-pdf.renderer';
import { renderOvertimeExcel } from './renderers/overtime-excel.renderer';
import { renderOvertimePdf } from './renderers/overtime-pdf.renderer';
import type { ReportHeader } from './renderers/render-context';

const MAX_DAYS_XLSX = 366;
const MAX_DAYS_PDF = 92;

export interface AttendanceReportInput {
  format: ReportFormatLiteral;
  startDate: string;
  endDate: string;
  departmentId?: string | null;
  userIds?: string[];
}

export interface LeaveSummaryReportInput {
  format: ReportFormatLiteral;
  year: number;
  departmentId?: string | null;
}

export interface OvertimeReportInput {
  format: ReportFormatLiteral;
  startDate: string;
  endDate: string;
  departmentId?: string | null;
  userIds?: string[];
  /** Defaults to `['APPROVED', 'COMPLETED']` (the payroll view) when omitted. */
  statuses?: OvertimeStatusLiteral[];
}

export interface RenderedReport {
  contentType: string;
  filename: string;
}

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  // ==================================================================
  // Attendance
  // ==================================================================

  async streamAttendance(
    actor: AuthenticatedUser,
    input: AttendanceReportInput,
    target: Writable,
  ): Promise<RenderedReport> {
    this.assertDateWindow(input.startDate, input.endDate, input.format);
    const company = await this.loadCompany(actor.companyId);
    const timezone = company.timezone;

    // Half-open [start, endExclusive) covering the inclusive `endDate`.
    const startAt = new Date(`${input.startDate}T00:00:00.000Z`);
    const endExclusive = new Date(`${input.endDate}T00:00:00.000Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

    const where: Prisma.AttendanceRecordWhereInput = {
      companyId: actor.companyId,
      deletedAt: null,
      workDate: { gte: startAt, lt: endExclusive },
    };
    if (input.userIds && input.userIds.length > 0) {
      where.userId = { in: input.userIds };
    } else if (input.departmentId) {
      where.user = { departmentId: input.departmentId };
    }

    const raws = await this.prisma.attendanceRecord.findMany({
      where,
      orderBy: [{ workDate: 'asc' }, { user: { fullName: 'asc' } }],
      select: {
        workDate: true,
        clockInAt: true,
        clockOutAt: true,
        status: true,
        lateMinutes: true,
        earlyLeaveMinutes: true,
        note: true,
        user: {
          select: {
            fullName: true,
            email: true,
            department: { select: { name: true } },
          },
        },
        shift: { select: { name: true } },
      },
    });

    const rows = toAttendanceReportRows(raws, timezone);
    const summary = summarize(rows);

    const header: ReportHeader = {
      companyName: company.name,
      title: 'Laporan Kehadiran',
      subtitle: `Periode ${input.startDate} → ${input.endDate}${
        input.departmentId ? ` · Departemen ${input.departmentId}` : ''
      }`,
      generatedAt: new Date(),
      generatedByEmail: actor.email,
      timezone,
    };

    const filename = `attendance-${input.startDate}_${input.endDate}.${input.format}`;

    if (input.format === 'xlsx') {
      await renderAttendanceExcel(rows, summary, { target, header });
      return { contentType: XLSX_MIME, filename };
    }
    await renderAttendancePdf(rows, summary, { target, header });
    return { contentType: 'application/pdf', filename };
  }

  // ==================================================================
  // Leave summary
  // ==================================================================

  async streamLeaveSummary(
    actor: AuthenticatedUser,
    input: LeaveSummaryReportInput,
    target: Writable,
  ): Promise<RenderedReport> {
    const company = await this.loadCompany(actor.companyId);

    const userWhere: Prisma.UserWhereInput = {
      companyId: actor.companyId,
      deletedAt: null,
    };
    if (input.departmentId) userWhere.departmentId = input.departmentId;

    const [users, leaveTypes] = await Promise.all([
      this.prisma.user.findMany({
        where: userWhere,
        orderBy: [{ department: { name: 'asc' } }, { fullName: 'asc' }],
        select: {
          id: true,
          fullName: true,
          email: true,
          department: { select: { name: true } },
          leaveBalances: {
            where: { year: input.year },
            select: {
              leaveTypeId: true,
              year: true,
              quota: true,
              carriedOver: true,
              used: true,
              reserved: true,
              remaining: true,
            },
          },
        },
      }),
      this.prisma.leaveType.findMany({
        where: { companyId: actor.companyId, deletedAt: null },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true },
      }),
    ]);

    const usersForDomain = users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      department: u.department,
      balances: u.leaveBalances,
    }));
    const rows = toLeaveSummaryRows(usersForDomain, leaveTypes, input.year);
    const totals = summarizeLeave(rows);

    const header: ReportHeader = {
      companyName: company.name,
      title: 'Ringkasan Saldo Cuti',
      subtitle: `Tahun ${input.year}${
        input.departmentId ? ` · Departemen ${input.departmentId}` : ''
      }`,
      generatedAt: new Date(),
      generatedByEmail: actor.email,
      timezone: company.timezone,
    };

    const filename = `leave-summary-${input.year}.${input.format}`;

    if (input.format === 'xlsx') {
      await renderLeaveSummaryExcel(rows, totals, { target, header });
      return { contentType: XLSX_MIME, filename };
    }
    await renderLeaveSummaryPdf(rows, totals, { target, header });
    return { contentType: 'application/pdf', filename };
  }

  // ==================================================================
  // Overtime summary
  // ==================================================================

  async streamOvertimeSummary(
    actor: AuthenticatedUser,
    input: OvertimeReportInput,
    target: Writable,
  ): Promise<RenderedReport> {
    this.assertDateWindow(input.startDate, input.endDate, input.format);
    const company = await this.loadCompany(actor.companyId);

    const startAt = new Date(`${input.startDate}T00:00:00.000Z`);
    const endExclusive = new Date(`${input.endDate}T00:00:00.000Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

    // Payroll-oriented default: only settled requests count. Callers explicitly
    // pass `statuses` to include PENDING/REJECTED/CANCELLED for audit exports.
    const statuses =
      input.statuses && input.statuses.length > 0
        ? input.statuses
        : (['APPROVED', 'COMPLETED'] as const);

    const where: Prisma.OvertimeRequestWhereInput = {
      companyId: actor.companyId,
      deletedAt: null,
      workDate: { gte: startAt, lt: endExclusive },
      status: { in: [...statuses] },
    };
    if (input.userIds && input.userIds.length > 0) {
      where.userId = { in: input.userIds };
    } else if (input.departmentId) {
      where.user = { departmentId: input.departmentId };
    }

    // Preload holiday set for the window in a single query so dayKind
    // classification stays O(rows) rather than N+1.
    const [raws, holidays] = await Promise.all([
      this.prisma.overtimeRequest.findMany({
        where,
        orderBy: [{ workDate: 'asc' }, { user: { fullName: 'asc' } }],
        select: {
          workDate: true,
          hours: true,
          baseRate: true,
          rateMultiplier: true,
          ratePerHour: true,
          totalAmount: true,
          status: true,
          reason: true,
          approvedAt: true,
          rejectedAt: true,
          createdAt: true,
          user: {
            select: {
              fullName: true,
              email: true,
              department: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.holiday.findMany({
        where: {
          companyId: actor.companyId,
          date: { gte: startAt, lt: endExclusive },
        },
        select: { date: true },
      }),
    ]);

    const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));

    const rows = toOvertimeReportRows(raws, holidaySet);
    const totals = summarizeOvertime(rows);

    const statusLabel =
      input.statuses && input.statuses.length > 0
        ? input.statuses.join(', ')
        : 'APPROVED + COMPLETED';

    const header: ReportHeader = {
      companyName: company.name,
      title: 'Laporan Lembur',
      subtitle: `Periode ${input.startDate} → ${input.endDate} · Status: ${statusLabel}${
        input.departmentId ? ` · Departemen ${input.departmentId}` : ''
      }`,
      generatedAt: new Date(),
      generatedByEmail: actor.email,
      timezone: company.timezone,
    };

    const filename = `overtime-${input.startDate}_${input.endDate}.${input.format}`;

    if (input.format === 'xlsx') {
      await renderOvertimeExcel(rows, totals, { target, header });
      return { contentType: XLSX_MIME, filename };
    }
    await renderOvertimePdf(rows, totals, { target, header });
    return { contentType: 'application/pdf', filename };
  }

  // ==================================================================
  // Internals
  // ==================================================================

  private assertDateWindow(startDate: string, endDate: string, format: ReportFormatLiteral): void {
    if (endDate < startDate) {
      throw new BadRequestException('REPORT_RANGE_INVALID');
    }
    const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
    const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
    const days = Math.floor((end - start) / 86_400_000) + 1;
    const cap = format === 'xlsx' ? MAX_DAYS_XLSX : MAX_DAYS_PDF;
    if (days > cap) {
      throw new BadRequestException(`REPORT_RANGE_TOO_LARGE:${format}:max=${cap}:actual=${days}`);
    }
  }

  private async loadCompany(companyId: string): Promise<{ name: string; timezone: string }> {
    const row = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { name: true, timezone: true },
    });
    return row;
  }
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
