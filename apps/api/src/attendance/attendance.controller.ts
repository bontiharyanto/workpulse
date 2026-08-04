import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';


import { AbsenceScannerService } from './absence-scanner.service';
import type { CompanyDashboardResponse } from './attendance.service';
import { AttendanceService } from './attendance.service';
import type { AttendanceMonthlySummary } from './domain/attendance-summary';
import type { TeamMemberDailyRow, TeamMemberSummaryRow } from './domain/team-attendance';
import { AttendanceRecordDto } from './dto/attendance-record.dto';
import { ClockInDto } from './dto/clock-in.dto';
import { ClockOutDto } from './dto/clock-out.dto';
import { CreateAbsenceDto } from './dto/create-absence.dto';
import {
  ResetScannerCursorDto,
  ResetScannerCursorResponseDto,
} from './dto/reset-scanner-cursor.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

@ApiTags('attendance')
@ApiBearerAuth()
@Controller({ path: 'attendance', version: '1' })
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly absenceScanner: AbsenceScannerService,
  ) {}

  @Post('clock-in')
  @HttpCode(HttpStatus.CREATED)
  @Roles('EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER')
  @ApiOkResponse({ type: AttendanceRecordDto })
  async clockIn(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ClockInDto,
  ): Promise<AttendanceRecordDto> {
    const record = await this.attendance.clockIn(user, dto);
    return toDto(record);
  }

  @Post('clock-out')
  @HttpCode(HttpStatus.OK)
  @Roles('EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER')
  @ApiOkResponse({ type: AttendanceRecordDto })
  async clockOut(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ClockOutDto,
  ): Promise<AttendanceRecordDto> {
    const record = await this.attendance.clockOut(user, dto);
    return toDto(record);
  }

  @Get('me/today')
  @Roles('EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER')
  @ApiOkResponse({ type: AttendanceRecordDto, description: 'null when no clock-in yet today' })
  async today(@CurrentUser() user: AuthenticatedUser): Promise<AttendanceRecordDto | null> {
    const record = await this.attendance.findMyToday(user);
    return record ? toDto(record) : null;
  }

  /**
   * Employee attendance history. Query parameters are strings by the time
   * they hit us — the service does the parsing + validation and returns a
   * typed `BadRequestException` on invalid input, so we forward as-is.
   */
  @Get('me/history')
  @Roles('EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER')
  @ApiOkResponse({ type: AttendanceRecordDto, isArray: true })
  async history(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ): Promise<AttendanceRecordDto[]> {
    const rows = await this.attendance.listMyHistory(user, {
      from,
      to,
      limit: limit ? Number(limit) : undefined,
    });
    return rows.map(toDto);
  }

  /**
   * "This month at a glance". Kept intentionally small — the widget only
   * needs a handful of scalars and one distinct-day count, so we don't
   * paginate. If the frontend needs multi-month trends later, add a
   * `/me/summary/range` endpoint rather than growing this one.
   */
  @Get('me/summary')
  @Roles('EMPLOYEE', 'SUPERVISOR', 'HR_MANAGER')
  @ApiOkResponse({
    description: 'Monthly attendance summary for the caller (self-service dashboard widget)',
  })
  async monthlySummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ): Promise<AttendanceMonthlySummary & { year: number; month: number }> {
    return this.attendance.getMyMonthlySummary(user, {
      year: year ? Number(year) : undefined,
      month: month ? Number(month) : undefined,
    });
  }

  /**
   * Team snapshot for a single day. Employees don't get this endpoint —
   * self-view lives at `/me/*`.
   *
   * The service enforces roster scoping (supervisor → direct reports,
   * HR → tenant). Passing `date=YYYY-MM-DD` lets a supervisor pull
   * yesterday's snapshot for retrospective review.
   */
  @Get('team/today')
  @Roles('SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN')
  @ApiOkResponse({
    description: "Team roster + today's attendance status (sorted by exception severity)",
  })
  async teamToday(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('date') date?: string,
  ): Promise<TeamMemberDailyRow[]> {
    return this.attendance.listTeamToday(actor, { date });
  }

  @Get('team/summary')
  @Roles('SUPERVISOR', 'HR_MANAGER', 'SUPER_ADMIN')
  @ApiOkResponse({
    description: 'Per-member roll-up over a bounded date range (default: last 7 days, max 92)',
  })
  async teamSummary(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<{ from: string; to: string; rows: TeamMemberSummaryRow[] }> {
    return this.attendance.getTeamSummary(actor, { from, to });
  }

  /**
   * Company-wide snapshot for the HR dashboard. Deliberately narrower
   * RBAC than the team endpoints — supervisors do not get to peek
   * outside their reports at this endpoint.
   */
  @Get('dashboard')
  @Roles('HR_MANAGER', 'SUPER_ADMIN')
  @ApiOkResponse({
    description: 'Company-wide attendance snapshot for a date (default: today)',
  })
  async dashboard(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('date') date?: string,
  ): Promise<CompanyDashboardResponse> {
    return this.attendance.getCompanyDashboard(actor, { date });
  }

  /**
   * Manual trigger for the auto-absent scanner. Kept behind SUPER_ADMIN
   * (not HR_MANAGER) because a run can flip payroll-visible state for
   * every employee. Idempotent — safe to invoke repeatedly.
   *
   * Typical usage: HR retroactively added a holiday for last Wednesday
   * and wants the scanner to re-evaluate that date without waiting for
   * the next hourly tick. In practice they'd delete misclassified
   * `AbsenceRecord` rows first; the scanner will not overwrite
   * existing rows.
   */
  /**
   * HR (or Super Admin) manually classifies a user as absent on a
   * specific date. Fires the same notification fanout as the scheduler
   * (employee + supervisor, if any).
   *
   * The service enforces every important invariant — see
   * `AttendanceService.markAbsent`. This layer only decodes the DTO
   * and forwards.
   */
  @Post('absence')
  @HttpCode(HttpStatus.CREATED)
  @Roles('HR_MANAGER', 'SUPER_ADMIN')
  @ApiOkResponse({ description: 'AbsenceRecord created; recipients notified' })
  async markAbsent(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateAbsenceDto,
  ): Promise<{
    id: string;
    userId: string;
    workDate: string;
    source: string;
    reason: string | null;
    markedById: string | null;
    createdAt: string;
  }> {
    return this.attendance.markAbsent(actor, {
      userId: dto.userId,
      workDate: dto.workDate,
      reason: dto.reason,
    });
  }

  /**
   * HR (or Super Admin) removes an existing AbsenceRecord — undoes a
   * scheduler classification or a previous manual mark. Hard delete
   * because the audit log (`ATTENDANCE_UNMARK_ABSENT`) preserves
   * history.
   */
  @Delete('absence/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('HR_MANAGER', 'SUPER_ADMIN')
  @ApiOkResponse({ description: 'AbsenceRecord removed. Idempotent for callers.' })
  async deleteAbsence(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.attendance.deleteAbsence(actor, id);
  }

  @Post('scanner/run')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles('SUPER_ADMIN')
  @ApiOkResponse({
    description: 'Trigger the auto-absent scanner across all tenants (SUPER_ADMIN only)',
  })
  async triggerScanner(): Promise<{
    scannedCompanies: number;
    totalMarked: number;
    durationMs: number;
  }> {
    const result = await this.absenceScanner.runAll();
    return {
      scannedCompanies: result.scannedCompanies,
      totalMarked: result.totalMarked,
      durationMs: result.durationMs,
    };
  }

  /**
   * Reset the caller-tenant's absence-scanner cursor
   * (`Company.lastAbsentScanDate`) to `null`. Optionally trigger an
   * immediate re-scan in the same call. SUPER_ADMIN only — this is a
   * destructive ops lane described in ADR-0010.
   *
   * ## Blast radius
   *
   * - The cursor is per-tenant. Scoped to `actor.companyId`; a
   *   SUPER_ADMIN cannot cross-tenant reset via this endpoint (the DB
   *   `WHERE` narrows to their own tenant). Cross-tenant reset is out
   *   of MVP scope; escalation path is direct SQL + a matching audit
   *   log entry by hand.
   * - When `triggerRescan=true`, up to `MAX_BACKFILL_DAYS` days of
   *   absences may be (re-)created. `AbsenceRecord` unique keeps
   *   duplicate rows off the table — the notification fanout is NOT
   *   deduped, so affected employees receive fresh
   *   `ATTENDANCE_ABSENT_MARKED` notifications for any newly-marked
   *   dates. Accepted trade-off — see ADR-0010.
   */
  @Post('scanner/reset-cursor')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN')
  @ApiOkResponse({ type: ResetScannerCursorResponseDto })
  async resetScannerCursor(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: ResetScannerCursorDto,
  ): Promise<ResetScannerCursorResponseDto> {
    const result = await this.absenceScanner.resetCursor(actor.companyId, {
      triggerRescan: dto.triggerRescan ?? false,
      actor: { id: actor.id },
    });
    return {
      before: result.before ? toIsoDate(result.before) : null,
      after: null,
      rescanTriggered: result.rescanTriggered,
      ...(result.rescanResult && { rescanResult: result.rescanResult }),
    };
  }
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toDto(record: Awaited<ReturnType<AttendanceService['clockIn']>>): AttendanceRecordDto {
  return {
    id: record.id,
    userId: record.userId,
    shiftId: record.shiftId,
    workDate: record.workDate.toISOString(),
    clockInAt: record.clockInAt.toISOString(),
    clockOutAt: record.clockOutAt ? record.clockOutAt.toISOString() : null,
    clockInLatitude: Number(record.clockInLatitude),
    clockInLongitude: Number(record.clockInLongitude),
    clockOutLatitude: record.clockOutLatitude ? Number(record.clockOutLatitude) : null,
    clockOutLongitude: record.clockOutLongitude ? Number(record.clockOutLongitude) : null,
    status: record.status,
    lateMinutes: record.lateMinutes,
    earlyLeaveMinutes: record.earlyLeaveMinutes,
  };
}
