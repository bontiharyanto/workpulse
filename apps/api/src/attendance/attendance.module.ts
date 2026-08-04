import { Module } from '@nestjs/common';

import { NotificationModule } from '../notification/notification.module';

import { AbsenceScannerService } from './absence-scanner.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceSchedulerService } from './attendance-scheduler.service';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [NotificationModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AbsenceScannerService, AttendanceSchedulerService],
  exports: [AttendanceService, AbsenceScannerService],
})
export class AttendanceModule {}
