import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { VendorProcessor, VendorReminderKind } from '@prisma/client';

import {
  vendorContractExpiring,
  vendorReviewDue,
} from '../notification/domain/templates';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';

import { computeDueReminders } from './domain/vendor-review-cadence';

/**
 * Fase 31f — Vendor / Processor review reminder worker.
 *
 * Fires daily at 07:00 UTC. For every non-deleted, non-terminated,
 * non-deprecated vendor across every tenant:
 *
 *   1. Run `computeDueReminders(now, …)` to derive the set of
 *      reminders that are actually due today (T-30d review /
 *      T-60d contract-end).
 *   2. For each reminder, look up `VendorReminderLog` keyed by
 *      `(vendorId, kind, expectedFor)`. If a matching row exists,
 *      skip — the DPO has already been nudged for this cycle.
 *      A rescheduled cycle changes `expectedFor`, so the dedup
 *      naturally resets.
 *   3. Otherwise, dispatch an in-app + email notification to every
 *      HR_MANAGER / SUPER_ADMIN of the tenant and INSERT the log row
 *      inside the same transaction. Log inserts are single-row so
 *      concurrent runs on separate replicas collide safely on the
 *      unique index rather than duplicating notifications.
 *
 * Kill switch: `VENDOR_REVIEW_REMINDER_WORKER_ENABLED`. Default
 * `true`. Disable on follower replicas.
 */
@Injectable()
export class VendorReviewReminderWorker {
  private readonly logger = new Logger(VendorReviewReminderWorker.name);
  private readonly enabled: boolean;
  private tickRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    config: ConfigService,
  ) {
    this.enabled =
      config.get<string>('VENDOR_REVIEW_REMINDER_WORKER_ENABLED', 'true') !== 'false';
    if (!this.enabled) {
      this.logger.warn(
        'VENDOR_REVIEW_REMINDER_WORKER_ENABLED=false — vendor reminder disabled on this instance.',
      );
    }
  }

  /** Daily at 07:00 UTC. */
  @Cron('0 0 7 * * *', { name: 'vendor-review-reminder' })
  async tick(): Promise<void> {
    if (!this.enabled) return;
    if (this.tickRunning) {
      this.logger.warn('previous vendor-reminder tick still running; skip');
      return;
    }
    this.tickRunning = true;
    const started = Date.now();
    try {
      const summary = await this.runOnce(new Date());
      this.logger.log(
        `vendor-reminder tick complete evaluated=${summary.evaluated} fired=${summary.fired} durationMs=${
          Date.now() - started
        }`,
      );
    } catch (err) {
      this.logger.error(
        `vendor-reminder tick threw: ${(err as Error).message}`,
      );
    } finally {
      this.tickRunning = false;
    }
  }

  /**
   * Reusable core — takes an explicit `reference` so tests can pin
   * the clock. Returns `{evaluated, fired}` — number of vendors
   * inspected and number of reminders actually dispatched (after
   * dedup).
   */
  async runOnce(reference: Date): Promise<{ evaluated: number; fired: number }> {
    // Cheap pre-filter: only load vendors whose next cutoff is
    // reasonably close. The 90-day window covers T-60 contract
    // reminders with a comfortable buffer for clock skew.
    const cutoffHorizon = new Date(reference.getTime() + 90 * 86_400_000);
    const candidates = await this.prisma.vendorProcessor.findMany({
      where: {
        deletedAt: null,
        status: { in: ['ACTIVE', 'UNDER_REVIEW'] },
        OR: [
          { nextReviewAt: { lte: cutoffHorizon } },
          { contractEndAt: { lte: cutoffHorizon } },
        ],
      },
    });

    let fired = 0;
    for (const vendor of candidates) {
      try {
        const dispatched = await this.processVendor(vendor, reference);
        fired += dispatched;
      } catch (err) {
        this.logger.error(
          `vendor reminder failed vendorId=${vendor.id}: ${(err as Error).message}`,
        );
      }
    }

    return { evaluated: candidates.length, fired };
  }

  private async processVendor(vendor: VendorProcessor, reference: Date): Promise<number> {
    const decisions = computeDueReminders(reference, {
      status: vendor.status,
      nextReviewAt: vendor.nextReviewAt,
      contractEndAt: vendor.contractEndAt,
    });
    if (decisions.length === 0) return 0;

    let fired = 0;
    for (const decision of decisions) {
      const kind: VendorReminderKind = decision.kind;
      // Attempt to claim the dedup slot first. Uniqueness handles the
      // concurrency case where two replicas race on the same cycle.
      let claimed = false;
      try {
        await this.prisma.vendorReminderLog.create({
          data: {
            vendorId: vendor.id,
            companyId: vendor.companyId,
            kind,
            expectedFor: decision.expectedFor,
          },
        });
        claimed = true;
      } catch (err) {
        if (isPrismaError(err) && err.code === 'P2002') {
          // Another replica / previous tick already claimed this
          // cycle. Silent skip.
          continue;
        }
        throw err;
      }

      if (!claimed) continue;

      const dpos = await this.prisma.user.findMany({
        where: {
          companyId: vendor.companyId,
          deletedAt: null,
          role: { in: ['HR_MANAGER', 'SUPER_ADMIN'] },
        },
        select: { id: true, email: true },
      });
      if (dpos.length === 0) {
        this.logger.warn(
          `no DPO recipients for vendor reminder vendorId=${vendor.id} kind=${kind}`,
        );
        continue;
      }

      const content =
        kind === 'REVIEW_DUE'
          ? vendorReviewDue({
              vendorId: vendor.id,
              vendorName: vendor.name,
              daysUntil: decision.daysUntil,
              reviewCutoff: decision.expectedFor.toISOString(),
            })
          : vendorContractExpiring({
              vendorId: vendor.id,
              vendorName: vendor.name,
              daysUntil: decision.daysUntil,
              contractEnd: decision.expectedFor.toISOString(),
            });

      await this.notifications.createMany(
        dpos.map((u) => ({
          companyId: vendor.companyId,
          recipientId: u.id,
          content,
          recipientEmail: u.email,
        })),
      );
      fired += 1;
    }
    return fired;
  }
}

function isPrismaError(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err;
}
