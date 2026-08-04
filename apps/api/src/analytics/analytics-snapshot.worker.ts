import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';

import { AnalyticsSnapshotService } from './analytics-snapshot.service';

/**
 * Fase 33a — daily cron for executive-KPI snapshots.
 *
 * Cadence: **04:00 UTC** — deliberately after the retention sweep (02:00
 * UTC) and the timesheet scheduler (03:00 UTC) so those upstream
 * side-effects are already committed. In Asia/Jakarta that lands at
 * 11:00 local, well after office start-of-day so any residual
 * clock-outs from the previous workday are captured.
 *
 * Idempotency: `AnalyticsSnapshotService.snapshotOneTenant` upserts on
 * `(companyId, date, metricKey)`. Re-running the cron within the same
 * UTC day is a no-op (values overwrite themselves with identical
 * numbers).
 *
 * Failure model: per-tenant failures are logged and skipped inside the
 * service. This worker only surfaces the aggregate "how many tenants
 * did we get through" so ops can alert on regressions.
 */
@Injectable()
export class AnalyticsSnapshotWorker {
  private readonly logger = new Logger(AnalyticsSnapshotWorker.name);
  private tickRunning = false;
  private readonly enabled: boolean;

  constructor(
    private readonly service: AnalyticsSnapshotService,
    config: ConfigService,
  ) {
    this.enabled =
      config.get<string>('ANALYTICS_SNAPSHOT_ENABLED', 'true') !== 'false';
    if (!this.enabled) {
      this.logger.warn(
        'ANALYTICS_SNAPSHOT_ENABLED=false — nightly executive KPI snapshot disabled on this instance.',
      );
    }
  }

  @Cron('0 0 4 * * *', { name: 'analytics-snapshot-tick' })
  async tick(): Promise<void> {
    if (!this.enabled || this.tickRunning) return;
    this.tickRunning = true;
    const started = Date.now();
    try {
      const summary = await this.service.snapshotAllTenants(new Date());
      this.logger.log(
        `analytics snapshot tick complete processed=${summary.tenantsProcessed} failed=${summary.tenantsFailed} durationMs=${Date.now() - started}`,
      );
    } catch (err) {
      this.logger.error(
        `analytics snapshot tick crashed: ${(err as Error).message}`,
      );
    } finally {
      this.tickRunning = false;
    }
  }

  /**
   * Test-only entry point exposed via `POST /test-support/analytics/tick`.
   * Sweeps synchronously and returns the summary so E2E can assert.
   */
  async tickForTest(now: Date = new Date()): Promise<{
    tenantsProcessed: number;
    tenantsFailed: number;
  }> {
    return this.service.snapshotAllTenants(now);
  }
}
