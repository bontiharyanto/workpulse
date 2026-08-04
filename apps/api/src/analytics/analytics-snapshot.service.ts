import { Injectable, Logger } from '@nestjs/common';
import { AnalyticsMetricKey, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { AnalyticsComputationService } from './analytics-computation.service';
import { METRIC_KEYS } from './domain/metric-keys';
import {
  Ymd,
  daysBefore,
  enumerateDays,
  todayInTz,
} from './domain/period';

/**
 * Fase 33a — snapshot writer.
 *
 * Public contract:
 *   * `snapshotAllTenants(now)` — used by the nightly worker. Sweeps every
 *     company, computes yesterday-in-TZ, upserts one row per metric.
 *   * `snapshotOneTenant(companyId, targetDay, timezone)` — reusable
 *     from test-support (backfill a single tenant) and from a future
 *     "recompute this day" admin action.
 *   * `backfill(companyId, from, to)` — replays a range for a single
 *     tenant. Never enqueued by the cron; only called out-of-band by
 *     ops or tests.
 *
 * Idempotency guarantees:
 *   * Upsert on `(companyId, date, metricKey)` — re-runs produce the
 *     same rows, no duplicates.
 *   * `computedAt` is refreshed on every upsert so ops can eyeball
 *     "when was this last recomputed?" without extra bookkeeping.
 *   * Dimension is fixed to `null` for the current Fase-33a company-wide
 *     roll-ups; the unique index still discriminates correctly.
 */
@Injectable()
export class AnalyticsSnapshotService {
  private readonly logger = new Logger(AnalyticsSnapshotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly computation: AnalyticsComputationService,
  ) {}

  /**
   * Iterate every non-deleted company and materialise "yesterday" in
   * their local timezone. Errors on one tenant do NOT abort the sweep —
   * we log and continue so a bad-config tenant can't stop analytics for
   * everyone.
   */
  async snapshotAllTenants(now: Date = new Date()): Promise<{
    tenantsProcessed: number;
    tenantsFailed: number;
  }> {
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true, timezone: true },
    });
    let processed = 0;
    let failed = 0;
    for (const c of companies) {
      const target = daysBefore(todayInTz(now, c.timezone), 1);
      try {
        await this.snapshotOneTenant(c.id, target, c.timezone);
        processed += 1;
      } catch (err) {
        failed += 1;
        this.logger.error(
          `snapshot failed company=${c.id} day=${target}: ${(err as Error).message}`,
        );
      }
    }
    return { tenantsProcessed: processed, tenantsFailed: failed };
  }

  /**
   * Compute every KPI for one tenant on one day and upsert into
   * `AnalyticsSnapshot`. Runs metrics sequentially (not `Promise.all`)
   * so a slow tenant doesn't blow up the connection pool on a shared
   * DB — each metric is cheap enough that the extra latency is
   * negligible compared to the pool safety.
   */
  async snapshotOneTenant(
    companyId: string,
    day: Ymd,
    timezone: string,
  ): Promise<void> {
    for (const key of METRIC_KEYS) {
      const value = await this.computation.compute(
        companyId,
        day,
        timezone,
        key,
      );
      await this.upsert(companyId, day, key, value);
    }
  }

  /**
   * Replay every metric across a Y-M-D range. Enumerates day-by-day so
   * partial failures resume cleanly from the last completed day.
   */
  async backfill(
    companyId: string,
    from: Ymd,
    to: Ymd,
    timezone: string,
  ): Promise<{ daysProcessed: number }> {
    const days = enumerateDays(from, to);
    for (const d of days) {
      await this.snapshotOneTenant(companyId, d, timezone);
    }
    return { daysProcessed: days.length };
  }

  private async upsert(
    companyId: string,
    day: Ymd,
    key: AnalyticsMetricKey,
    value: number,
  ): Promise<void> {
    const dateOnly = new Date(
      Date.UTC(
        Number(day.slice(0, 4)),
        Number(day.slice(5, 7)) - 1,
        Number(day.slice(8, 10)),
      ),
    );
    const decimal = new Prisma.Decimal(this.round4(value));
    await this.prisma.analyticsSnapshot.upsert({
      where: {
        companyId_date_metricKey: {
          companyId,
          date: dateOnly,
          metricKey: key,
        },
      },
      update: {
        value: decimal,
        computedAt: new Date(),
      },
      create: {
        companyId,
        date: dateOnly,
        metricKey: key,
        value: decimal,
      },
    });
  }

  /** Pin fractional digits to what the DB column stores (Decimal(18,4)). */
  private round4(v: number): string {
    if (!Number.isFinite(v)) return '0';
    return v.toFixed(4);
  }
}
