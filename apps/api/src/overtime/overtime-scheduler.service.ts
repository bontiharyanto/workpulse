import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { OvertimeCompletionService } from './overtime-completion.service';

/**
 * Wraps `OvertimeCompletionService` with a daily cron trigger.
 *
 * Split from the service itself so:
 *   1. Unit tests exercise the service without spinning up the scheduler.
 *   2. Ops can disable the cron in a single import decision without touching
 *      the business logic (e.g. run scheduling from an external Kubernetes
 *      CronJob instead by simply not importing this module).
 *
 * Scheduled at 02:00 server time — quiet-hour for most tenants in Asia/Jakarta,
 * well after end-of-day timesheet corrections and before HR reviews the
 * previous day's activity.
 */
@Injectable()
export class OvertimeSchedulerService {
  private readonly logger = new Logger(OvertimeSchedulerService.name);
  private running = false;

  constructor(private readonly completion: OvertimeCompletionService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'overtime-completion' })
  async runDaily(): Promise<void> {
    // Guard against overlapping runs by short-circuiting if one is already
    // in-flight. Given the run is daily and typically finishes in seconds,
    // this is defense-in-depth for extreme backlogs (outage recovery).
    if (this.running) {
      this.logger.warn('overtime completion run already in progress — skipping');
      return;
    }
    this.running = true;
    this.logger.log('scheduled overtime completion run starting');
    try {
      await this.completion.runCompletion();
    } catch (e) {
      // The service itself is defensive per-row; anything that bubbles up
      // here is a systemic failure (DB down, etc.). Log loudly but never
      // throw — an unhandled promise rejection would tear down the scheduler.
      this.logger.error({ err: e }, 'overtime completion run failed with an unhandled error');
    } finally {
      this.running = false;
    }
  }
}
