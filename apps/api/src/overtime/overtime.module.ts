import { Module } from '@nestjs/common';

import { OvertimeAdminController } from './overtime-admin.controller';
import { OvertimeCompletionService } from './overtime-completion.service';
import { OvertimeSchedulerService } from './overtime-scheduler.service';
import { OvertimeController } from './overtime.controller';
import { OvertimeService } from './overtime.service';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [OvertimeController, OvertimeAdminController],
  providers: [OvertimeService, OvertimeCompletionService, OvertimeSchedulerService],
  exports: [OvertimeService, OvertimeCompletionService],
})
export class OvertimeModule {}
