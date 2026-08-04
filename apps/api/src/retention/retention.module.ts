import { Module } from '@nestjs/common';

import { RetentionAuditController } from './retention-audit.controller';
import { RetentionAuditService } from './retention-audit.service';
import { RetentionAuditWorker } from './retention-audit.worker';
import { RetentionController } from './retention.controller';
import { RetentionService } from './retention.service';
import { RetentionWorker } from './retention.worker';
import { DataErasureModule } from '../data-erasure/data-erasure.module';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Retention + auto-erasure surface.
 *
 *   - Fase 31c: `RetentionService`, `RetentionController`, `RetentionWorker`
 *     manage the per-tenant policy and the daily sweep.
 *   - OPS-6:    `RetentionAuditService`, `RetentionAuditController`,
 *               `RetentionAuditWorker` produce the monthly attestation
 *               that the sweep did what the policy demanded.
 */
@Module({
  imports: [PrismaModule, DataErasureModule, NotificationModule],
  controllers: [RetentionController, RetentionAuditController],
  providers: [RetentionService, RetentionWorker, RetentionAuditService, RetentionAuditWorker],
  // Re-exported so `TestSupportModule` can kick either worker for E2E.
  exports: [RetentionService, RetentionWorker, RetentionAuditService, RetentionAuditWorker],
})
export class RetentionModule {}
