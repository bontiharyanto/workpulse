import { Module } from '@nestjs/common';

import { AttachmentController } from './attachment.controller';
import { AttachmentService } from './attachment.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [AttachmentController],
  providers: [AttachmentService],
  exports: [AttachmentService],
})
export class AttachmentModule {}
