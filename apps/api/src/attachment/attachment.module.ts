import { Module } from '@nestjs/common';

import { StorageModule } from '../storage/storage.module';

import { AttachmentController } from './attachment.controller';
import { AttachmentService } from './attachment.service';

@Module({
  imports: [StorageModule],
  controllers: [AttachmentController],
  providers: [AttachmentService],
  exports: [AttachmentService],
})
export class AttachmentModule {}
