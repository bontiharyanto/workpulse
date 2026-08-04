import { Module } from '@nestjs/common';

import { AttachmentModule } from '../attachment/attachment.module';
import { NotificationModule } from '../notification/notification.module';

import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';

@Module({
  imports: [AttachmentModule, NotificationModule],
  controllers: [LeaveController],
  providers: [LeaveService],
  exports: [LeaveService],
})
export class LeaveModule {}
