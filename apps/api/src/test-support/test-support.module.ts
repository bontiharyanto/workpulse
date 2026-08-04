import { Module } from '@nestjs/common';

import { TestSupportController } from './test-support.controller';
import { WebhookReceiverController } from './webhook-receiver.controller';
import { AnalyticsModule } from '../analytics/analytics.module';
import { DataErasureModule } from '../data-erasure/data-erasure.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportsModule } from '../reports/reports.module';
import { RetentionModule } from '../retention/retention.module';
import { TimesheetModule } from '../timesheet/timesheet.module';
import { WebhookModule } from '../webhook/webhook.module';

/**
 * See `TestSupportController` for the runtime gate that protects
 * these routes. The module itself is imported unconditionally
 * because Nest's module resolution is cheap — the *route handlers*
 * throw 403 unless `THROTTLER_DISABLED=true`.
 *
 * `DataErasureModule` is imported so the test-support controller
 * can kick the worker's `tick()` on demand — E2E tests use this to
 * exercise the full erasure lifecycle without waiting five minutes
 * for the cron.
 */
@Module({
  imports: [
    PrismaModule,
    DataErasureModule,
    RetentionModule,
    TimesheetModule,
    WebhookModule,
    AnalyticsModule,
    ReportsModule,
  ],
  controllers: [TestSupportController, WebhookReceiverController],
})
export class TestSupportModule {}
