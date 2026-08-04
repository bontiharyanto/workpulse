import { Module } from '@nestjs/common';


import { WebhookDispatcher } from './webhook-dispatcher.service';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WebhookWorker } from './webhook.worker';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Fase 32e — outbound webhooks. Exposes:
 *  - `WebhookService` for CRUD + secret rotation (imported by
 *    controllers).
 *  - `WebhookDispatcher` for domain services (timesheet export,
 *    share) to enqueue events after a commit.
 *  - `WebhookWorker` — cron-driven HTTP delivery loop.
 */
@Module({
  imports: [PrismaModule],
  controllers: [WebhookController],
  providers: [WebhookService, WebhookDispatcher, WebhookWorker],
  exports: [WebhookService, WebhookDispatcher, WebhookWorker],
})
export class WebhookModule {}
