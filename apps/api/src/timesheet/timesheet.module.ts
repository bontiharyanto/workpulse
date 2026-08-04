import { Module } from '@nestjs/common';

import { TimesheetAdminController } from './timesheet-admin.controller';
import { TimesheetConfigController } from './timesheet-config.controller';
import { TimesheetConfigService } from './timesheet-config.service';
import { TimesheetExportPublicController } from './timesheet-export-public.controller';
import { TimesheetExportShareService } from './timesheet-export-share.service';
import { TimesheetExportController } from './timesheet-export.controller';
import { TimesheetExportService } from './timesheet-export.service';
import { TimesheetSchedulerService } from './timesheet-scheduler.service';
import { TimesheetSchedulerWorker } from './timesheet-scheduler.worker';
import { TimesheetSelfController } from './timesheet-self.controller';
import { TimesheetSubmissionService } from './timesheet-submission.service';
import { TimesheetService } from './timesheet.service';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WebhookModule } from '../webhook/webhook.module';

/**
 * Timesheet module. Foundation (Fase 32a) + workflow (32b) + payroll
 * export (32c) + signed share links (32d) + auto-gen & reminders (32f)
 * + HR reopen after payroll (32g).
 * Owns the entire read/write surface for the materialised timesheet
 * subsystem.
 */
@Module({
  imports: [PrismaModule, NotificationModule, WebhookModule],
  controllers: [
    TimesheetConfigController,
    TimesheetSelfController,
    TimesheetExportPublicController,
    // NOTE ordering: TimesheetExportController owns the *specific*
    // path `admin/timesheet/exports`. It MUST be registered before
    // TimesheetAdminController (which has `admin/timesheet/:id`), or
    // Express will match `:id = "exports"` first and return 404.
    TimesheetExportController,
    TimesheetAdminController,
  ],
  providers: [
    TimesheetConfigService,
    TimesheetService,
    TimesheetSubmissionService,
    TimesheetExportService,
    TimesheetExportShareService,
    TimesheetSchedulerService,
    TimesheetSchedulerWorker,
  ],
  exports: [
    TimesheetConfigService,
    TimesheetService,
    TimesheetSubmissionService,
    TimesheetExportService,
    TimesheetExportShareService,
    TimesheetSchedulerService,
    TimesheetSchedulerWorker,
  ],
})
export class TimesheetModule {}
