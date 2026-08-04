import { Module } from '@nestjs/common';

import { AttachmentModule } from '../attachment/attachment.module';
import { NotificationModule } from '../notification/notification.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TimesheetModule } from '../timesheet/timesheet.module';

import { AttendanceCorrectionController } from './attendance-correction.controller';
import { AttendanceCorrectionService } from './attendance-correction.service';

@Module({
  imports: [PrismaModule, NotificationModule, AttachmentModule, TimesheetModule],
  controllers: [AttendanceCorrectionController],
  providers: [AttendanceCorrectionService],
  exports: [AttendanceCorrectionService],
})
export class AttendanceCorrectionModule {}
