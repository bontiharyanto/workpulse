import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import type { BucketCounts } from './domain/age-buckets';
import { summarize } from './domain/age-buckets';

/**
 * "Which approvals across the tenant are ROTTING?"
 *
 * Aggregates PENDING requests from the three modules that have an
 * approver-driven state machine:
 *
 *   - Leave (`LeaveRequest` — status ∈ {`PENDING_SUPERVISOR`,`PENDING_HR`})
 *   - Overtime (`OvertimeRequest` — status = `PENDING_APPROVAL`)
 *   - Attendance Correction (`AttendanceCorrection` — status = `PENDING_APPROVAL`)
 *
 * For each module we return:
 *   - total count (all PENDING regardless of age)
 *   - fresh / stale split (threshold configurable via query — default 3)
 *   - histogram bucket counts (0-1d / 1-3d / 3-7d / 7d+)
 *   - top-N oldest with minimal metadata for drill-down
 *
 * The endpoint is HR-scoped. Supervisors already see their own scoped
 * approvals via the per-module `/approvals/pending` endpoints; the
 * cross-module aggregate view is deliberately withheld from them to
 * keep the surface predictable ("HR owns the cross-module backlog"
 * matches the ops handoff in every tenant we've talked to).
 */

export interface ModuleBacklog {
  total: number;
  fresh: number;
  stale: number;
  buckets: BucketCounts;
  /** Top-N oldest PENDING rows, ordered ascending by createdAt. */
  oldest: BacklogItem[];
}

export interface BacklogItem {
  id: string;
  userId: string;
  userFullName: string;
  createdAt: Date;
  ageDays: number;
  /**
   * Free-form small summary per module — different shape per source, so
   * the FE can render one column of context without needing a
   * discriminated union per row.
   */
  summary: string;
}

export interface BacklogSummary {
  generatedAt: Date;
  staleAfterDays: number;
  leave: ModuleBacklog;
  overtime: ModuleBacklog;
  correction: ModuleBacklog;
}

export interface BacklogInput {
  companyId: string;
  /** UTC "now" — separated for deterministic unit tests. */
  now: Date;
  /**
   * Rows older than this many whole days are counted as "stale". Defaults
   * to 3 — tuned so a normal supervisor turnaround (same day / next day)
   * stays green, and a 3-day dormancy trips the counter.
   */
  staleAfterDays?: number;
  /** How many oldest rows to include in each module's `oldest[]`. Default 5. */
  topN?: number;
}

@Injectable()
export class BacklogService {
  constructor(private readonly prisma: PrismaService) {}

  async getBacklog(input: BacklogInput): Promise<BacklogSummary> {
    const staleAfterDays = input.staleAfterDays ?? 3;
    const topN = input.topN ?? 5;

    if (!Number.isInteger(staleAfterDays) || staleAfterDays < 1 || staleAfterDays > 60) {
      throw new BadRequestException('INVALID_STALE_THRESHOLD');
    }
    if (!Number.isInteger(topN) || topN < 1 || topN > 20) {
      throw new BadRequestException('INVALID_TOP_N');
    }

    const [leaveRows, overtimeRows, correctionRows] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: {
          companyId: input.companyId,
          status: { in: ['PENDING_SUPERVISOR', 'PENDING_HR'] },
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          userId: true,
          createdAt: true,
          startDate: true,
          endDate: true,
          leaveType: { select: { name: true } },
          user: { select: { fullName: true } },
        },
      }),
      this.prisma.overtimeRequest.findMany({
        where: {
          companyId: input.companyId,
          status: 'PENDING_APPROVAL',
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          userId: true,
          createdAt: true,
          workDate: true,
          hours: true,
          user: { select: { fullName: true } },
        },
      }),
      this.prisma.attendanceCorrection.findMany({
        where: {
          companyId: input.companyId,
          status: 'PENDING_APPROVAL',
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          userId: true,
          createdAt: true,
          workDate: true,
          requestedClockInAt: true,
          requestedClockOutAt: true,
          user: { select: { fullName: true } },
        },
      }),
    ]);

    const leave = buildModuleSummary(
      leaveRows.map((r) => r.createdAt),
      input.now,
      staleAfterDays,
      leaveRows.slice(0, topN).map((r) => ({
        id: r.id,
        userId: r.userId,
        userFullName: r.user.fullName,
        createdAt: r.createdAt,
        summary: `${r.leaveType.name} · ${isoDate(r.startDate)} → ${isoDate(r.endDate)}`,
      })),
      input.now,
    );

    const overtime = buildModuleSummary(
      overtimeRows.map((r) => r.createdAt),
      input.now,
      staleAfterDays,
      overtimeRows.slice(0, topN).map((r) => ({
        id: r.id,
        userId: r.userId,
        userFullName: r.user.fullName,
        createdAt: r.createdAt,
        summary: `${Number(r.hours.toString()).toFixed(2)} jam · ${isoDate(r.workDate)}`,
      })),
      input.now,
    );

    const correction = buildModuleSummary(
      correctionRows.map((r) => r.createdAt),
      input.now,
      staleAfterDays,
      correctionRows.slice(0, topN).map((r) => ({
        id: r.id,
        userId: r.userId,
        userFullName: r.user.fullName,
        createdAt: r.createdAt,
        summary: `${isoDate(r.workDate)} · ${describeCorrection(
          r.requestedClockInAt,
          r.requestedClockOutAt,
        )}`,
      })),
      input.now,
    );

    return {
      generatedAt: input.now,
      staleAfterDays,
      leave,
      overtime,
      correction,
    };
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface OldestSeed {
  id: string;
  userId: string;
  userFullName: string;
  createdAt: Date;
  summary: string;
}

function buildModuleSummary(
  createdAtList: Date[],
  now: Date,
  staleAfterDays: number,
  oldestSeed: readonly OldestSeed[],
  refNow: Date,
): ModuleBacklog {
  const stats = summarize(createdAtList, now, staleAfterDays);
  return {
    total: stats.total,
    fresh: stats.fresh,
    stale: stats.stale,
    buckets: stats.buckets,
    oldest: oldestSeed.map((r) => ({
      ...r,
      ageDays: Math.floor(
        (refNow.getTime() - r.createdAt.getTime()) / (24 * 60 * 60 * 1000),
      ),
    })),
  };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function describeCorrection(
  clockIn: Date | null,
  clockOut: Date | null,
): string {
  const parts: string[] = [];
  if (clockIn) parts.push(`in ${formatHm(clockIn)}`);
  if (clockOut) parts.push(`out ${formatHm(clockOut)}`);
  return parts.length === 0 ? '—' : parts.join(', ');
}

function formatHm(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
