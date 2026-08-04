import { Module } from '@nestjs/common';


import { BreachAdminController } from './breach-admin.controller';
import { BreachDeadlineWorker } from './breach-deadline.worker';
import { BreachExportController } from './breach-export.controller';
import { BreachExportService } from './breach-export.service';
import { BreachService } from './breach.service';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [BreachAdminController, BreachExportController],
  providers: [BreachService, BreachExportService, BreachDeadlineWorker],
  exports: [BreachService, BreachDeadlineWorker],
})
export class BreachModule {}
