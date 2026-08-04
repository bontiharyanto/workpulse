import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';

import { TenantUsageService } from './tenant-usage.service';

/**
 * OPS-7 — Tenant usage snapshot worker.
 *
 * Fires on day 1 of every month at 06:00 UTC (30 minutes after the
 * OPS-6 retention audit, giving that worker time to finish). For
 * every active tenant, upserts a `TenantUsageSnapshot` for the
 * calendar month preceding the tick.
 *
 * Kill switch: `TENANT_USAGE_WORKER_ENABLED`. Default `true`.
 */
@Injectable()
export class TenantUsageWorker {
  private readonly logger = new Logger(TenantUsageWorker.name);
  private readonly enabled: boolean;
  private tickRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: TenantUsageService,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>('TENANT_USAGE_WORKER_ENABLED', 'true') !== 'false';
    if (!this.enabled) {
      this.logger.warn(
        'TENANT_USAGE_WORKER_ENABLED=false — monthly usage snapshot disabled on this instance.',
      );
    }
  }

  @Cron('0 0 6 1 * *', { name: 'tenant-usage' })
  async tick(): Promise<void> {
    if (!this.enabled) return;
    if (this.tickRunning) {
      this.logger.warn('previous tenant-usage tick still running; skip');
      return;
    }
    this.tickRunning = true;
    const started = Date.now();
    try {
      const generated = await this.runOnce(new Date());
      this.logger.log(
        `tenant-usage tick complete generated=${generated} durationMs=${Date.now() - started}`,
      );
    } catch (err) {
      this.logger.error(`tenant-usage tick threw: ${(err as Error).message}`);
    } finally {
      this.tickRunning = false;
    }
  }

  /** Exposed for the test-support endpoint. */
  async runOnce(reference: Date): Promise<number> {
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    let generated = 0;
    for (const c of companies) {
      try {
        await this.usage.snapshotPreviousMonth(c.id, reference);
        generated += 1;
      } catch (err) {
        this.logger.error(
          `tenant usage snapshot failed companyId=${c.id}: ${(err as Error).message}`,
        );
      }
    }
    return generated;
  }
}
