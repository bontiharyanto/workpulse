import { Module } from '@nestjs/common';

import { BacklogController } from './backlog.controller';
import { BacklogService } from './backlog.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BacklogController],
  providers: [BacklogService],
  exports: [BacklogService],
})
export class BacklogModule {}
