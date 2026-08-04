import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { isPayrollLocked } from '../common/domain/payroll-lock';
import { overtimeCompleted } from '../notification/domain/templates';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  decideOvertimeCompletion,
} from './domain/overtime-completion';
import { transition } from './domain/overtime-state';

export interface CompletionRunResult {
  scanned: number;
  completed: number;
  /** Non-completing outcomes bucketed by reason for observability. */
  skipped: Record<string, number>;
  /** Wall-clock duration in ms. */
  durationMs: number;
}

/**
 * Cron-driven promoter for APPROVED → COMPLETED. Runs across ALL tenants in
 * one pass (multi-tenant scheduler pattern), respecting per-tenant
 * `overtimeCompleteGraceDays`.
 *
 * Idempotent: safe to call any number of times. `AlreadyCompleted` decisions
 * short-circuit before any DB write.
 *
 * Not transactional across rows — each promotion is its own tiny transaction,
 * so a mid-run failure at row N still commits rows 0..N-1 rather than losing
 * a whole batch. Failures on individual rows are caught + logged; they never
 * halt the entire run.
 */
@Injectable()
export class OvertimeCompletionService {
  private readonly logger = new Logger(OvertimeCompletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async runCompletion(
    options: { companyId?: string; now?: Date } = {},
  ): Promise<CompletionRunResult> {
    const startedAt = Date.now();
    const now = options.now ?? new Date();

    // Bound the search: only rows that MIGHT be eligible. Anything with a
    // workDate older than 90 days is presumed dead-lettered (stale APPROVED
    // that HR should manually resolve). This keeps the scheduler linear in
    // recent activity, not table size.
    const oldestConsidered = new Date(now);
    oldestConsidered.setUTCDate(oldestConsidered.getUTCDate() - 90);

    const where: Prisma.OvertimeRequestWhereInput = {
      status: 'APPROVED',
      deletedAt: null,
      workDate: { gte: oldestConsidered },
    };
    if (options.companyId) where.companyId = options.companyId;

    const candidates = await this.prisma.overtimeRequest.findMany({
      where,
      orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        companyId: true,
        userId: true,
        workDate: true,
        hours: true,
        status: true,
        // Load the grace policy AND the payroll cutoff per-row so the run
        // works uniformly across tenants without extra caching layers. The
        // cutoff column is a NULL-able DATE — the guard treats null as
        // "no cutoff" (ADR-0010 follow-up).
        company: {
          select: {
            overtimeCompleteGraceDays: true,
            payrollLockedUntil: true,
          },
        },
        // Preload the recipient for the completion notification so we don't
        // hit the DB again per row after we decide to promote.
        user: { select: { email: true, fullName: true } },
      },
    });

    const skipped: Record<string, number> = {};
    let completed = 0;

    for (const c of candidates) {
      // Payroll cutoff short-circuit — skip candidates inside a frozen
      // period BEFORE the attendance query so scheduler runtime doesn't
      // grow with historical debt. Counted per row (unlike the
      // absence-scanner which counts per date) because the overtime
      // completion scheduler is per-row by nature.
      if (isPayrollLocked(c.workDate, c.company.payrollLockedUntil)) {
        skipped.PAYROLL_LOCKED = (skipped.PAYROLL_LOCKED ?? 0) + 1;
        continue;
      }

      // One attendance query per candidate — could be batched to a single
      // `in` query if this ever becomes a hot path. For hundreds/day it's a
      // non-issue.
      const attendance = await this.prisma.attendanceRecord.findFirst({
        where: {
          userId: c.userId,
          companyId: c.companyId,
          workDate: c.workDate,
        },
        orderBy: { clockInAt: 'desc' },
        select: { clockInAt: true, clockOutAt: true, deletedAt: true },
      });

      const decision = decideOvertimeCompletion({
        status: c.status,
        workDate: c.workDate,
        now,
        graceDays: c.company.overtimeCompleteGraceDays,
        attendance,
      });

      if (decision.kind === 'SKIP') {
        skipped[decision.reason] = (skipped[decision.reason] ?? 0) + 1;
        continue;
      }

      try {
        await this.promote(c.id, c.status, now);
        // Notify AFTER a successful promotion. Best-effort: if the notify
        // step fails we still count the row as completed — the state
        // transition is the source of truth, not the notification.
        try {
          await this.notifications.createOne({
            companyId: c.companyId,
            recipientId: c.userId,
            recipientEmail: c.user.email,
            content: overtimeCompleted({
              overtimeRequestId: c.id,
              requesterName: c.user.fullName,
              workDate: toIsoDate(c.workDate),
              hours: Number(c.hours.toString()),
            }),
          });
        } catch (nerr) {
          this.logger.warn(
            `overtime notify-on-complete failed for id=${c.id}: ${(nerr as Error).message}`,
          );
        }
        completed += 1;
      } catch (e) {
        // Log but keep going. A race (someone rejected the row between our
        // read and our write) or a state-machine violation is not fatal to
        // the batch.
        this.logger.warn(
          { err: e, overtimeRequestId: c.id, companyId: c.companyId },
          'failed to promote overtime request to COMPLETED',
        );
        skipped.PROMOTE_FAILED = (skipped.PROMOTE_FAILED ?? 0) + 1;
      }
    }

    const result: CompletionRunResult = {
      scanned: candidates.length,
      completed,
      skipped,
      durationMs: Date.now() - startedAt,
    };
    this.logger.log(
      `overtime completion run: scanned=${result.scanned} completed=${result.completed} skipped=${JSON.stringify(
        result.skipped,
      )} durationMs=${result.durationMs}`,
    );
    return result;
  }

  private async promote(id: string, currentStatus: string, now: Date): Promise<void> {
    // Route through the state machine so any future rule (e.g. cannot
    // complete after a certain age) applies here too.
    const next = transition(currentStatus as never, { kind: 'COMPLETE' });
    await this.prisma.overtimeRequest.update({
      where: { id },
      data: { status: next, completedAt: now },
    });
  }
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
