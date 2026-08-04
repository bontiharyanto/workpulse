import { Module } from '@nestjs/common';

import { CustomReportController } from './custom-report.controller';
import { ReportRendererService } from './renderers/report-renderer.service';
import { ReportBuilderService } from './report-builder.service';
import { ReportScheduleController } from './report-schedule.controller';
import { ReportScheduleService } from './report-schedule.service';
import { ReportSchedulerService } from './report-scheduler.service';
import { ReportSchedulerWorker } from './report-scheduler.worker';
import { SavedReportService } from './saved-report.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { DpiaModule } from '../dpia/dpia.module';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RopaModule } from '../ropa/ropa.module';

/**
 * Fase 33c — Scheduled Email Reports.
 *
 * Imports the report-producer modules (`RopaModule`, `DpiaModule`,
 * `AnalyticsModule`) so the renderer can compose their public services
 * without going through HTTP. `NotificationModule` provides the
 * `EmailAdapter` DI token.
 */
@Module({
  imports: [PrismaModule, NotificationModule, RopaModule, DpiaModule, AnalyticsModule],
  controllers: [ReportScheduleController, CustomReportController],
  providers: [
    ReportScheduleService,
    ReportRendererService,
    ReportSchedulerService,
    ReportSchedulerWorker,
    SavedReportService,
    ReportBuilderService,
  ],
  exports: [
    ReportSchedulerService,
    ReportSchedulerWorker,
    SavedReportService,
    ReportBuilderService,
  ],
})
export class ReportsModule {}
