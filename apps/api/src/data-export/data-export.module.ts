import { Module } from '@nestjs/common';


import { DataExportController } from './data-export.controller';
import { DataExportService } from './data-export.service';
import { DataExportWorker } from './data-export.worker';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

/**
 * Wires the DSAR surface: HTTP controller for user-facing endpoints,
 * service for business rules, and the background worker that
 * assembles archives.
 *
 * The worker registers `@Cron` handlers automatically because
 * `ScheduleModule.forRoot()` is imported at the app root — no
 * per-module import needed here.
 */
@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [DataExportController],
  providers: [DataExportService, DataExportWorker],
  exports: [DataExportService],
})
export class DataExportModule {}
