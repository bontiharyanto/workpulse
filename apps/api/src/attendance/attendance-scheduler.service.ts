import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { AbsenceScannerService } from './absence-scanner.service';

/**
 * Cron wrapper around `AbsenceScannerService`.
 *
 * ## Cadence: hourly (top of the hour)
 *
 * Multi-tenant SaaS runs against many timezones simultaneously. A single
 * daily cron at a fixed UTC time is problematic: it fires too early for
 * tenants west of the server, or too late for tenants east. Instead we
 * run every hour and let the scanner itself decide "is any tenant's
 * grace window elapsed right now?" via `resolveTargetDate`.
 *
 * Steady-state cost is tiny: for tenants whose window hasn't elapsed
 * OR whose cursor is already current, `pendingScanDates` returns an
 * empty array and the tenant is skipped without touching the DB
 * beyond the initial `company.findMany` list load.
 *
 * ## Overlap protection
 *
 * A boolean guard prevents two ticks running at once — if a tenant
 * ever grows so large that a scan takes > 1h, we skip the second
 * trigger rather than double-book the DB. When that happens we log
 * loudly so ops can shard the scanner.
 *
 * ## Split from the service
 *
 * Kept in its own file so:
 *   1. Unit tests exercise `AbsenceScannerService` without the cron.
 *   2. Ops can host the scanner on external Kubernetes CronJobs by
 *      simply omitting this module from imports — the business logic
 *      itself doesn't depend on `@nestjs/schedule`.
 */
@Injectable()
export class AttendanceSchedulerService {
  private readonly logger = new Logger(AttendanceSchedulerService.name);
  private running = false;

  constructor(private readonly scanner: AbsenceScannerService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'absence-scanner' })
  async runHourly(): Promise<void> {
    if (this.running) {
      this.logger.warn('absence scanner tick skipped — previous run still in flight');
      return;
    }
    this.running = true;
    try {
      const result = await this.scanner.runAll();
      if (result.scannedCompanies === 0 && result.totalMarked === 0) {
        // Noop tick — most hours; log only at debug to keep log volume low.
        this.logger.debug(`absence scanner tick: nothing to do (durationMs=${result.durationMs})`);
        return;
      }
      this.logger.log(
        `absence scanner tick: companies=${result.scannedCompanies} marked=${result.totalMarked} durationMs=${result.durationMs}`,
      );
    } catch (err) {
      // Defensive: `scanner.runAll` catches per-row and per-tenant errors
      // already; anything reaching here is a systemic failure (DB down,
      // etc.). Log but never rethrow — an unhandled rejection would tear
      // down the whole scheduler container.
      this.logger.error(
        `absence scanner tick failed with unhandled error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.running = false;
    }
  }
}
