import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { BacklogController } from './backlog.controller';
import { BacklogService } from './backlog.service';

@Module({
  imports: [PrismaModule],
  controllers: [BacklogController],
  providers: [BacklogService],
  exports: [BacklogService],
})
export class BacklogModule {}
