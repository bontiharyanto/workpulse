import { Module } from '@nestjs/common';

import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { AttachmentModule } from '../attachment/attachment.module';
import { NotificationModule } from '../notification/notification.module';


@Module({
  imports: [AttachmentModule, NotificationModule],
  controllers: [LeaveController],
  providers: [LeaveService],
  exports: [LeaveService],
})
export class LeaveModule {}
