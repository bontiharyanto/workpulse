import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { purgeLocationSharingForCompany, type PurgeSummary } from './location-sharing.service';

/**
 * ADR-0041 retention worker. Runs hourly:
 *
 *   1. Flip `PENDING` requests whose 15-minute TTL elapsed → EXPIRED
 *      (fine-grained enough for the FE to show "hangus" within a few
 *       minutes of the actual moment).
 *   2. Delete `LocationPing` rows older than 7 days.
 *   3. Delete `LocationShareRequest` rows older than 90 days.
 *
 * Every purge is per-tenant + inside its own transaction so a crash
 * mid-tenant leaves earlier tenants durably swept.
 *
 * Kill switch: `LOCATION_SHARING_RETENTION_ENABLED=false` disables
 * the cron entirely for a specific replica (ops safety valve; the
 * business feature keeps working).
 */
@Injectable()
export class LocationSharingRetentionWorker {
  private readonly logger = new Logger(LocationSharingRetentionWorker.name);
  private readonly enabled: boolean;
  private tickRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.enabled =
      config.get<string>('LOCATION_SHARING_RETENTION_ENABLED', 'true') !== 'false';
    if (!this.enabled) {
      this.logger.warn(
        'LOCATION_SHARING_RETENTION_ENABLED=false — location-sharing retention sweeps disabled on this instance.',
      );
    }
  }

  /**
   * Hourly at :17 to steer clear of the retention worker (02:00) and
   * the absence scanner (top-of-hour). Every hour is fine because:
   *
   *   - PENDING → EXPIRED can lag up to ~1h; the service-side
   *     re-check on respond() catches within-the-hour drift so users
   *     never respond to a "should-have-expired" request.
   *   - 7d/90d delete windows tolerate an hour of slack easily.
   */
  @Cron('0 17 * * * *', { name: 'location-sharing-retention' })
  async tick(): Promise<void> {
    if (!this.enabled || this.tickRunning) return;
    this.tickRunning = true;
    const started = Date.now();
    try {
      const targets = await this.prisma.company.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      let totalPings = 0;
      let totalReqs = 0;
      let totalExpired = 0;
      for (const c of targets) {
        const summary = await this.sweepOne(c.id).catch((err: Error) => {
          this.logger.error(
            { err, companyId: c.id },
            `location-sharing retention failed for tenant: ${err.message}`,
          );
          return null;
        });
        if (summary) {
          totalPings += summary.pingsPurged;
          totalReqs += summary.requestsPurged;
          totalExpired += summary.requestsExpired;
        }
      }
      if (totalPings || totalReqs || totalExpired) {
        this.logger.log(
          `location-sharing retention tick tenants=${targets.length} pings=${totalPings} requests=${totalReqs} expired=${totalExpired} durationMs=${
            Date.now() - started
          }`,
        );
      } else {
        this.logger.debug(
          `location-sharing retention tick: nothing to do (tenants=${targets.length} durationMs=${
            Date.now() - started
          })`,
        );
      }
    } finally {
      this.tickRunning = false;
    }
  }

  /**
   * Manual trigger for E2E / ops. Bypasses reentrancy; caller owns
   * the concurrency contract.
   */
  async runOnce(): Promise<PurgeSummary[]> {
    const targets = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    const out: PurgeSummary[] = [];
    for (const c of targets) {
      const s = await this.sweepOne(c.id).catch(() => null);
      if (s) out.push(s);
    }
    return out;
  }

  private async sweepOne(companyId: string): Promise<PurgeSummary> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const summary = await purgeLocationSharingForCompany(tx, companyId, now);
      if (summary.pingsPurged || summary.requestsPurged || summary.requestsExpired) {
        await tx.auditLog.create({
          data: {
            companyId,
            actorId: null,
            action: 'LOCATION_SHARING_RETENTION_SWEPT',
            entityType: 'LocationSharing',
            entityId: `sweep-${now.toISOString()}`,
            afterJson: summary as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return summary;
    });
  }
}
