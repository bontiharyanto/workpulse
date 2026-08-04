import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { ShiftController } from './shift.controller';
import { ShiftService } from './shift.service';

@Module({
  imports: [PrismaModule],
  controllers: [ShiftController],
  providers: [ShiftService],
  exports: [ShiftService],
})
export class ShiftModule {}
