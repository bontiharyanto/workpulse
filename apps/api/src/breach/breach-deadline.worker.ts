import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import {
  BreachStatus,
  BreachTimelineEventType,
  User,
} from '@prisma/client';

import { NotificationService } from '../notification/notification.service';
import { breachDeadlineWarning } from '../notification/domain/templates';
import { PrismaService } from '../prisma/prisma.service';

import { BreachService } from './breach.service';
import {
  DEADLINE_REMINDER_BUCKETS,
  DeadlineBucket,
  snapshot,
} from './domain/deadline';

/**
 * Fase 31g — deadline reminder cron.
 *
 * Fires every 5 minutes:
 *   1. Find incidents still in DETECTED/CONTAINED (deadline active).
 *   2. Classify each into a bucket (WARNING / CRITICAL / OVERDUE).
 *   3. If the bucket has not yet been fired (checked via
 *      `BreachTimelineEvent` = DEADLINE_WARNED with matching metadata),
 *      fire notifications to assignee + reporter + all HR_MANAGER /
 *      SUPER_ADMIN of the tenant, and append the timeline event.
 *
 * Dedup is authoritative — one warning per bucket per incident. Once
 * OVERDUE is fired, no further reminders (the incident is a paper
 * trail exhibit already).
 *
 * Kill switch: `BREACH_REMINDER_WORKER_ENABLED`. Default `true`.
 */
@Injectable()
export class BreachDeadlineWorker {
  private readonly logger = new Logger(BreachDeadlineWorker.name);
  private readonly enabled: boolean;
  private tickRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly breach: BreachService,
    private readonly notifications: NotificationService,
    config: ConfigService,
  ) {
    this.enabled =
      config.get<string>('BREACH_REMINDER_WORKER_ENABLED', 'true') !==
      'false';
  }

  @Cron('0 */5 * * * *', { name: 'breach-deadline-tick' })
  async tick(): Promise<void> {
    if (!this.enabled) return;
    if (this.tickRunning) {
      this.logger.warn('previous breach-deadline-tick still running; skip');
      return;
    }
    this.tickRunning = true;
    try {
      const fired = await this.tickOnce();
      if (fired > 0) {
        this.logger.log(`breach-deadline-tick fired ${fired} reminders`);
      }
    } catch (err) {
      this.logger.error(
        `breach-deadline-tick threw: ${(err as Error).message}`,
      );
    } finally {
      this.tickRunning = false;
    }
  }

  /**
   * Test-support hook — same as `tick()` but callable directly with a
   * fixed `now` for deterministic assertions.
   */
  async tickOnce(now: Date = new Date()): Promise<number> {
    const active = await this.prisma.breachIncident.findMany({
      where: {
        status: { in: [BreachStatus.DETECTED, BreachStatus.CONTAINED] },
      },
      select: {
        id: true,
        companyId: true,
        title: true,
        detectedAt: true,
        status: true,
        assignedToId: true,
        reportedById: true,
        assignedTo: { select: { id: true, email: true } },
        reportedBy: { select: { id: true, email: true } },
      },
    });

    let fired = 0;
    for (const inc of active) {
      const snap = snapshot(inc.detectedAt, inc.status, now);
      if (!snap.active) continue;
      const dueBucket = this.dueBucket(snap.hoursRemaining);
      if (!dueBucket) continue;

      const alreadyFired = await this.wasFired(inc.id, dueBucket);
      if (alreadyFired) continue;

      await this.breach.recordDeadlineWarning({
        incidentId: inc.id,
        companyId: inc.companyId,
        bucket: dueBucket,
        hoursRemaining: snap.hoursRemaining,
      });

      await this.fanout({
        incident: {
          id: inc.id,
          title: inc.title,
          companyId: inc.companyId,
          assignedTo: inc.assignedTo,
          reportedBy: inc.reportedBy,
        },
        bucket: dueBucket,
        hoursRemaining: snap.hoursRemaining,
        deadlineAt: snap.deadlineAt,
      });
      fired += 1;
    }
    return fired;
  }

  /**
   * Returns the highest-severity bucket that has already been reached
   * by `hoursRemaining`. If OVERDUE, we fire OVERDUE and skip lower
   * ones. Otherwise we fire each threshold as it is crossed.
   */
  private dueBucket(
    hoursRemaining: number,
  ): 'WARNING' | 'CRITICAL' | 'OVERDUE' | null {
    // Reverse the fanout list so OVERDUE wins first, then CRITICAL,
    // then WARNING — a single tick only fires one bucket per incident.
    for (const cfg of [...DEADLINE_REMINDER_BUCKETS].reverse()) {
      if (hoursRemaining <= cfg.triggerAtHoursRemaining) {
        return cfg.bucket as 'WARNING' | 'CRITICAL' | 'OVERDUE';
      }
    }
    return null;
  }

  private async wasFired(
    incidentId: string,
    bucket: DeadlineBucket,
  ): Promise<boolean> {
    const rows = await this.prisma.breachTimelineEvent.findMany({
      where: {
        incidentId,
        eventType: BreachTimelineEventType.DEADLINE_WARNED,
      },
      select: { metadata: true },
    });
    return rows.some((r) => {
      const m = r.metadata as { bucket?: string } | null;
      return m?.bucket === bucket;
    });
  }

  private async fanout(input: {
    incident: {
      id: string;
      title: string;
      companyId: string;
      assignedTo: { id: string; email: string } | null;
      reportedBy: { id: string; email: string } | null;
    };
    bucket: 'WARNING' | 'CRITICAL' | 'OVERDUE';
    hoursRemaining: number;
    deadlineAt: Date;
  }): Promise<void> {
    // HR_MANAGER + SUPER_ADMIN of the tenant — dpo channel is closer to
    // the audience for a breach than the ordinary supervisor chain.
    const dpos: Pick<User, 'id' | 'email'>[] =
      await this.prisma.user.findMany({
        where: {
          companyId: input.incident.companyId,
          deletedAt: null,
          role: { in: ['HR_MANAGER', 'SUPER_ADMIN'] },
        },
        select: { id: true, email: true },
      });

    const recipients = new Map<string, string>();
    for (const u of dpos) recipients.set(u.id, u.email);
    if (input.incident.assignedTo)
      recipients.set(
        input.incident.assignedTo.id,
        input.incident.assignedTo.email,
      );
    if (input.incident.reportedBy)
      recipients.set(
        input.incident.reportedBy.id,
        input.incident.reportedBy.email,
      );

    const content = breachDeadlineWarning({
      incidentId: input.incident.id,
      title: input.incident.title,
      bucket: input.bucket,
      hoursRemaining: input.hoursRemaining,
      deadlineAt: input.deadlineAt.toISOString(),
    });

    const inputs = Array.from(recipients.entries()).map(
      ([recipientId, recipientEmail]) => ({
        companyId: input.incident.companyId,
        recipientId,
        content,
        recipientEmail,
      }),
    );
    await this.notifications.createMany(inputs);
  }
}
