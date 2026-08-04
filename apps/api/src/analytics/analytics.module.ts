import { Module } from '@nestjs/common';


import { AnalyticsComputationService } from './analytics-computation.service';
import { AnalyticsQueryService } from './analytics-query.service';
import { AnalyticsSnapshotService } from './analytics-snapshot.service';
import { AnalyticsSnapshotWorker } from './analytics-snapshot.worker';
import { AnalyticsController } from './analytics.controller';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Fase 33a — Analytics module.
 *
 * Exports:
 *   * `AnalyticsSnapshotWorker` — so test-support can `tickForTest()`.
 *   * `AnalyticsSnapshotService` — so a future ops CLI / migration can
 *     backfill a range without depending on the internal cron.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsComputationService,
    AnalyticsQueryService,
    AnalyticsSnapshotService,
    AnalyticsSnapshotWorker,
  ],
  exports: [AnalyticsSnapshotService, AnalyticsSnapshotWorker],
})
export class AnalyticsModule {}
