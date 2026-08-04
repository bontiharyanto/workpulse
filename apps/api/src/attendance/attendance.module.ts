import { Module } from '@nestjs/common';

import { AbsenceScannerService } from './absence-scanner.service';
import { AttendanceSchedulerService } from './attendance-scheduler.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AbsenceScannerService, AttendanceSchedulerService],
  exports: [AttendanceService, AbsenceScannerService],
})
export class AttendanceModule {}
