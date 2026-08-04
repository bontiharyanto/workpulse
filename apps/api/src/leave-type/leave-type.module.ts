import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { LeaveTypeController } from './leave-type.controller';
import { LeaveTypeService } from './leave-type.service';

@Module({
  imports: [PrismaModule],
  controllers: [LeaveTypeController],
  providers: [LeaveTypeService],
  exports: [LeaveTypeService],
})
export class LeaveTypeModule {}
