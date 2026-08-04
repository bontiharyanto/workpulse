import { Module } from '@nestjs/common';

import { ShiftController } from './shift.controller';
import { ShiftService } from './shift.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ShiftController],
  providers: [ShiftService],
  exports: [ShiftService],
})
export class ShiftModule {}
