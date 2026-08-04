import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';

import { ReportSchedulerService } from './report-scheduler.service';

/**
 * Fase 33c — cron wrapper.
 *
 * Ticks every 15 minutes (0/15 min-of-hour). Longer intervals would
 * make the hourly cadenceHour meaningful but with substantial user-
 * visible latency after a schedule creation; shorter intervals would
 * add DB round-trip pressure without a business reason.
 *
 * Kill switch: `REPORT_SCHEDULER_ENABLED`. Default `true`.
 */
@Injectable()
export class ReportSchedulerWorker {
  private readonly logger = new Logger(ReportSchedulerWorker.name);
  private readonly enabled: boolean;
  private tickRunning = false;

  constructor(
    private readonly scheduler: ReportSchedulerService,
    config: ConfigService,
  ) {
    this.enabled =
      config.get<string>('REPORT_SCHEDULER_ENABLED', 'true') !== 'false';
  }

  @Cron('0 */15 * * * *', { name: 'report-scheduler-tick' })
  async tick(): Promise<void> {
    if (!this.enabled) return;
    if (this.tickRunning) {
      this.logger.warn('previous report-scheduler-tick still running; skip');
      return;
    }
    this.tickRunning = true;
    try {
      const delivered = await this.scheduler.tickOnce();
      if (delivered > 0) {
        this.logger.log(`report-scheduler dispatched ${delivered} reports`);
      }
    } catch (err) {
      this.logger.error(
        `report-scheduler-tick threw: ${(err as Error).message}`,
      );
    } finally {
      this.tickRunning = false;
    }
  }

  /** Test-support hook. */
  async tickForTest(now = new Date()): Promise<number> {
    return this.scheduler.tickOnce(now);
  }
}
